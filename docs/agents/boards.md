# Boards, membership, and account administration

Containment is the authorization boundary: every Task, Label, and Membership is scoped by Board.
Read before changing an RLS policy, a Data API grant, a Board lifecycle function, or anything that
writes `board_id`.

## Board ownership: containment IS the authorization boundary

`account_profiles`, `boards`, and `board_memberships` exist in production, every Account has exactly
one Board, and every task carries a `board_id` — which is now **NOT NULL and authoritative**. The
four `tasks` policies compare `board_id` against the caller's current Memberships; `user_id` was no
longer an authorization input anywhere even before it was dropped from the table entirely (#197).

**`board_id = NULL` meaning "the personal board" was considered and rejected**, and the reason is
worth keeping because it generalizes past Boards. The zero-migration appeal is real: nothing has to
be backfilled and the deployed client keeps working. What it buys is two task-ownership models
preserved indefinitely, so every reader, policy, realtime filter, snapshot, and export path has to
handle both forever. The same trap appears one table over whenever a new Board-scoped thing is
tempted to scope by Account instead — Labels were made Board-scoped from their first migration for
exactly this reason, and a user-prefixed storage path for attachments would reintroduce it. Prefer
one containment model and pay the migration.

The policy shape is `board_id in (select ...)` rather than a helper function of `board_id`, and that
is deliberate on two counts. A function taking the row's Board id cannot be hoisted to an InitPlan,
so it would run once per row on the hottest query in the app; the uncorrelated subquery is evaluated
once per statement. And it needs no `security definer` helper, so there is still no private schema —
a policy that subqueries a **different** relation does not recurse.

Read/write split: SELECT is any current member (Viewers included — that is what Viewer means),
while INSERT/UPDATE/DELETE require `owner` or `editor`. UPDATE carries both `using` and `with check`
and they answer different questions: `using` picks which rows may be targeted, `with check` decides
what they may become. Without the second, an editable task could be UPDATEd to carry another Board's
id, which is content transfer by field write. `tests/rls/boards.test.ts` pins all of this, including
a Viewer being refused, an ended Membership granting nothing, and a Series being unable to span
Boards — that last one enforced by the composite foreign key
`(board_id, recur_parent_id) -> (board_id, id)`, not by a policy, so it holds even for a caller who
can legitimately edit both Boards.

Four things here are load-bearing and none is obvious from the schema alone:

- **`handle_new_user` now seeds the Account foundation** — settings, profile, Board, Owner
  Membership, and the Board's five ordinary seeded Labels — in the signup transaction. A failure in
  any of them fails registration, which is the correct trade (an Account with no usable Board is
  broken) but puts this function on the critical path of every signup. It
  is hardened per the plan: `security definer` with `set search_path = ''`, so **every reference in
  its body must be schema-qualified** — an unqualified one is now a runtime error, not a silent
  resolution.
- **`handle_account_deletion` is required by the check constraint, not optional polish.**
  `board_memberships.account_id` is `on delete set null` and the table carries
  `check (account_id is not null or ended_at is not null)`, so deleting an `auth.users` row nulls
  `account_id` on a still-current row and the check fires — `Database error deleting user`, for
  every account. This `before delete` trigger ends Memberships and drops Private Boards first. It
  reads `old.id`, never `auth.uid()`, because `auth.admin.deleteUser` runs administratively. If a
  future deletion failure points here, fix the ordering, not the constraint.
- **`tasks_infer_board_id` is gone, and its removal was the security event.** It routed a
  board-less insert to the account's single Board, which was correct only while there _was_ one.
  It was dropped in the same migration that shipped `create_board`, so a pre-cutover client now
  fails closed instead of filing a task into an arbitrary Board. Be precise about which guard
  catches it, because it is not the obvious one: Postgres evaluates a policy's `with check` before
  the NOT NULL constraint, and `tasks_insert_editor` asks whether `board_id in (select …)` — which
  for a NULL board is NULL, not `true`. The refusal is therefore
  `new row violates row-level security policy`, never a null-violation, and a test asserting the
  latter would never pass. `tests/rls/boards.test.ts` pins both halves: the board-less insert is
  refused _and_ writes nothing, and the same client succeeds the moment it names a Board — without
  that second half, a policy that denied everything would pass the first.
- **`create_board` is the only way a Board comes into existence, and it is an RPC for a reason.** A
  Board and its Owner Membership must appear together — a Board with no Membership is unreachable
  by every policy here — and there is no non-escalating way to let a client write the Membership.
  A self-serve INSERT policy on `board_memberships` would let any account claim Ownership of any
  `board_id`; narrowing it to "a Board with no Memberships yet" subqueries its own table and
  recurses. So `board_memberships` still has no INSERT policy at all, and the function takes **no
  account parameter** — any parameter that could name another account would reintroduce exactly the
  escalation the design avoids. It is `security definer` in `public`, hardened like
  `handle_new_user`: empty `search_path`, `revoke all from public`, `grant execute to
authenticated`. It carries an abuse ceiling of 100 current Memberships per account — not a
  product limit, just a bound on the one call that writes three tables at once.
- **`create_board` and `handle_new_user` each carry their own copy of the seeded Label list.** A
  shared helper would have to take the account as a parameter to serve the signup trigger, which is
  the escalation surface above, so the duplication is deliberate. What keeps them from drifting is
  a test, not a comment: `board_creation.test.ts` asserts a created Board and a signup Board have
  identical vocabularies.
- **`app_private` holds policy helpers.** Account-level administration introduced
  `app_private.is_admin()` for feature-flag writes. Board policies remain Membership-scoped;
  administration grants no additional access to Board content. A future _co-member_ clause on
  `board_memberships` will also need a helper because it subqueries its own table and recurses.
  Measured, not assumed: a policy calling a function in a private schema requires the **calling**
  role to hold `USAGE` and `EXECUTE` or the query dies with `permission denied for function`, so
  such a helper can never be hidden from `authenticated` — only from `anon`. What actually keeps a
  schema off the Data API is `[api] schemas` in `config.toml`; PostgREST refuses an unlisted schema
  with `PGRST106` even for `service_role`.

The Board tables grant **nothing to `service_role`**, and almost nothing to anyone — a deliberate
departure from the broader grants on `tasks`/`user_settings`. Authenticated Task INSERT/UPDATE
grants are column-scoped as described below. Membership
administration carries invariants a direct table write cannot enforce, so `board_memberships` has no
INSERT grant or policy at all and never will have a self-serve one. What has since been added to
`boards` is three things, and the asymmetry between them is the point:

- **`grant delete`, with an Owner-only DELETE policy.** Deletion writes one row and the contents
  follow through `on delete cascade`, so there is nothing to make atomic that Postgres is not
  already making atomic and a definer function would add privilege for nothing. DELETE takes no
  column list — PostgreSQL does not column-scope it — so the policy is the whole boundary there.
- **`grant update (name)`, with an Owner-only UPDATE policy.** Column-scoped for the same reason as
  `board_memberships.default_view` and `account_profiles.display_name`: RLS cannot express "only
  this column changed", because a policy cannot see the old row. The grant is what keeps `id`,
  `created_at`, and `updated_at` out of reach; the policy only decides whose rows are in scope, and
  neither half substitutes for the other. `boards_update_owner` carries a `with check` that is
  **redundant today** and says so in the migration — `name` appears in neither predicate, so no
  update exists that `using` admits and it rejects. It is there because that is a property of the
  grant rather than the policy, and a later `grant update (id)` would make it the only thing
  stopping a Board being renumbered out of its Owner's reach.
- **Creation is still not a grant.** `create_board` is an RPC because a Board and its Owner
  Membership must appear together and no client-writable Membership INSERT can be made
  non-escalating.

**Deleting a Board destroys everything in it, and no policy says so.** `tasks.board_id`,
`labels.board_id`, and `board_memberships.board_id` are each `on delete cascade`, and referential
actions are **not** subject to RLS — they run as the referencing table's owner — so the caller's
policies on `tasks` and `labels` neither permit nor prevent any of it. `boards_delete_owner` is the
only thing standing in front of the lot. `tests/rls/board_deletion.test.ts` asserts the cascade
actually reaches every child table rather than assuming it, and that the blast radius stops at the
Board deleted.

Deleting your **last** Board is allowed: zero Boards is a legitimate domain state that
`resolveSelection` already returns null for, and `BoardPage` renders `NoBoards` for it. That branch
is load-bearing rather than defensive — `useTasks` receives an empty board id, loads nothing, and
reports no error, so without it the screen is a board with no tasks, which is indistinguishable from
real data loss. Deletion is deliberately **not** guarded against a Board other people are members
of, unlike `handle_account_deletion`: there the account is leaving and destroying other members'
content is not its call, whereas here the caller is the Owner and that is what Ownership means.

Practical consequence for fixtures: a test that reaches for the service client to create a Board
gets a permission error; seed through direct SQL or `create_board`, never by widening the grant.

**Task attribution is stamped by the database (#291).** The invoker trigger
`stamp_task_attribution` sets `author_id = auth.uid()`, `author_kind = 'author'`, and `revision = 1`
on INSERT; every UPDATE increments the stored revision, and both paths stamp `last_editor_id`.
Administrative writes without an authenticated user stamp a null editor. Existing attribution is
not backfilled: Board containment cannot establish historical authorship. Revision records writes;
the client does not yet enforce compare-and-swap checks to reject stale edits.

Authenticated INSERT/UPDATE grants match the `taskToRow` payload exactly, including `id` for
PostgREST upserts and excluding attribution and database timestamps. `recur_weekdays` and
`recur_count` joined the grant a release ahead of the client — see [Recurrence](recurrence.md) for
what `taskToRow` now sends. Grants can run ahead of the payload; they must never fall behind it — a
column the payload names and the grant omits is a `403` on every write, which is the whole reason
the grant half of a column-half-only migration cannot be deferred to the client's release.
**Leave `author_id` untouched in the UPDATE trigger:** the grant prevents client forgery, while the
foreign key must still be able to SET NULL when an author deletes their account. `tests/rls/task_attribution.test.ts` covers canonical
writes and upserts, protected-column forgery, account deletion, and concurrent revision increments.

## Account administration and feature flags

`user_roles` is Account-scoped; an `admin` row is assigned and revoked through SQL only. Even
admins have no Data API write grant on this table. Users read only their own row. The
`app_private.is_admin()` policy helper takes no account parameter, uses an empty `search_path`,
and checks the live role rather than JWT claims. Revocation therefore applies to the next flag
write without waiting for token refresh. Both its ACL and schema reachability are pinned in
`tests/rls/baseline.test.ts`.

Authenticated users read `feature_flags`; admins create, update, and delete definitions. Flags
control UI rollout only: every protected operation still needs its own RLS policy. Neither table
joins the realtime publication or offline snapshots. `src/access/useRole.ts` and `useFlags.ts`
provide session-scoped hints, refreshing on focus, reconnection, session change, and every minute.
Signed-out, offline, failed, and missing reads default to no admin role and disabled flags. See
[the administration runbook](../runbooks/roles-and-feature-flags.md) for SQL seeding and usage.

### The admin dashboard: counts, never content (#274)

`/admin` (`src/pages/AdminPage.tsx`, reached from a Settings link shown only to admins) reads
through `src/admin/adminApi.ts` and two `security definer` RPCs in `public`: `admin_stats()`
(Account, Board, and Task totals plus a 30-day UTC series) and `admin_users(page_limit,
page_offset)` (email, sign-up and last sign-in dates, MFA enrolment, admin role, and counts of
owned Boards and Tasks, at most 100 rows per page). **No per-Account Task content is reachable, by
design**: an admin dashboard on a personal task board is the easiest place in this codebase to
build a surveillance surface, so neither function may ever select a title, description, checklist,
label, or day. Task counts exclude hidden Series definitions, which `admin_stats()` reports apart.

Both RPCs call `app_private.require_admin_session()`, which refuses with `42501` unless the caller
holds a live admin role, the session JWT is `aal2`, **and** a verified factor existed before that
session began (`auth.sessions` via the JWT's `session_id`). The last clause is not redundant: an
Account with no verified factor can enrol one from a password-only session, and verifying it raises
that same session to `aal2`, so a stolen session could otherwise mint its own second factor. A
factor added mid-session counts only after a fresh sign-in. What no check can stop is a stolen
password for an admin with no factor, so the runbook requires a verified factor before the role is
granted. The helper has no grants, because only the definer bodies call it. The page's role check
is cosmetic; it renders the database's refusal as a two-factor explanation. Flag toggles on the
page use the ordinary `feature_flags` update policies (admin role, no two-factor requirement), and
creating or deleting a flag stays in SQL.
`tests/rls/admin_dashboard.test.ts` enrols a real TOTP factor and signs in again to reach `aal2`,
then proves the anonymous, member, password-only-admin, and self-enrolled-session refusals, exact count deltas, the returned column set,
paging bounds, and immediate revocation.

## The app layer matches it

`BoardDirectoryProvider` (`src/board/BoardDirectoryProvider.tsx`, mounted
above `<Routes>` beside `SettingsProvider`, see
[Client state and realtime sync](state-and-sync.md)) loads the signed-in Account's current
Memberships joined to their Boards, resolves which one is open (`resolveSelection()` in
`src/board/selection.ts`), and exposes it as `useBoardSession()`'s `board` + `can` — the first real
caller of `src/board/role.ts`'s capabilities. `useTasks` takes a `boardId` and loads/writes
`.eq('board_id', boardId)`; `taskToRow(task, boardId)` sends only `board_id` (`user_id` stopped
being written in #199 — see [Labels](labels.md)); offline board snapshots are keyed per
Board; realtime filters on `board_id`; and `DataSection`'s import/export is scoped the same way.

**Client-side scoping is still not the boundary — it just no longer disagrees with it.** Everything
above narrows what the client _asks_ for; RLS narrows what the server _allows_, and since the
cutover the two agree. `src/board/role.ts` says so in its own header, and it matters: a capability
returning `true` grants nothing, and a `board_id` the caller cannot reach is now refused by the
database rather than merely absent from the UI.
