# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every merge to `main` auto-releases (the `Version` workflow tags `v<major>.<minor>.<build>`), so each
released build gets its own section below — named for the version the merge minted. `Unreleased` holds
only work that is on a branch but not yet merged.

## [Unreleased]

No unreleased changes.

## [1.8.5] - 2026-08-19

Documentation only — no code, schema, or behaviour changes.

### Docs

- Rehearsed a database restore against the current schema and fixed what it exposed (#202). This was
  the first rehearsal since Boards, Labels, the Board lifecycle, realtime Labels, and the
  compatibility retirement shipped; the previous full pass predates all of them.
- **The restore verification had no Label checks at all.** Labels shipped after the last rehearsal
  and `docs/runbooks/restore-from-backup.md` was never extended. Demonstrated rather than reasoned:
  deleting every `labels` row from an otherwise healthy restore left three tasks holding dangling
  `label_id` values, and **every check in the verification section still reported clean** —
  byte-identical to the healthy run. That is exactly the failure the section exists to catch, and
  what its own warning about disabled foreign-key triggers describes. Added a `labels` count, a
  Task→Label orphan check, and the two containment checks one level up (Label→Board,
  Membership→Board), each confirmed against the corrupted database before restoring it.
- Replaced the exact policy total with a **per-table breakdown**. That number was hard-coded three
  times (12, 17, 18) and went stale on the next schema change every time, and CI cannot catch it
  because the backup workflow asserts only a floor. What a restore needs to know is that no table
  came back with zero policies, which is the shape a partial restore takes.
- Everything else in the verification passed, which confirms the corrections made in `v1.8.0`,
  `v1.8.2`, and `v1.8.4` hold up under an actual run rather than only under review.
- Still unexercised, and unverified outside CI since 2026-07-27: GPG decryption of a real bundle and
  the artifact download path. `BACKUP_GPG_PASSPHRASE` is write-only in GitHub and was not available
  to this pass — recorded in the rehearsal log rather than glossed over.

## [1.8.4] - 2026-08-19

Internal only — nothing about the app looks or behaves differently. This completes the retirement
of the Category compatibility layer.

### Removed

- Dropped four columns nothing has read or written for a release: `tasks.user_id`, `tasks.category`,
  `tasks.label_assignment_explicit`, and `user_settings.default_view` (#197). **This is
  irreversible** — the columns and their contents are gone. Nothing user-facing was in them: tasks,
  labels, and settings are untouched, and every value still displayed lives elsewhere.
- A browser tab open since before `v1.8.3` deployed will get `400 PGRST204` on its next write until
  reloaded. That is the same class of break as the window closure in `v1.8.2`, and the reason this
  waited a release rather than landing with the client change that made it possible.

### Internal

- Retiring the layer took three releases and each boundary was forced by a different race, both
  about writes only: `v1.8.2` dropped the Category bridge and relaxed `tasks.user_id` to nullable,
  `v1.8.3` stopped the client writing it, and this drops the columns. Only `user_id` needed all
  three — it was `NOT NULL` with no default, while the other two have defaults and could leave the
  client payload in one step.
- Two things the drop took with it, checked against a local stack rather than assumed:
  - `tasks_user_day_idx` and `tasks_user_status_idx` went with the column. That is safe **only**
    because `tasks_board_day_idx` and `tasks_board_status_idx` already cover the same shapes on
    `board_id`. Those two were the board's hot-path indexes when the board was an account-wide task
    list, so dropping them without checking would have turned every board load into a sequential
    scan.
  - `tasks_user_id_fkey ... ON DELETE CASCADE` was what deleted an Account's Tasks when its
    `auth.users` row went away. That guarantee now rests entirely on `handle_account_deletion`
    dropping Private Boards, with `tasks.board_id`'s own cascade doing the rest — the same outcome
    through a different mechanism, and untested on **both** sides of the move. `boards.test.ts` now
    covers it, mutation-checked by disabling the Board drop.
- `tests/rls/compatibility_window.test.ts` is deleted, as its own docstring instructed: it asserted
  that the _old_ client payload shape still writes, which is exactly what stops being true here.

### Docs

- `restore-from-backup.md`'s post-restore orphan check queried `tasks.user_id`, which now names a
  dropped column — during a real restore it would have failed with
  `column "user_id" does not exist` rather than merely reporting the wrong thing. Replaced with a
  note covering the case it leaves behind: a bundle taken before this migration still carries
  `user_id` in its `data.sql`, so restoring it against a schema built from the current migrations
  fails loudly, and the fix is to load that bundle's own `schema.sql` instead.

## [1.8.3] - 2026-08-19

Internal only — nothing about the app looks or behaves differently.

### Changed

- The app no longer writes `tasks.user_id`. `board_id` is the only ownership column it sends, which
  it has effectively been since the v1.2.78 authorization cutover; attribution lives in `author_id`
  and `last_editor_id`. `taskToRow` and `prepareImport` lose their user-id parameter (#199).

### Internal

- This is **step 2 of 3** in retiring the compatibility layer, and each boundary is forced by a
  different race — both about writes only, since reads were never affected.
  1. `v1.8.2` relaxed `tasks.user_id` to nullable.
  2. This release stops the client sending it. It could not be folded into the previous one:
     `Deploy Migrations` and the Cloudflare Pages build race on every merge, so a client that
     stopped sending a `NOT NULL` column could reach users before the migration relaxed it. E2E
     demonstrated exactly that on `v1.8.2`'s own pull request — the preview build ran against
     production, where the constraint was still in force, and could not create a task at all.
  3. #197 drops the column. It cannot be folded into this one either: the mirror race applies, and
     a drop landing before the new client deploys leaves the still-deployed client sending a column
     that no longer exists, which PostgREST answers with `400 PGRST204`.
- Only `user_id` needed all three steps. `category` and `label_assignment_explicit` have column
  defaults, so omitting them is valid on both sides of a migration and they came out in `v1.8.2`.
- `tests/e2e/fixtures/seedBoard.ts` deliberately still sends `user_id`: it runs against production,
  where the column exists until #197 drops it.

### Docs

- Corrected the `AGENTS.md` passage describing this work, which still set out a two-release split.
  The edit adding the middle step had silently failed to apply on the previous branch — a plain
  string replace against text prettier had since reflowed, with no assertion that it matched.
- Corrected three places (`AGENTS.md`, `ROADMAP.md`, `restore-from-backup.md`) that credited `v1.8.2`
  with stopping the client writing `user_id`. It only made the column nullable; the write stopped
  here. The distinction is easy to lose and load-bearing — it is the whole reason this is a separate
  release.

## [1.8.2] - 2026-08-19

Internal only — nothing about the app looks or behaves differently.

### Removed

- The Category compatibility layer that let pre-Label clients keep working through the Label
  migration. Its deploy window was declared closed on 2026-08-19: `v1.6.0` had already narrowed what
  it protected, because dropping the Board-inference trigger left such a client unable to create a
  task at all. The `tasks_sync_legacy_category_label` trigger and `labels.legacy_category` are gone,
  and the app no longer writes `tasks.category` or `tasks.label_assignment_explicit` (#180).
  `tasks.user_id` becomes nullable here but is still written for one release longer — see below.
- `user_settings.default_view` is no longer read or written. Default View is a Membership
  Preference and now has exactly one home, `board_memberships.default_view`; the second copy existed
  so the client deployed during the Board cutover kept reading a value it understood, and both were
  written on every change. Behaviour is unchanged — every Membership carries the column NOT NULL, so
  the account-level fallback never actually fired.

### Internal

- **This is Release A of two, and the split is measured rather than argued.** Dropping a column any
  live client still _sends_ is a hard failure: PostgREST answers
  `400 PGRST204 — Could not find the 'x' column of 'tasks' in the schema cache`. Migrations and the
  Cloudflare Pages build land at different moments, and a long-open tab runs the old client
  indefinitely, so one release that both stopped writing a column and dropped it would break task
  creation for anyone who had not reloaded. Reads were never affected — `select('*')` simply returns
  fewer columns. Release B drops the four columns themselves (#197).
- `tests/rls/compatibility_window.test.ts` asserts the premise directly: both the old and the new
  client payload shapes write successfully against this schema. Without it the split buys nothing.
- `tasks.user_id` is relaxed to nullable, the only one of the four needing a schema change — it was
  `NOT NULL` with no default, so no client could simply stop sending it. It has not been an
  authorization input since the v1.2.78 cutover; attribution lives in `author_id`/`last_editor_id`.
- **The client keeps sending `user_id` for one more release** (#199), because of a second race distinct
  from the one above: `Deploy Migrations` and the Cloudflare Pages build race on every merge, so a
  client that stopped sending a `NOT NULL` column could reach users before the migration relaxed it.
  E2E demonstrated this rather than predicting it — the preview build ran against production, where
  the constraint was still in force, and could not create a task at all. `category` and
  `label_assignment_explicit` were exempt: both have column defaults, so omitting them is valid on
  either side of the migration.
- Dropping the bridge trigger and dropping `label_assignment_explicit` from the client payload had
  to be **atomic**. Omitting that flag makes it default to `false`, which is exactly the signal the
  bridge read as "a stale client omitted `label_id`" — with the trigger still in place, every new
  Unlabeled Task would have been assigned the Work Label from `category`'s `'work'` default.
- `handle_new_user` and `create_board` both seeded the five starter Labels _with_ the alias, so
  dropping that column without rewriting them fails **every signup** — the function runs inside the
  signup transaction. Caught by the local RLS suite as `Database error creating new user`.

### Docs

- `restore-from-backup.md`'s orphaned-task check would have reported a **false failure** on every
  correct restore from here: `tasks.user_id` is nullable now and new rows leave it NULL, so its
  `left join … where u.id is null` flagged all of them. It now ignores NULL, matching the `board_id`
  check beside it. A living runbook that cries wolf during an incident is worse than one that is
  merely out of date.
- Corrected `AGENTS.md`'s architecture summary, which still described `tasks` as scoping to
  `auth.uid() = user_id`. That was left behind by the v1.2.78 authorization cutover and contradicted
  by the same file's own Board-ownership section — `tasks` scopes through Membership, and `user_id`
  is not an authorization input anywhere.

## [1.8.1] - 2026-08-18

### Fixed

- Label changes now reach your other open tabs and devices immediately. Previously a second surface
  that stayed open and focused kept its own copy of the Label list until it was backgrounded or the
  network blipped — and the failure that caused was worse than a stale name. Tasks _are_ live, so
  deleting a Label correctly re-rendered that surface's cards as Unlabeled while its task editor
  went on offering the deleted Label; picking it then failed the save. The board looked trustworthy
  while the vocabulary under it was not (#188).

### Internal

- `labels` joins `tasks` and `user_settings` in the `supabase_realtime` publication. Both standing
  rules on that publication still hold and the migration argues each rather than asserting it:
  `labels.id` is an opaque uuid, so the entire content of a cross-tenant DELETE broadcast is "some
  label somewhere was deleted, and when" — the same activity metadata `tasks` already emits, and the
  structural uuid-key test covers the new table automatically. RLS stays enabled and no policy is
  touched.
- `useLabels` is now a third `useSyncedTable` adapter beside `useTasks` and `useSettings`, filtered
  on `board_id` for the same reason `tasks` is. `src/labels/labelRealtime.ts` holds the payload
  normalizer and a pure reducer mirroring `src/data/realtime.ts`; INSERT and UPDATE collapse into
  one idempotent upsert, and the result is re-sorted by `(position, id)` because a remote reorder
  arrives as several independent updates and nothing makes `(board_id, position)` unique.
- Removed `useLabels`' own `visibilitychange`/`online` catch-up listener. `useSyncedTable` registers
  one, so keeping both meant every wake and reconnect issued two identical loads — visible only as a
  reload count in a test.

### Docs

- The post-restore RLS spot-check in `docs/runbooks/restore-from-backup.md` omitted `labels`.
  Publishing the table is what makes that worth fixing now: losing RLS on a published table
  escalates its DELETE fan-out from primary keys to full deleted rows sent to every subscriber, so
  it is exactly the row a restore must not quietly get wrong.

## [1.8.0] - 2026-08-18

### Added

- Board Owners can rename a Board from **Settings → Boards**. The name becomes an editable field in
  place, commits when you leave it or press Enter, and Escape abandons the edit. Names are trimmed,
  and an empty one is refused with an explanation rather than silently kept. Editors and Viewers see
  the name with no rename control, and the database enforces Owner-only regardless (#190).
- This completes the Board lifecycle — create, switch, rename, delete.

### Internal

- Rename is a column-scoped `grant update (name)` plus an Owner-only UPDATE policy. Both halves are
  load-bearing: RLS cannot express "only this column changed" because a policy cannot see the old
  row, so the grant is what keeps `id`, `created_at`, and `updated_at` out of reach while the policy
  decides whose rows are in scope. `tests/rls/board_rename.test.ts` asserts a PATCH carrying any
  other column is refused with `403`, including one that also carries a legitimate name.
- `boards_update_owner`'s `with check` is **redundant today** and the migration says so rather than
  implying otherwise — `name` appears in neither predicate. It exists because that is a property of
  the grant, not the policy: a later `grant update (id)` would make it the only thing stopping a
  Board being renumbered out of its Owner's reach.
- Adds a `boards_name_trimmed` constraint matching the Labels precedent, so `"Work"` and `"Work "`
  cannot be two names that render identically. No backfill needed — every existing name is
  `'My Board'` or came through `create_board`, which already trims.
- Rename is optimistic, unlike creation and deletion. Those change _which_ Boards exist, so an
  unconfirmed result would render an entry no query can find; a name is one field of a row already
  there. The rollback restores the previous list rather than the previous name, so a concurrent
  change to another Board is not clobbered by this one failing.

### Docs

- Corrected two policy counts this release moves to 18, including the Step 4 verification in
  `docs/runbooks/restore-from-backup.md` — a living runbook read during an actual restore, where a
  stale count makes a correct restore look broken.

## [1.7.0] - 2026-08-18

### Added

- Board Owners can delete a Board from **Settings → Boards**, which also lists the Boards you belong
  to and marks the one you have open. Deletion is behind a confirmation that asks you to type the
  Board's **name** — not a generic "delete" — because an Account has several Boards and a generic
  confirmation reads identically for the one you meant and the one above it in the list. The
  confirmation states plainly what goes: every task and label in that Board, permanently, with no
  undo. Editors and Viewers see the Board listed with no delete control, and the database enforces
  Owner-only regardless (#192).
- A zero-Board screen. Deleting your last Board is allowed — an Account with none is a legitimate
  state, not an error — and you now get a screen that says so and offers to create one, rather than
  something that looks like an empty board.

### Internal

- Deletion is a plain DELETE with an Owner-only policy, deliberately unlike creation, which is an
  RPC. Creation has to write a Board and its Owner Membership together and no client-writable
  Membership INSERT can be made non-escalating; deletion writes one row and the contents follow
  through foreign keys that already exist, so a definer function would add privilege for nothing.
- The cascade is the whole risk and no policy states it: `tasks`, `labels`, and `board_memberships`
  are each `on delete cascade`, and referential actions are **not** subject to RLS — they run as the
  referencing table's owner — so `boards_delete_owner` is the only thing standing in front of all of
  it. `tests/rls/board_deletion.test.ts` asserts the cascade really reaches every child table and
  that the blast radius stops at the Board deleted, and was mutation-checked by widening the policy
  to any current member.
- The zero-Board branch in `BoardPage` is load-bearing rather than defensive: `useTasks` given no
  Board loads nothing and reports no error, which would otherwise render as a board with no tasks.
  `NoBoards` is ordinary page content with its own `<main>` and `<h1>`, not a fixed full-viewport
  overlay like `ErrorScreen` and `Spinner` — axe treats those as open modals, so the landmark and
  heading rules pass for free against them.

### Fixed

- The E2E seed fixture inserted tasks without a `board_id`, so it became a pre-cutover client the
  moment `v1.6.0` dropped `tasks_infer_board_id` and began failing closed like any other. It now
  resolves the account's Board and names it on every write. Note the failure could not have appeared
  on `v1.6.0`'s own PR: E2E runs against the production database, and migrations apply only on merge,
  so a schema change is first exercised by the _next_ PR.

## [1.6.0] - 2026-08-18

### Added

- You can now create more than one Board and switch between them. The switcher sits in the toolbar
  beside the view switcher, and creating a Board is a "+ New board…" entry inside it rather than a
  separate control. A new Board arrives with the same five starter Labels as the one signup creates,
  so it is usable immediately. Switching changes tasks, Labels, and Default View together — Default
  View is a per-Board preference, so each Board remembers how you like to look at it (#191).

### Removed

- The temporary compatibility trigger that guessed which Board a task belonged to when the client
  did not say. It was correct only while an Account had exactly one Board; with a second now
  possible it would have filed a task into an arbitrary one, silently. A client old enough not to
  send a Board is now refused instead — the intended outcome, and the reason this had to ship in the
  same release as Board creation rather than after it. Current clients are unaffected; they have
  sent the Board with every task since `v1.2.75`. A tab left open since before then must be reloaded
  before it can add tasks again.

### Internal

- Board creation is `public.create_board`, a `security definer` RPC, not a pair of client inserts. A
  Board and its Owner Membership have to appear together — a Board with no Membership is unreachable
  by every policy in the schema — and there is no non-escalating way to let a client write the
  Membership itself, so `board_memberships` still has no INSERT policy at all and the function takes
  no account parameter.
- The function lives in `public` rather than `app_private`, because `[api] schemas` exposes only
  `public` and `graphql_public` and PostgREST refuses an unlisted schema with `PGRST106` even for
  `service_role` — an `app_private` RPC would be uncallable by construction. `app_private` remains
  unbuilt; the first co-member predicate is still what introduces it. The rule in
  `tests/rls/baseline.test.ts` was amended to distinguish a policy helper (which belongs in
  `app_private`) from a client-invoked RPC (which cannot live there), since as written it would have
  flagged a correct function as a mistake.
- `BoardDirectoryContext` moved to its own hook-only module, mirroring `labelDirectoryContext`, so
  an optional consumer no longer imports the provider module that several page tests mock wholesale.

### Fixed

- The nightly backup verification asserted that the schema dump defines `tasks_infer_board_id`,
  which this release drops — it would have failed every run from tonight. It now asserts
  `create_board`, checked against a real `supabase db dump` rather than against a close relative of
  the command the workflow runs.

## [1.5.0] - 2026-08-18

### Added

- Board Owners can manage their board's Label vocabulary from **Settings → Labels**: create,
  rename, recolor, reorder, and delete definitions. Deleting a Label asks first and states the
  consequence plainly — tasks using it become Unlabeled, and the tasks themselves are kept, which
  the database enforces through the Label foreign key's column-list `on delete set null`. The five
  seeded Labels are ordinary definitions here with no special status. Editors and Viewers see the
  vocabulary read-only; Owner-only policies and column grants remain the actual boundary, now
  covered by role-refusal tests with positive controls (#179).

### Internal

- Label management decisions live in a new pure `src/labels/labelIntent.ts` — name and colour
  validation, reorder maths, and the translation of a PostgREST failure into the same app-owned
  refusal vocabulary the client check produces, keyed on SQLSTATE and constraint names rather than
  message prose. `useLabels` keeps only state, Supabase, and rollback.
- Prettier now formats Markdown (`**/*.md`). `.agents/skills/` is excluded as vendored content the
  skills installer expects byte-for-byte, and `private/` as git-ignored local-only files. Because
  `.claude/agents/*.md` is both formatted and the source for `.codex/agents/*.toml`,
  `npm run format` must now run before `npm run codex:sync`.

### Docs

- Recorded the Labels realtime deferral as an open decision rather than a settled one, tracked as
  [#188](https://github.com/jwh3times/magic-agenda/issues/188). Its original justification was a
  conjunction — no UI mutated definitions, **and** publishing would widen the DELETE fan-out for no
  freshness benefit — and this release expired both halves. `AGENTS.md` now names the edge it
  leaves open: `tasks` is published and `labels` is not, so a second focused surface re-renders
  cards as Unlabeled correctly while its editor still offers the deleted definition, and the save
  is then rejected by `tasks_label_same_board`.

## [1.4.3] - 2026-08-17

### Internal

- Bumped the E2E toolchain dev dependency `@axe-core/playwright` (#184). Backfilled: Dependabot
  merges release a build but are exempt from the changelog check, so this section was added by the
  next human PR.

## [1.4.2] - 2026-08-17

### Fixed

- Card meta text — the Label name row, checklist progress counter, and description preview — now
  holds WCAG AA contrast (4.5:1) on every theme and Note Color. The opacity fade that softens this
  text blended the ink toward the paper below the threshold on all six cork papers and on brutal's
  blue paper; the fade is now capped per theme (cork floors at 0.9, brutal renders at full
  strength, glass keeps its soft fade over the dark backdrop). Exposed by axe-core 4.13.0, which
  resolves alpha-blended text colors (#186).

## [1.4.1] - 2026-08-17

### Internal

- Bumped dev dependencies: `@testing-library/user-event` 14.6.3 → 14.6.4 and the `supabase` CLI
  2.113.0 → 2.114.0 (Dependabot).

## [1.4.0] - 2026-08-17

### Added

- Added Label-aware v2 Board backups containing Label definitions and nullable assignments. Import
  requires an explicit destination choice for every referenced source Label — an existing Label or
  Unlabeled — without creating definitions or matching them automatically by name.

### Changed

- Category-shaped v1 files remain importable through the same mapping flow, with their Account
  Preferences deliberately ignored. Imports retain fresh ids, template-first insertion, additive
  semantics, and resumable batches; Owner-only export and Editor/Owner import now follow the Board
  capability model.

## [1.3.0] - 2026-08-16

### Added

- Replaced the fixed Category task experience with optional Board Labels. New Tasks start
  Unlabeled; cards and drag previews show the current Label name/color; the editor assigns one
  existing Label; filters support every Label plus Unlabeled; and recurrence carries Label edits
  through the same series-scope rules as other shared content.
- Added a Board-scoped Label Directory with per-Board offline snapshots and focus/online catch-up.
  Viewer, Editor, and Owner assignment affordances follow the Board capability model, and an
  offline Label snapshot makes the board read-only alongside task snapshots.

### Changed

- App-domain Tasks now use nullable `labelId`; normal writes explicitly distinguish Unlabeled from
  omitted legacy fields. Snapshot v4 drops old Category-shaped task caches. Export v1 remains
  operational through a contained compatibility adapter until the Label-aware v2 work in #178.

## [1.2.80] - 2026-08-16

### Internal

- Added Board-owned Label definitions and an optional `tasks.label_id`. Existing Boards receive the
  five Category values as ordinary seeded Labels, existing Tasks are backfilled to those Labels,
  and new-account setup seeds the same definitions. Labels are intentionally not exposed in the UI
  until the next application-layer release.
- Label access follows Board Membership: current members may read definitions, while only Owners may
  create, rename, recolor, reorder, or delete them. A composite foreign key prevents cross-Board
  assignment, and deleting a Label clears only the Task's Label so its Board containment remains
  intact.
- Added a temporary deploy-window bridge that maps writes from the currently deployed
  Category-based client without overriding explicit Label or Unlabeled assignments from the next
  client. Behavioural RLS and constraint coverage pins signup seeding, grants, backfill, stale-client
  writes, renames, deletion, and cross-Board rejection.

## [1.2.79] - 2026-08-14

### Internal

- Updated `@supabase/supabase-js` from 2.112.2 to 2.112.3, including its Auth, Functions,
  PostgREST, Realtime, and Storage packages.

## [1.2.78] - 2026-08-14

### Fixed

- The nightly backup job would have failed outright on its next run, producing **no backup**. The
  function assertion added in v1.2.76 was written as a literal `grep "FUNCTION public.<name>"` and
  verified against raw `pg_dump`, which writes identifiers unquoted — but the job runs
  `supabase db dump`, which writes `"public"."handle_new_user"`, so the check could never match. The
  last successful run predated that change, so no backup was lost. Quotes are now normalised the way
  the neighbouring table check already did, and the verify step additionally asserts the dump carries
  at least twelve policies — a bundle that restored tables and functions but no policies would come
  back default-deny on every table, which fails closed but looks identical to total data loss.

### Internal

- **Task access is now governed by Board membership rather than row ownership.** `tasks.board_id` is
  NOT NULL, and the four policies compare it against the caller's current Memberships; `user_id` is
  no longer an authorization input anywhere and survives only until it is dropped. This is a change
  of reason, not of result — every task was already backfilled with a Board and every account has
  exactly one, so the new predicate selects precisely the rows the old one did. Reading is open to
  any current member, including Viewers; writing requires owner or editor.
- A Recurring Series can no longer span Boards, enforced by a composite foreign key rather than a
  policy — so it holds even for a caller who can legitimately edit both. Occurrence uniqueness moved
  to `(board_id, recur_parent_id, recur_origin_day)`.
- The realtime filter is now part of each adapter's spec instead of being hardcoded to `user_id`:
  tasks subscribe by `board_id`, settings by `user_id`. The Board Directory revalidates membership
  when the tab wakes or the network returns, because nothing pushes "your access ended" — the server
  simply stops returning the Board, and a filtered channel goes quiet rather than announcing it.
- Deliberately **not** in this release: the command layer, UPSERT elimination, and revision-aware
  echo suppression. Those are concurrency semantics that only bite once two people write to the same
  Board, and bundling a write-path rewrite into the release that changes who may reach a task would
  make it far harder to review or bisect. Revision-aware echo suppression in particular cannot work
  before the write path stamps and returns a revision.

## [1.2.77] - 2026-08-14

### Internal

- The app layer now knows which Board it is looking at. A Board Directory loads the account's
  memberships, remembers the selection, and publishes it session-wide; `useTasks` takes a board id
  and filters its load by it; writes send `board_id` alongside `user_id`; and the last unfiltered
  task query (export) is scoped too. **Nothing user-visible changes** — every account has exactly one
  Board, so the selection resolves to it and the board renders identically. RLS is untouched:
  containment is still data integrity, not access control.
- Offline snapshots are keyed per Board rather than one per account, with a separate directory
  envelope recording which Boards this device last saw. Snapshots of Boards the server no longer
  returns are purged on the next successful load — the client-side half of revocation, since access
  ending is silent and nothing else would notice. The purge takes the ids to _remove_, computed from
  the server's list, so a load returning nothing correctly purges everything; it runs only under a
  real session, because a sessionless read succeeds against RLS with no rows and treating that as
  "you are in no Boards" would wipe the cache on exactly the offline path it exists to serve.
  Sign-out sweeps every Board key by prefix, including ones the session never opened.
- The stored snapshot envelope version moved 2 → 3. Older envelopes are dropped rather than
  migrated, which costs nothing in practice: reaching this code at all requires a network
  navigation, and that same load rewrites them.
- Default View is now read from the Membership — it describes how one account experiences one
  Board — written through the column-level grant added with the Board schema. Both copies are
  written until `user_settings.default_view` is dropped, since writing one is how they diverge.
- Fixed a test-infrastructure bug worth recording: the `useTasks` Supabase mock returned a bare
  Promise from `select()`, so adding `.eq('board_id', …)` made the load resolve as an _empty board_
  rather than an error — the loudest possible failure reported in the quietest possible way. The
  mock is now both awaitable and chainable.

## [1.2.76] - 2026-08-13

### Internal

- Added the Board ownership foundation: `account_profiles`, `boards`, and `board_memberships`, plus
  `board_id`, `author_id`, `last_editor_id`, `author_kind`, and `revision` on `tasks`. Every account
  is backfilled with one board and an owner membership, every task is routed through it, and
  `default_view` is copied from `user_settings` onto the membership. **Additive only — no behaviour
  changes.** `tasks` policies still compare `user_id` to `auth.uid()`, so board containment is data
  integrity rather than access control; a test asserts that state deliberately so the authorization
  cutover is a visible change rather than a silent one.
- Hardened the signup trigger, which now seeds settings, profile, board, and owner membership in one
  transaction: `search_path` is empty rather than `public` (so no unqualified name in its body can
  be shadowed), and EXECUTE is revoked from `PUBLIC`.
- Added an account-deletion trigger, which the new check constraint made mandatory rather than
  optional. `board_memberships.account_id` is `on delete set null` and the table requires a null
  `account_id` to sit on an ended row, so deleting an `auth.users` row otherwise failed with
  `Database error deleting user` for every account. The trigger ends memberships and drops private
  boards first, reads `old.id` rather than `auth.uid()` because deletion runs administratively, and
  carries the sole-owner-of-a-shared-board refusal that must already be correct on the day the first
  board is shared.
- Added a temporary trigger routing board-less task inserts to the account's single board, so the
  currently-deployed client keeps working. **Dropping it is the stale-client fail-closed mechanism**
  and belongs to the release that enables board creation; until then it is only correct because
  every account has exactly one board.
- Extended the nightly backup verification to assert the three board tables are in the data dump and
  that the schema dump defines the lifecycle functions. Both guard the same failure: a bundle that
  verifies clean and restores into a database where no task belongs to a reachable board, because
  `data.sql` disables triggers and foreign keys during load.
- No `app_private` schema yet, deliberately. Measured on a local stack: only the co-member predicate
  needs a security-definer helper (it recurses on its own table), a policy calling into a private
  schema requires the calling role to hold `USAGE` and `EXECUTE` or the query dies outright, and
  what actually keeps a schema off the Data API is `[api] schemas`, not schema `USAGE`.

## [1.2.75] - 2026-08-13

### Internal

- Added the security harness that the board-ownership work will be built against, ahead of any
  schema change. Four new database assertions: every realtime-published table is keyed on uuid only
  (the machine-checkable half of the publication rule — DELETE fan-out caps its payload at the
  primary key, so a `text` PK there would broadcast a meaningful value to every subscriber, and a
  published table with no PK stops delivering deletes at all), plus three strict-equality baselines
  recording today's posture: every function in `public` with its definer flag, `search_path`, and
  ACL; every schema reachable by the Data API roles, which is what will notice if the planned
  `app_private` schema is ever granted `USAGE`; and every policy that applies to `PUBLIC` because it
  names no role. Each baseline was verified to fail against a deliberately violated schema, not
  merely to pass against the current one.
- The three baselines record known weaknesses rather than a clean bill of health: `handle_new_user`
  is `security definer` with `search_path=public` rather than an empty path, both functions are
  EXECUTE-able by `PUBLIC` through PostgreSQL's default, and all seven legacy policies target
  `PUBLIC`. All are behaviourally safe today for reasons stated in the file, and each stops being
  safe at a known point in the board work. Nothing about production behaviour changed.
- Added `src/board/`: pure `BoardRole` → capability mapping and the Board command failure
  vocabulary (`last-owner`, `stale-revision`, `membership-ended`, `board-deleted`, `unknown`),
  modelled on the `authOutcome` seam. An unrecognized role grants nothing rather than defaulting to
  the least-privileged known role, since an unknown role means the client is older than the schema
  and any default invents an authority level nobody granted. These are UI affordances, explicitly
  not an authorization boundary — RLS remains the only one.

## [1.2.74] - 2026-08-13

### Internal

- Corrected the custom-labels roadmap item (4.2) to be board-scoped from its first migration —
  `labels.board_id`, never `labels.user_id`. The previous account-owned schema reads as the cheaper
  start and is not: boards force per-board labels, so it would be built, backfilled, and migrated
  again, with a window where a label's owner and its tasks' owner are separate columns that must
  agree — the same two-ownership-models trap that v1.2.73 removed from 6.2, one table over. The
  dependency between the two items is also inverted and narrowed: labels need only the
  `boards`/`board_memberships` foundation, not the whole boards epic, and are interleaved with it
  rather than sequenced before it. Noted the priority consequence explicitly: 4.2 is P2 and can no
  longer start before P3 work begins.

## [1.2.73] - 2026-08-13

### Internal

- Split the shared-boards roadmap epic into "multiple private boards" (6.2) and "shared /
  collaborative boards" (6.4), and replaced its data model. The previous entry proposed
  `tasks.board_id` with `NULL = personal board`; that preserves two task-ownership models
  indefinitely, so every reader, policy, realtime filter, snapshot, and export path would have to
  handle both forever. Containment is now a NOT NULL `board_id` with a backfilled board per account,
  and `board_memberships.role` ships from the first migration rather than being retrofitted under
  live policies. The split also moves the feature-flag dependency (5.4) off the private-boards work,
  which needs no gating, and onto sharing, which is the first change that reaches another person.

## [1.2.72] - 2026-08-12

### Internal

- Added compile-checked and interactive prototypes for dnd-kit's successor 0.5 API, preserving the
  existing pure reorder seam across desktop calendar and kanban moves, empty lanes, multi-hop drags,
  optimistic self-target drops, and filter-disabled dragging. The successor packages are pinned as
  development-only dependencies; the production adapter remains unchanged pending real-device iOS
  and Android long-press/scroll verification. (#156)
- Moved the Playwright E2E project and its authentication setup from the repeatedly crashing legacy
  Chromium headless shell to Playwright's regular Chromium build and new headless mode, while
  preserving the zero-retry CI policy.

### Docs

- Recorded the legacy-to-successor API map, browser verification evidence, compatibility gaps, and
  the exit criteria for a future production migration.

## [1.2.71] - 2026-08-12

### Internal

- **Dependency update:** `@testing-library/jest-dom` 7.0.0 → 7.0.1, completing the routine
  development-dependency update batch tracked in #155. No application behavior changed.

## [1.2.70] - 2026-08-12

### Fixed

- Patched the build-only `brace-expansion` dependency from 5.0.7 to 5.0.9 and its nested copy from
  2.1.2 to 2.1.4, resolving the reported denial-of-service advisories. No application dependency or
  source code changed. Closes #154.

## [1.2.69] - 2026-08-12

### Internal

- **Dependency update:** `pg` 8.22.0 → 8.23.0 (including `pg-protocol` 1.15.0 → 1.16.0).
  No application behavior changed. (#159)

## [1.2.68] - 2026-08-12

### Fixed

- Week view now uses the same themed scrollable grid as Calendar view, restoring the intended thin
  theme-matched scrollbar when its seven-day desktop layout overflows.

### Internal

- Removed unreachable drag-highlight branches and unused toolbar regions from the chrome styling
  interface, and added direct mobile layout coverage for Calendar, Week, and Board views. The
  responsive view modules remain separate because each concentrates a tested mobile layout fork.
  Closes #139.

## [1.2.67] - 2026-08-12

### Internal

- Replaced `Board`'s task-operation prop surface with a `TaskBoardContext` seam backed by
  `useTasks` in production and an in-memory adapter in component tests. `Board` now has four
  account-setting/navigation props, while card and add actions are consumed through an internal
  `BoardActionContext` instead of a handler bag relayed through every view. The raw React task
  setter is now private behind the narrower `previewReorder(next)` drag command. No application
  behavior changed. Closes #137.

## [1.2.66] - 2026-08-11

### Internal

- **Dependency updates:** `@types/pg` 8.20.4 → 8.21.0 and Supabase CLI 2.112.0 → 2.113.0.
  No application behavior changed. (#157)

## [1.2.65] - 2026-08-10

### Internal

- **Dependency updates:** `@types/node` 26.1.2 → 26.2.0 and Supabase CLI 2.111.0 → 2.112.0.
  No application behavior changed. (#153)

## [1.2.64] - 2026-08-10

### Internal

- Upgraded the project compiler from TypeScript 6.0.3 to the stable TypeScript 7.0.2 native
  compiler. The existing project-reference graph and compiler options remain compatible without
  source or configuration changes.

## [1.2.63] - 2026-08-10

### Internal

- Replaced ESLint completely with Oxlint and enabled `oxlint-tsgolint`'s TypeScript 7-powered
  type-aware rules. Oxlint now owns core, TypeScript, Hooks, React Refresh, and React Compiler
  diagnostics; the migration also fixed the newly exposed promise and unsafe-value findings,
  removed the TypeScript 7 Dependabot hold, added `lint:fix`, and kept Prettier unchanged.

## [1.2.62] - 2026-08-10

### Internal

- **Dependency updates:** `@supabase/supabase-js` 2.112.0 → 2.112.2, `@types/pg` 8.20.3 →
  8.20.4, and Vite 8.2.0 → 8.2.1. No application behavior changed. (#148)

## [1.2.61] - 2026-08-09

### Internal

- The ship workflow now evaluates every branch as a major, minor, or standard build release before
  computing the changelog version. It classifies the shipped compatibility and user impact rather
  than diff size, chooses the highest level in a mixed change, and requires confirmation before a
  new major or minor release line updates package metadata.

## [1.2.60] - 2026-08-09

### Internal

- **Deleting a task now passes only an id across the seam.** `TaskEditor`'s `onDelete` takes
  `(id, scope?)`, `Board` forwards it, and `useTasks.deleteTask` resolves the row from its own
  state. An unknown id is a no-op — which is what an already-deleted-elsewhere row looks like.
  Closes #132.
- That issue asked whether deleting should act on the edited draft or on the stored task, since the
  editor passed a whole `Task` and the two differ. Neither was chosen: both answers left the same
  hazard, because `onDelete(task: Task)` promised far more than the delete path uses — it reads only
  `id`, `recurParentId`, `recurOriginDay` and `day` — so any field read from it later would silently
  start depending on unsaved edits, with nothing failing. Narrowing the interface removes the
  question rather than answering it.
- It is also more correct than either option was: `initial` is not the stored row, because
  `Board.openTask` merges the template's `recurFreq`/`recurInterval`/`recurUntil` onto an instance
  before handing it to the editor.

**No behaviour changes**, user-visible or otherwise. The original bug was inert: of the four fields
the delete path reads, only `day` is editable in the modal, and it is reached only through
`instanceOrigin`'s `recurOriginDay ?? day` fallback — which `20260630130000_recur_origin_day.sql`
backfilled for every instance that had a day. This is a latent-hazard fix.

## [1.2.59] - 2026-08-09

### Fixed

- **A "this occurrence or all future?" prompt dismissed by going offline came back when the
  connection recovered.** The prompt was gated on `scopePrompt && !readOnly`, which hid it without
  clearing it, so reconnecting re-opened a prompt the user never re-triggered — in the middle of
  whatever they were doing next. The existing test only checked that it disappeared, so the return
  trip went unnoticed.

### Internal

- **The task editor's decisions are now a pure module.** `src/data/editIntent.ts` owns `cleanDraft`,
  `changedTaskKeys`, `onlyPerOccurrenceChanged`, `PER_OCCURRENCE_FIELDS`, and the two decisions the
  Save and Delete buttons make (`intendSave` / `intendDelete`). `series.ts` decides _which
  occurrences_ an operation touches; this decides _whether the editor may proceed at all_ and
  _whether it has to ask first_. Closes #138.
- Those functions were private to a 739-line `TaskEditor.tsx`, so all eight of its tests reached
  them by rendering the modal and clicking through with `userEvent` — and the fail-safe property
  documented on `changedTaskKeys` (drifting checklist key order must over-show the prompt, never
  suppress it) was asserted by nothing, because there was no way to call the function. It now has
  20 direct tests. Suite: 511 → 532.
- Two facts that were part of the editor's real interface but not its declared one now live in
  types: `onSave`'s scope is **definite** for a recurring instance (it used to be `undefined` on the
  per-occurrence-only path, and `Board` had to know that meant "this occurrence"), and `onDelete`
  receives `initial` rather than the edited draft.
- That second one — modal edits being discarded on delete — is **unchanged**. It is #132, which is
  still undecided; `intendDelete` now owns the decision with the tradeoff written down, and a test
  pins the current answer, so resolving it means changing one function and one test instead of
  hunting two call sites.
- `ScopePrompt` is its own component, and `editorChrome.ts` holds the palette and control styles it
  shares with the editor. It could not be extracted before: it read `panelBg`, `fg`, `border`,
  `sub`, `fieldBg` and `btn` straight out of the editor's closure. `TaskEditor.tsx`: 739 → 629 lines.

Aside from the prompt fix above, no user-visible behaviour changes.

## [1.2.58] - 2026-08-09

### Internal

- **The recurring-series model now lives in one module.** `src/data/series.ts` owns occurrence
  identity (`instanceKey`), instance construction (`makeInstance`, `pendingInstances`), scope
  resolution (`resolveSave` / `resolveDelete`), and a pure **plan** for each series operation — the
  next board, the next templates, the rows to upsert, the deletions to run, and the ids to mark as
  this client's own writes. `useTasks.runPlan` is the only effectful part left, and
  `src/data/recurrence.ts` becomes the pure date core underneath. Closes #135.
- The three scope operations were a 207-line block inside `useTasks` that **no test reached** —
  `deleteSeriesFuture`, the branchiest function in the data layer, had none at all — while the
  cheap date arithmetic in `recurrence.ts` had 22 tests. The decisions now have 30, covering
  skip-by-origin rather than by a dragged card's day, the whole-series delete branch resisting a
  card dragged before the anchor, and per-occurrence progress (`pinned` / `status` / `done`)
  surviving an all-future edit. Suite: 481 → 511 tests.
- `instanceKey` had been defined identically in `useTasks.ts` and `realtime.ts`, each with a comment
  claiming to mirror the `(recur_parent_id, recur_origin_day)` unique index. One definition now.
- `pendingInstances` takes the board as a **required** argument. It replaced a default that read a
  ref whose own docstring called it unsafe — `setTasks` writes that ref inside a deferred React
  updater, so passing it straight after a load makes every occurrence look missing and re-inserts
  rows that already exist (`23505`). Three of the four call sites took that default, untested.
- `FailureHandling` deliberately carries two independent fields (`abort` and `recover`), because the
  existing behaviour answered them independently: a failed content upsert aborts the trim that
  follows it, while a failed `recurSkip` write must _not_ stop the occurrence being deleted.
- `Board` loses three props and no longer encodes any recurrence rule — including stripping the rule
  fields on the this-occurrence save path, which had been enforced by a comment. `useTasks` exposes
  `saveTask(orig, draft, isNew, scope)` and `deleteTask(task, scope)` in place of the five members
  the editor used to need, and `RecurScope` moved to the data layer that acts on it.
- Template rows in the delete plans are now written by the same upsert batch as everything else,
  where they had been a lone `.update().eq()`. `updateSeries` already upserted its template, so this
  makes one path out of two rather than introducing a new one.

No user-visible behaviour changes.

## [1.2.57] - 2026-08-09

### Fixed

- **Settings stopped syncing across devices after a dropped connection, and never recovered.**
  `useSettings` subscribed to realtime but had no reconnect path at all — its entire subscription
  tail was `.subscribe()`, with no status callback, no backoff, and no `visibilitychange`/`online`
  catch-up. A settings channel that errored (typically after a phone slept) stayed dead for the
  rest of the session while the board kept syncing happily, so theme, default-view, week-start and
  timezone changes made on another device silently stopped arriving, with nothing on screen to say
  so. The board hook had all of this; the docs described the two as symmetric. Closes #130.
- A signed-out visitor no longer fires a `tasks` select. `useTasks.reload` had no `userId` guard
  (the settings side has had one since it was hoisted above `<Routes>`), so the public landing page
  issued a query that RLS answered with an empty array.

### Internal

- **Realtime sync is now one module rather than two divergent copies.**
  `src/data/useSyncedTable.ts` owns the per-user `postgres_changes` channel, echo suppression for
  this client's own writes, reconnect with capped exponential backoff, and tab/network catch-up.
  `useTasks` and `useSettings` are its two adapters. Closes #134.
- Echo suppression had diverged into two schemes with two TTLs — a per-id `Map` at a named 5000 ms
  in one hook, a single timestamp against a bare `3000` in the other. There is now one registry
  (`useOwnWrites`) with one TTL.
- The `userId`-reads / `hasSession`-writes rule is now `canPersistSnapshot()` in
  `src/data/snapshot.ts`, with a docstring explaining why each of its five clauses is load-bearing.
  It previously had two implementations and three prose copies, one of which passed the rule as a
  positional boolean argument named `persistSnapshot`.
- Newly testable, and previously unreachable in _either_ copy because both test mocks fired
  `'SUBSCRIBED'` unconditionally: the backoff curve and its 30 s cap, reconnect after
  `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`, backoff reset after a successful resubscribe, a backoff
  timer firing after unmount, `visibilitychange` catch-up, and own-write TTL **expiry** — the old
  suppression test only proved the inside-TTL case, so a registry that never expired would have
  passed. Suite: 461 → 481 tests.

## [1.2.56] - 2026-08-09

### Internal

- **Every drag-and-drop decision now lives in a pure module.** `src/dnd/resolveDrop.ts` holds
  `modeForView`, `containerOf`, `isBelowOver`, `insertionIndex`, and a `resolveDrop` session
  reducer that accumulates the touched lanes and `didMove`; it imports nothing from
  `@dnd-kit/core`. `src/dnd/useBoardDnd.ts` is reduced to sensors, event mapping, and React state,
  and `src/dnd/reorder.ts` keeps only the splice math. The seam had been drawn at "pure vs impure"
  rather than "hard vs easy", so the thoroughly-tested half was the trivial half. Closes #136.
- Removed `findContainer` and `reindex` from `src/dnd/reorder.ts`. Neither had a production call
  site, and between them they carried 7 of that file's 17 tests. `findContainer` also _disagreed_
  with the shipped inline copy in the wiring: it returned `undefined` for an id matching no task,
  where the real rule returns the id itself — which is the only reason dropping onto an empty lane
  works, since dnd-kit registers an empty lane as a droppable whose id is the lane.
- Newly covered, none of it previously tested: the empty-lane container fallback, the
  unmeasured-rect "insert above" default, all three `insertionIndex` branches, the within-lane
  reorder that settles on drop, multi-hop touched-lane accumulation across three lanes, `agenda`
  mapping to `'day'`, and `didMove` surviving an event that resolves to no move. Suite: 444 → 461
  tests.
- Documented in `AGENTS.md` why `useBoardDnd` must receive the **unfiltered** board: passing
  `visibleTasks` would hand contiguous `0..n-1` indices to the visible tasks in a touched lane
  while hidden ones kept theirs, colliding orders rather than merely narrowing the drag.

No user-visible behaviour changes; the `BoardDnd` interface is untouched and `Board.tsx` is
unchanged.

## [1.2.55] - 2026-08-09

### Changed

- **The auth pages no longer call `supabase.auth` — `src/auth/authGateway.ts` is now the only
  module that may.** Seven of the ten call sites lived in `Login`, `ResetPassword`, and
  `AuthConfirm`, which is why the refuse-to-redeem guard had three encodings, the error policy
  four, and the redirect rule five. Every `AuthGateway` method resolves an outcome and never
  rejects, and no GoTrue error type crosses the seam: `src/auth/authOutcome.ts` maps stable
  `error_code`s to an `AuthFailureReason` union this app owns, keeping the vendor's own text only
  for codes it doesn't recognize. Closes #133.
- **Sign-in, sign-up, and reset failures now render this app's copy instead of raw GoTrue strings**
  ("Invalid login credentials" → "That email and password don't match an account."). The
  bad-credentials message deliberately does not distinguish email from password, so the form can't
  be used to enumerate accounts.
- `AuthProvider` takes the gateway as an injectable prop and exposes the auth actions on its
  context; its value object and action identities are now memoized rather than rebuilt each render.
- The password policy (minimum length and the rule sentence) moved to `src/auth/passwordPolicy.ts`.
  It was duplicated across `Login` and `ResetPassword`, the second carrying a comment noting it was
  a copy of the first.

### Fixed

- **A password-reset or signup-confirmation link that couldn't reach the server left the page on a
  spinner forever.** Neither `verifyOtp` call site had a `.catch`, so a rejected fetch was an
  unhandled rejection — and because the single-use token is scrubbed from the URL before
  redemption, a reload couldn't recover either. Both pages now distinguish "couldn't reach the
  server — your link hasn't been used" from "invalid or expired", which are very different
  instructions for the user. Closes #131.
- `ResetPassword` told a signed-in visitor arriving with **no link at all** that "this reset link
  wasn't used". The refusal copy now splits on whether a link was actually present.
- `?token_hash=` (empty value) counted as a token in one branch and as no token in another, so the
  page could refuse a link it simultaneously reported as missing.
- A failed `getSession()` used to leave `AuthProvider` loading forever, stranding the whole app on
  a spinner; it now degrades to signed-out.

### Internal

- Auth page tests render the **real** `AuthProvider` with `fakeAuthGateway()` (the second adapter
  at the seam) instead of hand-built `vi.mock` factories shaped like each page's call list —
  `Login.test.tsx` had been stubbing 3 of the auth context's 6 members while its siblings stubbed
  6, with nothing to catch the drift.
- `verifyOtpContract.test.ts` moved from `src/lib/` to `src/auth/`, beside the `redeemToken` method
  whose ordering contract it pins, and now imports `GoTrueClient` from `@supabase/supabase-js`
  rather than the undeclared transitive `@supabase/auth-js`.
- Suite grows from 406 to 444 tests, including a pure decision table for the session-fixation guard
  and a gateway suite asserting that no action rejects.

## [1.2.54] - 2026-08-08

### Docs

- Added `docs/agents/` (`issue-tracker.md`, `triage-labels.md`, `domain.md`) plus an `## Agent
skills` section in `AGENTS.md`, configuring where third-party Claude Code skills such as
  `triage`, `to-tickets`, and `to-spec` read and write: GitHub Issues on this repo via the `gh`
  CLI, the default five-role triage label vocabulary, and a single-context `CONTEXT.md`/`docs/adr/`
  layout for domain docs (neither exists yet — created lazily by `/domain-modeling`). No app
  behavior, commands, or architecture changed.

## [1.2.53] - 2026-08-07

### Changed

- **Skills now sync `.agents/skills/` → `.claude/skills/`, the opposite direction from before.**
  A skills-sync installer had started writing real skill files straight into `.agents/skills/<n>/`
  and symlinking `.claude/skills/<n>` back to them, which broke two ways at once: the sync script's
  directory walker reports a symlinked directory as `isSymbolicLink()`, not `isDirectory()`, so it
  silently treated each linked skill as a single file and crashed reading it as one (`EISDIR`); and
  `git config core.symlinks` is `false` on a stock Windows checkout, so `git add` on a symlinked
  skill walks through it and stages the target's file contents under the link's path, duplicating
  every byte instead of recording a link. `.agents/skills/` is now the authored tree (where the
  installer already writes) and `.claude/skills/` is generated from it — matching how subagents
  already work in the other direction (`.claude/agents/` authored, `.codex/agents/` generated). The
  previously-symlinked `ship` skill's authored copy moved to `.agents/skills/ship/` accordingly.
- `scripts/sync-codex.mjs`'s directory walker now throws immediately on any symlink it finds, in
  either generated tree, instead of reproducing either failure mode above.
- A generated `SKILL.md`'s "do not edit" banner moved from a line of prose after the frontmatter to
  a YAML comment on line 2 of the frontmatter itself (line 1 stays `---`), and
  `scripts/sync-codex.mjs`'s minimal frontmatter parser now tolerates `#` comment lines to match.

### Internal

- `.prettierignore` now lists `.codex/` and `.claude/skills/` as generated trees, alongside the
  existing `.claude/ is authored` note in AGENTS.md.

## [1.2.52] - 2026-08-07

### Internal

- **Dev-dependency bumps** (Dependabot, `npm-minor-and-patch` group): `@testing-library/user-event`
  14.6.1 → 14.6.3, `typescript-eslint` 8.65.0 → 8.66.0. No runtime dependencies changed. (#126)

## [1.2.51] - 2026-08-06

### Internal

- **Dependency bumps** (Dependabot, `npm-minor-and-patch` group): `@supabase/supabase-js` 2.111.0 →
  2.112.0 (runtime), `globals` 17.8.0 → 17.9.0 (dev). (#125)

## [1.2.50] - 2026-08-04

### Internal

- **Dev-dependency bump (transitive):** `fast-uri` 3.1.4 → 3.1.5, pulled in via `ajv`. No direct
  dependency changed. (Dependabot, #124)

## [1.2.49] - 2026-08-04

### Internal

- **Dev-dependency bump:** `@playwright/test` 1.62.0 → 1.62.1 (Dependabot, `e2e-toolchain` group).
  (#122)

## [1.2.48] - 2026-08-04

### Internal

- **Dependency bumps** (Dependabot, `npm-minor-and-patch` group): `supabase` CLI 2.110.0 → 2.111.0,
  `@types/pg` 8.20.0 → 8.20.3, `@types/react` 19.2.17 → 19.2.18, `@types/react-dom` 19.2.3 →
  19.2.4, `@vitejs/plugin-react` 6.0.4 → 6.0.5, `vite` 8.1.5 → 8.2.0 — all dev tooling. No runtime
  dependencies changed. (#123)

## [1.2.47] - 2026-07-31

### Fixed

- **Accessibility: every text colour in the app now meets the WCAG AA contrast standard.** This
  clears all 16 remaining `color-contrast` findings from the a11y baseline, in two passes. First,
  three imperceptible near-miss nudges: the brand purple darkens slightly (`#7c5cff` → `#7452ff`,
  fixing the landing call-to-action, the sign-in button, and the Aurora view switcher), Corkboard's
  secondary toolbar text gets a touch more opacity, and the inbox Privacy/Terms links a touch more
  ink. Second, the genuinely-failing colours: Neon's accent red darkens (`#FF4D2E` → `#CD4128`) so
  its white button text reads, its today number becomes a brighter red on the yellow cell, its
  out-of-month day numbers switch from faint brown to a readable neutral (they were at barely half
  the required contrast), blue task cards darken so their white ink reads, and the inbox hint text
  darkens. Aurora's today number becomes a lighter purple that reads against the dark cell. Every
  new value was computed against the WCAG formula with margin, not eyeballed.

### Changed

- Today's day number gets its own theme token (`numTodayFg`) instead of reusing the accent: the
  accent doubles as a button background under white text, and the two roles pull in opposite
  contrast directions (Neon needs a brighter red for the number than the button; Aurora needs a
  lighter purple).
- The nine `nested-interactive` findings (the drag wrapper's `role="button"` around each card's pin
  and done buttons) are recorded as an **accepted violation**: the two remedies were evaluated and
  declined for now, and the reasoning lives in the `tests/e2e/a11y.spec.ts` header. The a11y
  baseline now holds only those three entries.

## [1.2.46] - 2026-07-30

### Fixed

- **The sign-in, password-reset and confirm-email pages no longer overflow sideways on a phone.**
  The wordmark was pinned to a fixed height with no way to shrink, so it was wider than its own card
  at every screen size and pushed the page 59px past a 390px viewport. The logo is now fluid; it
  renders about 10% smaller on a desktop, where it had been overflowing its card.

### Changed

- `color-contrast` findings now log the colours behind them (`#8a8a8a on #f4e4c1 — 2.9:1`), so a
  failure says which colours to fix rather than only where. The a11y baseline format is unchanged.
- `npm test` now checks that every surface the a11y suite claims to scan has a real test behind it.
- `tests/e2e/smoke.spec.ts` now asserts that no public route overflows horizontally at phone width.

## [1.2.45] - 2026-07-30

### Fixed

- **Accessibility: every page now has landmarks and a level-one heading.** The board exposes
  `banner` / `search` / `main` / `complementary`, the two filter selects and the search box have
  accessible names, and the login, settings and legal pages have a `main` landmark. This clears 177
  of the 202 violations the a11y baseline recorded.
- The settings page was never actually being scanned for accessibility — the check raced the page
  load and measured the loading spinner, which axe treats as an open modal and therefore exempts
  from the page-level rules.

### Changed

- The a11y baseline records per-surface, per-rule counts instead of CSS selector paths, so it is no
  longer invalidated by unrelated UI changes (810 lines to 42). Counts are asserted by strict
  equality: a count that falls means the baseline is stale and the lower number should be committed.
- `@axe-core/playwright` and `@playwright/test` are isolated in their own Dependabot group.

## [1.2.44] - 2026-07-30

### Security

- **The end-to-end test debugging files are now encrypted before they are uploaded.** When one of
  those browser tests fails, it saves a recording of the run to help diagnose it. That recording
  turned out to include the login token for the dedicated test account, written out in full — and
  because this repository is public, anything the build uploads can be downloaded by anyone. The
  exposure was small (the token stops working after an hour, and it only ever had access to that one
  throwaway test account, never to anyone's real data), but a working credential should not be
  sitting in a world-readable file at all. The recording is now scrambled with a password before it
  leaves the build, the same way the nightly database backups have been since v1.2.25. If that
  password is missing the recording is **discarded rather than uploaded**, so the failure mode is
  losing a debugging aid instead of leaking a credential.

## [1.2.43] - 2026-07-29

### Internal

- Every pull request now loads the real deployed site in a browser and checks that it still works.
  Until now the automated tests all ran against mocks, which meant a whole class of problem was
  invisible: anything that only breaks on the real hosting. That is not hypothetical — the bug that
  silently replaced the site's fonts with system defaults shipped **twice**, because it cannot be
  reproduced locally and only affects people on their _second_ visit. The new checks catch it, along
  with sign-in, creating a task and having it survive a reload, and the board still rendering from
  its saved copy when the server cannot be reached.
- Added an accessibility check to the same run. It scans six screens — the landing page, sign-in,
  settings, and the board in all three themes — and records the 202 issues that exist today so it
  can flag anything **new**. Fixing the existing ones is deliberately separate work; this stops the
  count growing in the meantime.

## [1.2.42] - 2026-07-29

### Security

- Closed a latent hole in how new database tables get exposed. The database was still carrying a
  rule, inherited from an older Supabase default, that automatically granted read **and write**
  access on every newly created table to both signed-out visitors and any signed-in account. No
  existing data was ever exposed — every current table is protected by row-level security — but
  any table added in future would have arrived wide open, with nothing preventing a leak except
  remembering to switch that protection on. New tables are now unreachable until access is
  granted deliberately, which fails loudly instead of silently.
- Added a test that creates a real table and checks what access it lands with, so the protection
  above cannot quietly regress.

## [1.2.41] - 2026-07-29

### Docs

- Corrected three claims left over from the RLS test work. The grants migration said production's
  privileges had been confirmed, when only a local stack was ever inspected — and cited
  `pg_default_acl`, which is a template consulted when a table is created and grants an existing
  table nothing. Whether production still carries permissive default-ACL entries from before the
  Data API change is now recorded as an open question in the roadmap, because the CI job cannot
  answer it: that job always builds a fresh database, whose defaults are already restrictive.
- The roadmap said the `RLS` job had never run. It ran on the previous release and passed, so the
  remaining step is promoting it to a required check.

## [1.2.40] - 2026-07-29

### Internal

- Row-Level Security — the only thing isolating one account's tasks and settings from another's —
  now has automated tests. They run against a real local Postgres, covering cross-user isolation,
  forged ownership on insert and update, anonymous access, and four schema-wide checks that fail
  if any future table ships without RLS, without a policy, or without its Data API grants.
- Data API grants are now explicit in a migration. Supabase is retiring the compatibility setting
  that auto-exposed new tables on 2026-10-30; without this, any table added after that date would
  have been unreachable by the app despite correct RLS policies.

## [1.2.39] - 2026-07-29

### Internal

- **`jsdom` (dev) 29.1.1 → 30.0.1.** (#103)

## [1.2.38] - 2026-07-29

### Internal

- **`@supabase/supabase-js` 2.110.8 → 2.111.0.** (#110)

## [1.2.37] - 2026-07-28

### Fixed

- Returning visitors were being served the site in fallback system fonts. The service worker's
  request for the Google Fonts stylesheet was blocked by a too-narrow `connect-src`, and because
  the worker's cache-first path had no failure fallback, the whole stylesheet failed for every
  page it controlled. First-time visitors never saw it — the worker only takes over from the
  second visit onward, which is why it survived a preview-deploy check.
- The service worker now degrades instead of breaking when it cannot fetch a cacheable asset: it
  retries the cache ignoring the query string, then gives up on that one asset rather than failing
  the page.
- Cloudflare Web Analytics now actually collects. Its injected beacon had been blocked by
  `script-src` since it was enabled, so it had never reported anything.

## [1.2.36] - 2026-07-28

### Added

- Settings → Dates: choose which day your week starts on (Sunday, Monday, or Saturday) and set your
  timezone. The timezone decides which day counts as "today" for the board's today highlight,
  overdue badges, and roll-forward; "Automatic" follows whatever browser you are on.
- Exported backups now include the week start and timezone alongside the theme and default view, so
  a downloaded file is a complete record of your settings. Import is unchanged — it still restores
  tasks and repeating series only.

### Fixed

- A board left open across midnight now rolls over to the new day on its own instead of keeping
  yesterday highlighted until a reload.
- The week view's weekday labels are derived from each cell's real date, so they stay correct when
  the week does not start on Sunday.

## [1.2.35] - 2026-07-27

### Fixed

- **Firefox rendered a bulky, unthemed platform scrollbar inside day cells, the inbox, and kanban
  columns.** The app's only scrollbar styling was the `::-webkit-scrollbar` block in `index.css`,
  which is a webkit/blink pseudo-element that Firefox ignores outright — so every scrollable
  surface fell back to the OS default, light and heavy against a dark board and matching no theme.

  Scrollbars are now themed the same way as everything else: `scrollbars(conf)` in
  `theme/chrome.ts` sets the **standard** `scrollbar-width: thin` and a per-theme
  `scrollbar-color`, and is spread into every container that can overflow — the month grid, a day
  cell's note list, the inbox list, a kanban column, and the two mobile-only scrollers in
  `WeekView`/`CalendarView`. Standard properties are expressible in an inline style object, so this
  fits the existing inline-style theming rather than working around it, and the new `scrollThumb`
  token gives each theme its own thumb (warm ink on cork, flat near-black on brutal, cool light on
  glass) instead of one shared grey.

  The `::-webkit-scrollbar` rules stay as a fallback for engines without standard support (Safari
  < 18.2, Chrome < 121). Where both are understood the standard properties win, so on a current
  browser the thumb is now theme-coloured rather than the old fixed grey, and one pixel wider.

  Worth recording, since it was the reported suspicion: the scrollbars **appearing** is not new and
  was not caused by the public landing page. `overflow: auto` on a day cell's note list dates to the
  original calendar-view commit, and the landing-page change touched no board sizing file — its only
  `TaskCard` edit swaps a `<button>` for a `<span>` when no handler is passed, which the real board
  never does. Two cards exceeding a fixed-height month cell has always scrolled; only the styling
  was broken.

## [1.2.34] - 2026-07-27

### Added

- **Installable, offline-readable PWA.** The app now has a web manifest (name, standalone display,
  a maskable icon) and a hand-authored service worker, so it can be added to a phone's Home Screen
  and still shows your board with no network. `vite-plugin-pwa` runs in `injectManifest` mode —
  workbox ships nothing at runtime; every caching rule in `src/sw.ts` is code we wrote and can
  reason about. **Navigations are network-first, always**: a service worker is the one deployed
  artifact a merge to `main` can't reach directly, and cache-first navigation would let a bad
  deploy make itself permanent on any device that had already installed the worker. Only
  content-hashed build assets and the two Google Fonts hosts are cache-first. `*.supabase.co` is
  never written to any cache, over `https` or `wss` — a cache is a bucket shared by every profile
  on the device, and caching an authenticated response would leak one user's data to the next
  (`src/sw/policy.ts`, unit-tested in `src/sw/policy.test.ts`, since `src/sw.ts` itself can't run
  under jsdom).

  Offline read is a last-known snapshot, not a live sync: `src/data/snapshot.ts` keeps two
  versioned `localStorage` envelopes (board — tasks, hidden recurrence templates, `savedAt`; and
  settings), each keyed to the signed-in user id and cleared on sign-out. `useTasks` writes the
  board snapshot after every successful server load and, on a **failed** load, hydrates from it
  read-only — deliberately skipping recurrence `materialize()`, since replaying it against
  snapshot data would insert duplicate instances and hit `tasks_recur_instance_uniq` (Postgres 23505) the moment the real load succeeds. `useSettings` falls back to its own snapshot on a
  failed load rather than silently resetting the theme to defaults. While hydrated from a
  snapshot, the board is read-only (an offline banner; drag, add, and per-card done/pin are all
  disabled) via a small `OfflineContext`. A new-version toast (`UpdatePrompt`) offers a waiting
  worker without ever auto-reloading a tab out from under someone.

  Rollback path if a bad worker ever ships: `docs/runbooks/service-worker-rollback.md`.

### Fixed

Several defects surfaced during implementation, all found by writing tests or by review before
merge — worth recording because they show what "offline read" actually required, beyond the
service worker itself:

- **The offline fallback was wired to `ProtectedRoute`, which never guards the board.**
  `ProtectedRoute` wraps only `/settings`; the board lives at `/` behind `HomeRoute`, which makes
  its own `session ? <BoardPage/> : <Landing/>` decision and never consulted the offline branch at
  all. The feature was inert at the one route it exists for until `HomeRoute` got the same
  `!online && !passwordRecovery && hasBoardSnapshot(...)` branch, in the same relative order as its
  existing password-recovery guard — the two guards must stay mirrored or this regresses silently
  again.
- **`BoardPage` and `SettingsPage` both re-derived their own gate from `session`/`user`,** which is
  `null` on exactly the offline-boot path `ProtectedRoute`/`HomeRoute` now admit. `BoardPage` spun
  on its loading spinner forever instead of showing the hydrated snapshot; `SettingsPage`'s `!user`
  check did the same. Both now gate on a resolved `userId` (the session id, else
  `readLastUserId()`) — the id the data layer already keys off — instead of re-answering "are we
  signed in" a second time.
- **A stale `ma-last-user` widens what a signed-out visitor's landing-page mount does.**
  `SettingsProvider` sits above the router so `/` and `/settings` share one settings fetch and
  channel; its no-op guard on an empty `userId` only covers a visitor who never signed in on this
  device. Someone whose session vanished without a `SIGNED_OUT` event (the exact case this feature
  exists for) still has a remembered id, so returning online while still signed out now fires a
  `user_settings` query and opens a realtime channel from the public landing page. Not a leak — RLS
  scopes both to rows the caller owns, and an unauthenticated request returns nothing — but a real,
  deliberate behavior change from what the code comment used to claim, corrected and pinned by
  tests.
- **The `SIGNED_OUT` snapshot/last-user clearing — the privacy justification for storing task text
  at rest — had no test.** It works, but nothing would have caught a future refactor dropping it.
  Extended `AuthProvider.test.tsx` to assert both snapshot envelopes and `ma-last-user` are gone
  after sign-out.
- **`ProtectedRoute`'s offline branch didn't check `passwordRecovery`.** A lingering recovery flag
  from an interrupted flow could in principle ride the offline branch straight to the board,
  bypassing the "set a new password first" guard. Closed with the same `!passwordRecovery` check
  `HomeRoute` needed anyway.
- **The precache manifest can list `index.html` and `/index.html` as two different strings.**
  `vite-plugin-pwa`'s injected manifest emits root-relative URLs with no leading slash; deduping the
  precache list on the raw strings missed that `"index.html"` and the worker's own `SHELL` constant
  (`"/index.html"`) resolve to the same request, and `cache.addAll` throws `duplicate requests` on a
  batch containing two entries that resolve identically — failing `install` on every load. Fixed by
  resolving every entry to an absolute URL before deduping.

### Docs

- New living runbook: `docs/runbooks/service-worker-rollback.md` — how to recognize a stuck
  worker, the kill-switch worker that clears every cache and unregisters itself, how to ship it, how
  to confirm recovery, and the honest limit (a tab that never revisits keeps the old worker forever).
- `AGENTS.md` gained an Architecture subsection on the PWA/offline subsystem: the worker is
  authored, not generated; why navigations are network-first; the never-cache-Supabase rule and
  where its test lives; the `/sw.js` CSP scope; the two snapshot envelopes and sign-out clearing;
  and `tsconfig.worker.json` as a third project-reference sibling.
- `README.md` now mentions installability and offline read in the feature list.
- ROADMAP.md: item 3.1 (installable PWA + offline read) has shipped — removed from the Phase 3 list
  and the build-order table, recorded in the header paragraph alongside 5.1/5.2/5.3 and 5.7. Item
  3.2 (reminders) now depends on 4.1 only.
- Flagged for the next dated review in `private/`, not fixed here: storing task text at rest in
  `localStorage` (mitigated by clearing it on sign-out) is a new position for this app and belongs
  in the accepted-risk record, argued, rather than only inside this PR.

## [1.2.33] - 2026-07-27

### Docs

- **Audited `ROADMAP.md` against the code and corrected three sketches that had drifted from the
  repo they describe.** Every remaining item is genuinely unbuilt — that part held — but the
  implementation notes had aged badly in ways that would have misled whoever picked them up:
  - **6.1 (iCal feed)** planned to add "a new `Functions Test` CI job". That job already exists:
    `ci.yml` runs `deno test` from inside `supabase/functions`, and it is already required.
  - **5.6 (custom auth domain)** read "blocked on the Supabase plan decision". The decision was
    priced on 2026-07-26 — Pro at $25/mo plus a $10/mo per-project add-on — and went the other
    way: the nightly encrypted `pg_dump` shipped in v1.2.25 bought back Pro's strongest benefit
    for nothing. It is deferred **by** decision, not awaiting one.
  - **4.1 (week-start & timezone)** claimed "dates are effectively UTC today". They are
    browser-local: `lib/dates.ts` builds every `YYYY-MM-DD` from `getFullYear`/`getMonth`/
    `getDate` and `parseDay` returns a local `Date`, so a single-device user is already correct.
    What is actually missing is a _stored_ timezone, which is what the server-side reminder
    sender in 3.2 needs — an Edge Function has no browser to ask.

- **Two real gaps were tracked nowhere and are now roadmap items.**
  - **4.8, two-factor (TOTP) enrollment UI.** `supabase/config.toml` has `enroll_enabled` and
    `verify_enabled` true in production while nothing in `src/` calls `supabase.auth.mfa.*` — a
    capability live on the server that the app cannot reach. Needs no config change.
  - **5.8, leaked-password protection (HIBP).** The one open finding from the security reviews,
    previously visible only in the git-ignored `private/` directory, so the public roadmap implied
    it did not exist.

- **`AGENTS.md` had drifted the same way.** It described three board views where `ViewName` has
  four (calendar, week, agenda, kanban), omitted the `Landing` page shipped in v1.2.28, and still
  said `BoardPage` wires `useSettings(userId)` — v1.2.32 moved that to a `SettingsProvider` above
  `<Routes>`, with `useTasks` deliberately left un-hoisted so `BoardPage` stays lazy and keeps
  dnd-kit out of the entry chunk.

## [1.2.32] - 2026-07-27

### Changed

- **Settings load once per session instead of once per route.** `useSettings` was called
  independently by `BoardPage` (`/`) and `SettingsPage` (`/settings`). Those routes are mutually
  exclusive, so every navigation between them unmounted the hook: settings were refetched, the
  realtime channel was torn down and rebuilt, and — because both pages gate on `loading` with a
  full-page spinner — each trip to settings flashed one. A `SettingsProvider` mounted above
  `<Routes>` now owns that state, so there is one fetch and one channel per session and no spinner
  on the way to settings.

  Returning to the board still shows `Loading your board…`. `useTasks` is deliberately **not**
  hoisted alongside it: `BoardPage` is lazy-loaded precisely to keep dnd-kit and the board data
  layer out of the entry chunk, and lifting `useTasks` up would pull them back in.

  Because the provider sits above the router, it also mounts for signed-out visitors — so
  `useSettings` now no-ops on an empty `userId`. Without that guard every visitor to the public
  landing page would have fired a `user_settings` query for `user_id = ''`. A test pins it, along
  with the single-fetch/single-channel behaviour and the "used outside the provider" error.

  Measured cost: the settings hook moves out of the two lazy page chunks and into the entry chunk,
  which grows 465.7 → 467.3 kB (+0.5 kB gzip). `BoardPage` is unchanged at 90.6 kB.

### Docs

- The public-landing-page spec still read "Approved, not yet implemented" four versions after it
  shipped. It now records v1.2.28 and the v1.2.29 follow-ups.

## [1.2.31] - 2026-07-27

### Fixed

- **The restore runbook was wrong in six places, found by rehearsing it for the first time.** The
  nightly backup itself has been verified since v1.2.27, but the restore had only ever been read. It
  was executed end to end twice against backup run `30265510548` — into a local `supabase start` stack
  and into a throwaway hosted project. Both reached counts matching production with every integrity
  check clean, but not before the file failed in ways that would each have cost time during an outage:

  - **The documented connection host cannot be reached.** `db.<ref>.supabase.co` is IPv6-only —
    Supabase publishes no `A` record for it — so step 3 died on its first command with `could not
translate host name`. The runbook now connects through the Session pooler
    (`postgres.<ref>@aws-0-<region>.pooler…:5432`) and explains why it must be the session pooler and
    not the transaction one: replica mode is a session setting and the load is one transaction.
  - **Restoring `schema.sql` silently omits `on_auth_user_created`.** That trigger sits on
    `auth.users` and the bundle's schema dump is `public`-only, so the primary documented path built a
    database that passed every check the runbook listed while giving **new signups no `user_settings`
    row**. Existing users would have looked fine; only later registrations would break. Confirmed by
    probe insert on real infrastructure, and the fix is now spelled out with the DDL.
  - **Verification never checked that RLS survived.** RLS is the only authorization boundary in this
    app, so a restore that dropped it would be a security incident that the row counts and both orphan
    queries reported as clean. Step 4 now asserts `relrowsecurity`, the policy count, and the trigger.
  - **The circular foreign key was mis-stated as a restore hazard.** It is not one: the CLI emits a
    single multi-row `INSERT` per table, and foreign keys are `AFTER … FOR EACH ROW` triggers queued to
    end of statement, so row order within it cannot matter. Verified by forcing a recurrence template
    onto the statement's final line at 5,064 rows with replica mode off — it restored cleanly. The
    other stated reason, the `on_auth_user_created` settings-row collision, **is** real and was
    reproduced.
  - **`data.sql` sets and resets replica mode itself** — line 1 and a closing `RESET ALL` — which makes
    the runbook's `-c "SET …"` redundant. It is kept for visibility, now labelled as such, with a
    warning never to strip line 1.
  - **The privilege fallback was incomplete.** Because that `SET` lives inside `data.sql`, a refusal
    aborts the load from within the file, so the advice to drop the trigger and retry would not work
    without also stripping line 1. The privilege itself is fine — `postgres` reports `usesuper = f`
    and the `SET` still succeeds — now verified rather than asserted parenthetically.

  Three further notes went in: the prerequisites do not hold on Windows as written (`gpg` ships with
  Git for Windows and is missing from PowerShell's `PATH`; `psql` need not be installed at all, since a
  `postgres:17` container works and is how this was rehearsed), the `orphan_recur_parents` check is
  **vacuous** on current data because production holds no recurrence rows, and the passphrase in the
  maintainer's password manager does open the bundle — something previously proven only inside CI.

### Docs

- `AGENTS.md` gave the `tasks.recur_parent_id` self-reference as a reason restores need triggers
  disabled. It is not one, and that paragraph now carries the three corrections the rehearsal produced,
  including the `schema.sql` trigger gap and the IPv6-only host.

## [1.2.30] - 2026-07-27

### Fixed

- **`/robots.txt` served robots directives followed by an entire HTML document.** There was no
  `robots.txt` in `public/`, and `_redirects` rewrites every unmatched path to `index.html` with a
  200 — so Cloudflare's managed Content Signals block was prepended to the SPA shell and the two
  were served as one file. Crawlers ignore unparseable lines, so the directives still applied
  (`User-agent: * / Allow: /` — Googlebot was never blocked), but the response was not a valid
  robots.txt. A real file now exists, and it disallows the `/auth/` token-redemption routes, which
  have nothing worth indexing.

  Found while investigating why Google's OAuth branding verification kept failing. It was **not**
  the cause — Googlebot is allowed and the home page serves its full content, name, and purpose to
  a crawler — but a `/robots.txt` that returns markup is a defect regardless of what prompted the
  look. The same catch-all means any unmatched path returns 200 with the SPA shell rather than a
  404; that is deliberate for client-side routes, but worth knowing when adding files crawlers
  fetch by convention.

## [1.2.29] - 2026-07-27

### Fixed

- **The landing page was invisible to anything that doesn't run JavaScript.** This app is a
  client-rendered SPA, so the served `<body>` is an empty `<div id="root">` — every word of v1.2.28's
  landing page arrives only after the bundle executes. A crawler that doesn't evaluate JS therefore
  saw a blank page, which is indistinguishable from the two failures the landing page was built to
  fix ("your home page is behind a login page" and "does not explain the purpose of your app").
  `index.html` now ships a `<noscript>` block carrying the app name, the purpose, and links to sign
  in, Privacy, and Terms. No visual change for real users; the built HTML now contains the app name
  and the purpose sentence as static text.

- **The app name appeared nowhere on the page as text.** Google also rejected the site because the
  OAuth consent screen's app name didn't match the home page's. It couldn't have: the header logo is
  an `<img>`, so "Magic Agenda" existed only as an `alt` attribute and a footer copyright line — and
  the wordmark inside that SVG renders lowercase "magic agenda" where the DOM can't read it at all.
  The header now shows the icon mark beside **Magic Agenda** as real text, matching the configured
  app name exactly, and the hero sentence names the app so the name and the purpose are stated
  together. A test pins it.

### Docs

- The landing-page spec's follow-up predicted that any remaining verification failure would be
  domain ownership rather than page content. That was wrong, and the entry now says so along with
  what the real gaps were — including the escalation if content is still the problem next time
  (pre-render the route at build time, rather than adding more meta tags).

## [1.2.28] - 2026-07-27

### Added

- **`magicagenda.app` has a front door.** Signed out, `/` was a login wall — which is exactly why
  Google's OAuth branding verification fails: the home page didn't explain what the app is. It now
  renders a landing page with the headline, what the product does, the feature list, and links to
  Privacy and Terms. Signed in, `/` still renders your board, so no URL moved and no bookmark broke.
  (ROADMAP 5.1.)

  **The hero shows a live board, not a screenshot.** It renders the real `TaskCard` against the real
  theme tokens using the mock board already in the repo — genuine rotation, pins, DONE stamps,
  per-theme shadows — with a Cork / Neon-Brutalist / Aurora-Glass toggle beneath it. Nothing to
  capture, commit at 2×, or re-take when the UI changes; it cannot drift from the product because it
  _is_ the product rendering. The toggle is local to the page and never writes to your saved theme.

- **Privacy and Terms are reachable from the board itself** (ROADMAP 5.3), in the inbox foot. The
  roadmap suggested the mobile toolbar overflow, but no overflow menu exists and the phone toolbar
  is already three stacked rows; the inbox renders in every view and costs no board space.

### Changed

- **The Google sign-in button uses Google's actual mark** (ROADMAP 5.2) — the official multi-colour
  "G" as an inline SVG, replacing a blue letter, per their branding guidelines. Inline because the
  CSP allows no external asset hosts.
- **A task card with no `onToggleDone` renders its checkbox as a status indicator, not a button.**
  It was always a `<button>` with an optional-chained handler, so decorative cards shipped a
  focusable control that did nothing — reachable by keyboard and announced as a button. Found by the
  landing preview's accessibility test.

### Internal

- Per-route `<title>`/description via a small `useDocumentTitle` hook — no new dependency; the static
  og/twitter tags in `index.html` stay as the sitewide default.
- The preview is lazy-loaded inside the landing page. Importing it eagerly grew the entry chunk
  459.7 → 491.7 kB, because the card and theme modules hoist into the chunk every visitor pays for;
  splitting it holds the entry at 465.5 kB (+1.9 kB gzip over baseline) and moves ~27 kB behind
  first paint, where `BoardPage` now shares it — that chunk shrank 100.1 → 90.6 kB.

## [1.2.27] - 2026-07-27

### Fixed

- **The documented restore had two ways to fail, both found by reading a successful backup's log.**
  The first green run printed the tables it captured, which showed `data.sql` already contained the
  `auth` schema — `supabase db dump --data-only` includes Supabase-managed schemas, even though the
  _schema_ dump excludes them. The separate `--schema auth` dump added in v1.2.25 was therefore a
  strict subset of `data.sql` (16 KB inside 19 KB), and the runbook's "load `auth.sql`, then
  `data.sql`" would have inserted `auth.users` twice and aborted on a duplicate key — during an
  outage, halfway through a restore.

  Worse, and independent of that: restoring `auth.users` fires `on_auth_user_created`, which seeds a
  **default** `public.user_settings` row; the dump's `COPY` of that user's real settings row then
  collides with it. The trigger's own `on conflict do nothing` guards the trigger's insert, not the
  restore's, and whether it bites at all depends on table order in the dump — the kind of fault that
  passes a rehearsal and fails in production.

  The backup now takes one data dump instead of two, asserts that single file holds **both**
  `public.tasks` and `auth.users` (so a change in that CLI behaviour fails loudly rather than
  silently backing up half a system), and the runbook loads it once under
  `session_replication_role = replica`, which suppresses the self-referencing recurrence foreign key
  and the settings-seeding trigger together. Existing v1.2.25–v1.2.26 bundles remain restorable —
  ignore their redundant `auth.sql`, which the runbook now says explicitly.

## [1.2.26] - 2026-07-27

### Fixed

- **The backup job's own verification rejected a perfectly good dump.** The first real run of the
  v1.2.25 workflow failed with "data.sql contains no public.tasks". The dumps were fine — the
  Supabase CLI quotes identifiers, so the file says `COPY "public"."tasks"`, and the check used
  `grep 'public.tasks'`, where `.` matches exactly one character and cannot span `"."`. The check
  now normalises `COPY "public"."tasks"` / `INSERT INTO public.tasks` to a bare `public.tasks`
  before comparing, and prints the captured table names on both success and failure so the next
  surprise is diagnosable from the log. Those names are filtered to identifier-shaped strings and
  matched only at line start, because `COPY` payload rows are user data and this log is public.

### Security

- **The restore procedure would have failed on the recurrence foreign key.** `pg_dump` warns on
  every run that `tasks` has a circular foreign-key constraint — that is `recur_parent_id`
  referencing `tasks(id)`, the hidden-template link. The consequence lands on restore, not on
  dump: a `--data-only` load inserts rows in file order, so a recurring instance can arrive before
  its template and abort the load on a foreign-key violation. The runbook now loads board data with
  `session_replication_role = replica` inside a single transaction, explains the warning so it is
  not "fixed" by changing what gets dumped, and adds a post-restore check for instances whose
  template did not come back — the exact corruption that disabling FK triggers would otherwise
  hide. Found by running the backup for real rather than by reading it.

## [1.2.25] - 2026-07-26

### Added

- **Nightly encrypted database backups.** The Supabase free tier has **no automated backups at
  all** — until now a dropped table or a bad migration would have lost every user's data with no
  restore path (the app's export/import is per-user and manual, so it was never one). A new
  `Backup` workflow dumps the schema, the `public` data, and the `auth` data each night at 09:00
  UTC, and on demand via **Run workflow**. All three matter: `supabase db dump` excludes
  Supabase-managed schemas by default, so without an explicit `auth` dump every restored task would
  point at a user id that no longer exists.

  **The bundle is GPG-encrypted on the runner before upload**, because this repository is public
  and GitHub Actions artifacts on public repos can be downloaded by anyone — an unencrypted dump
  would publish every user's email address, password hash, and task content. That needs one new
  repository secret, `BACKUP_GPG_PASSPHRASE`; if it is lost, the backups are permanently unreadable.

  The job refuses to run without that passphrase (an unset secret is an empty string, and `gpg`
  would otherwise cheerfully encrypt with nothing), asserts each dump actually contains
  `CREATE TABLE` / `public.tasks` / `auth.users` rather than trusting exit codes, greps the
  encrypted output for plaintext, and decrypts its own bundle to prove it opens. A backup job that
  goes green while storing nothing is the failure mode worth engineering against.

- **`docs/runbooks/restore-from-backup.md`** — the restore procedure, including the ordering trap
  (`auth.sql` before `data.sql`, or foreign keys fail), what to do differently for partial data loss
  versus a lost project, what a restored database does _not_ carry (auth config, OAuth client), and
  a standing instruction to rehearse it against a throwaway project. `docs/` now distinguishes its
  historical `plans/` and `specs/` from `runbooks/`, which is living documentation.

## [1.2.24] - 2026-07-26

### Security

- **Closed out the redirect allow-list finding by recording the decision, not by changing it**
  (2026-06-30 review, Finding 3; re-affirmed 2026-07-26). `https://*.magic-agenda.pages.dev/**`
  matches every per-PR Cloudflare preview deploy, which has read as an open item across two
  reviews. It stays: the namespace belongs to this project alone and Cloudflare builds no previews
  for fork PRs, so only someone who can already deploy here could exploit it — while dropping it
  would break Google sign-in on preview deploys. `supabase/config.toml` now carries that reasoning
  next to the list, along with the cases that must stay absent (no bare-host or scheme wildcard, no
  wildcard over a domain we don't control). Comment-only: the pushed config is byte-identical.

### Docs

- **`AGENTS.md` now tells agents that `private/` exists.** The security reviews are git-ignored and
  local to the maintainer's checkout, so an agent had no way to learn that the redirect wildcard,
  tokens in `localStorage`, and the realtime DELETE fan-out are _argued, accepted_ risks rather than
  bugs to fix — and reviews that live nowhere discoverable get re-litigated or silently undone.

## [1.2.23] - 2026-07-26

### Internal

- **Dev-dependency bumps** (Dependabot, `npm-minor-and-patch` group): `eslint` 10.6.0 → 10.8.0,
  `globals` 17.7.0 → 17.8.0, `typescript-eslint` 8.63.0 → 8.65.0. No runtime dependencies changed.
  Note that `typescript-eslint` 8.65.0 still peer-requires `typescript <6.1.0`, so the TypeScript 7
  hold added in v1.2.22 stays necessary.

## [1.2.22] - 2026-07-26

### Changed

- **The two auth emails are branded.** Confirm-signup and reset-password were still the four-line
  stock fragments (`<h2>` + a bare link). They now match the auth screen the link actually opens —
  dark navy panel, violet action button, app mark and wordmark — built table-first with inline
  styles so Outlook and Gmail render them, and declaring `color-scheme: dark` so dark-mode clients
  don't re-invert an already-dark email. Both gain a paste-this-link fallback, an explicit
  "expires in 1 hour, single use" note (matching `otp_expiry = 3600`), and a "you can safely ignore
  this" line; the confirmation copy now says you'll be signed straight in, which has been true since
  v1.2.19. **The action URLs are byte-for-byte unchanged** — still
  `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=…`, the form `verifyOtp` redeems — so the
  auth flows themselves are untouched. Completes ROADMAP 5.7.

### Docs

- **Corrected the required-checks list everywhere it was stale.** `Config` became a required check
  when v1.2.20 landed, but `AGENTS.md` still said it was "not yet required", and `README.md`,
  `CONTRIBUTING.md`, and `SECURITY.md` each listed a different, shorter subset. All four now name
  the same seven — `Format`, `Test`, `Build`, `Functions`, `Agents`, `Changelog`, `Config` — plus
  CodeQL. `CONTRIBUTING.md` also records that `Config` has **no** local equivalent on purpose: the
  Supabase CLI has no `--dry-run`, so running it locally would apply to production.
- **README no longer points contributors at the auth dashboard.** Setting up your own project still
  does, but production auth config has been code since v1.2.20 — the deployment section now covers
  `Deploy Auth Config` alongside `Deploy Migrations`.
- The config-as-code design spec's status header said "Approved, not yet implemented"; it shipped as
  v1.2.20 and v1.2.21. The PR template now lists the changelog entry and `npm run codex:check`,
  both of which gate merges.

### Security

- **Recorded the realtime DELETE stream as a cross-tenant disclosure boundary** (2026-07-25 review,
  Finding 2 — Low, accepted). The migration's comment described it only as a client-correctness
  quirk. It now states that DELETE events are fanned out to every subscriber with no owner check
  (Postgres cannot check access to an already-deleted row), that payloads are capped at primary
  keys — for `user_settings` that key _is_ the auth user id — and records the two standing rules
  that keep it Low: never put a secret or semantically meaningful value in the primary key of a
  published table, and never disable RLS on one. `AGENTS.md` carries the same rules. Comment-only;
  no schema change, and `db push` treats the already-applied migration as a no-op.

### Internal

- **Held TypeScript at 6.x in Dependabot.** The `lint-and-typescript` group PR for TypeScript 7 had
  been failing since 2026-07-09: `typescript-eslint` peer-requires `typescript <6.1.0`, and its
  latest release (8.65.0) still does, so `npm ci` fails `ERESOLVE` and grouping cannot help —
  there is no compatible `typescript-eslint` to group with. An `ignore` entry for `typescript >=7`
  stops the daily red PR; it comes out once typescript-eslint's peer range admits TS 7.

## [1.2.21] - 2026-07-26

### Internal

- **Auth email templates are now code.** The two templates the app sends — confirm-signup and
  reset-password — live in `supabase/templates/` with their subjects in `config.toml`, deployed
  by the `Deploy Auth Config` workflow on merge. The dashboard is no longer the source of truth
  for them; future changes (including ROADMAP 5.7's branded restyling) are ordinary PR work
  against the HTML files, previewed by the `Config` CI job like any other auth-config change.
  Content matches what the dashboard served byte-for-byte, so this merge changes no user-visible
  email. This completes the second and final follow-up from the 2026-07-25 PKCE auth spec.

## [1.2.20] - 2026-07-26

### Internal

- **`supabase/config.toml` now describes production, and auth config deploys as code.** The file
  had been the stock `supabase init` template since day one — running `supabase config push`
  would have broken production auth outright (localhost site URL, weak password policy, email
  confirmations off, no Google OAuth block, no SMTP block, TOTP MFA off). Every `[auth]` value
  now matches the live dashboard (verified by inventory), secrets are referenced via `env()`
  (two new repo secrets: `RESEND_API_KEY`, `GOOGLE_OAUTH_CLIENT_SECRET` — never committed), and
  two pieces of automation keep it true: a `Deploy Auth Config` workflow applies the file with
  `supabase config push --yes` on merges to `main` touching `supabase/config.toml` or
  `supabase/templates/**`, and a new `Config` CI job previews the pending push on every PR via a
  `yes n |` decline stream — chosen because the CLI's confirmation prompts default to **yes** on
  EOF, so a closed-stdin "preview" would actually apply to production. `deploy-migrations.yml`
  and `deploy-functions.yml` carry the new env vars so the `env()` references cannot break them.
  This merge itself is designed to be a **no-op push** (the file equals production), proving the
  pipeline safely; the email templates move into the repo in a follow-up PR.

### Docs

- The 2026-07-25 PKCE auth spec's status now records it shipped as v1.2.19; new design spec and
  implementation plan for config-as-code added under `docs/specs/` and `docs/plans/`.

## [1.2.19] - 2026-07-25

### Security

- **Closed a session-fixation vector: URL fragment tokens are no longer adopted as sessions.**
  (2026-07-25 security review, Finding 1 — Medium.) The Supabase client previously ran the
  implicit auth flow, so any URL on the origin carrying `#access_token=…` — including one an
  attacker minted for their own account — silently replaced the visitor's session. The client
  now uses PKCE (`flowType: 'pkce'`) with implicit URL detection disabled outright
  (`detectSessionInUrl: () => false`, the function form — the actual control, since `flowType`
  alone does not gate fragment adoption). A regression test pins the config; a vendor-contract
  test pins the `verifyOtp` event behavior the new flows rely on. Neither redemption page will
  act while a session already exists, so a crafted emailed-token link can no longer replace a
  signed-in user's session either.

### Changed

- **Email links are now redeemed explicitly instead of via URL parsing.** Password-reset links
  carry `?token_hash=` and are redeemed on `/auth/reset` (the form appears after redemption;
  reloading mid-reset no longer risks a dead end). Signup-confirmation links land on the new
  `/auth/confirm` page and **sign the user straight in** — the old "confirm, then come back and
  sign in" round trip is gone, and the signup notice copy no longer says "then sign in".
  Google OAuth is unchanged. **Cutover note:** links emailed before this release stop signing
  users in; old reset links show "invalid or expired" (request a new one), and old confirmation
  links still confirm the account server-side but land signed out.

## [1.2.18] - 2026-07-25

### Security

- **Upgraded React Router to v8 to clear a high-severity advisory.**
  [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2) (RSC-mode CSRF bypass)
  affects `react-router` `>= 7.12.0, < 8.3.0`; the app was on 7.18.1. Magic Agenda is a
  client-only SPA with no RSC, no server, and no router actions, so the vulnerable code path was
  never reachable in production — but the dependency is now on a patched version regardless, and
  `npm audit --omit=dev` reports no vulnerabilities.

### Changed

- **`react-router-dom` replaced by `react-router` 8.3.0.** Dependabot could not make this bump on
  its own: `react-router-dom` pins `react-router` to its own exact version, and the
  `react-router-dom` re-export package was **removed** in v8 — so no in-range update existed and
  its daily security-update run had been failing. The 13 import sites now pull from the
  consolidated `react-router` package. Nothing else changed: the app uses `BrowserRouter` in
  library mode rather than `RouterProvider`, so v8's new `react-router/dom` entry point is not
  needed here. React 19.2.8 and Node 26 already satisfy v8's `>=19.2.7` and `>=22.22.0` floors.

### Internal

- **Dependabot config comment** no longer lists `react-router-dom` as an example of a package
  whose majors open as individual PRs.

## [1.2.17] - 2026-07-24

### Internal

- **Codex's agent config is now generated from Claude's, not hand-copied.** `.claude/` is the single
  source of truth: [`scripts/sync-codex.mjs`](./scripts/sync-codex.mjs) converts
  `.claude/agents/<name>.md` into `.codex/agents/<name>.toml` and copies `.claude/skills/<name>/` to
  `.agents/skills/<name>/`, which is where Codex actually looks for each. Both generated trees are
  committed, so a Codex session picks up the same `docs-updater`, `code-reviewer`, and `ship`
  definitions without running anything. Run it with `npm run codex:sync`.
- **`Agents` CI check** runs `npm run codex:check` and fails on any generated file that is missing,
  hand-edited, or left over from a deleted source. It also asserts `CLAUDE.md` still contains its
  `@AGENTS.md` import, so the two guides cannot fork into separate copies again.
- **Fixed the drift already in the Codex copies.** They had been written by substituting `AGENTS.md`
  for `CLAUDE.md` throughout, which produced self-contradictions such as "edit `AGENTS.md`, never add
  content to `AGENTS.md`". Skill prose is now copied byte-for-byte — references to `CLAUDE.md` are
  correct as written for both tools, because it really is just an import. Claude-only frontmatter is
  translated rather than dropped in silence: an agent granted no file-writing tools becomes
  `sandbox_mode = "read-only"`, and `model:` is recorded in a comment as having no Codex equivalent.

### Docs

- **AGENTS.md and CONTRIBUTING.md** document the generated-config pipeline, the rule against editing
  `.codex/` or `.agents/` by hand, and the new `Agents` check in both required-check lists.

## [1.2.16] - 2026-07-22

### Internal

- **`@supabase/supabase-js` 2.110.7 → 2.110.8, `react` and `react-dom` 19.2.7 → 19.2.8,
  `@vitejs/plugin-react` (dev) 6.0.3 → 6.0.4.** (#89)

## [1.2.15] - 2026-07-21

### Internal

- **`prettier` (dev) 3.9.5 → 3.9.6.** (#88)

## [1.2.14] - 2026-07-21

### Internal

- **`@testing-library/jest-dom` (dev) 6.9.1 → 7.0.0.** (#87)

## [1.2.13] - 2026-07-17

### Internal

- **`@supabase/supabase-js` 2.110.6 → 2.110.7.** (#86)

## [1.2.12] - 2026-07-16

### Internal

- **The changelog now names the version each merge mints.** Every merge to `main` auto-releases, so
  each entry is recorded against the build it shipped in rather than accumulating under
  `[Unreleased]`. A new [`scripts/next-version.mjs`](./scripts/next-version.mjs) is the single source
  of truth for that number — the `Version` workflow, the `Changelog` CI guard, and the `ship` agent
  skill all call it. Builds `v1.2.1`–`v1.2.11` are backfilled below from their release tags.
- **`Changelog` CI guard**, now a required status check, runs
  [`scripts/check-changelog.mjs`](./scripts/check-changelog.mjs) to enforce two invariants: the PR
  names the version its merge will mint, and every already-released build has an entry. Dependabot
  PRs are exempt from the first — a bot can't write a meaningful entry — which is exactly what the
  second one covers: a bot merge ships undocumented and takes a build number with it, and the guard
  then fails the next human PR until that gap is backfilled.
- **`ship` agent skill** (`.claude/skills/ship/`) takes a finished branch to an open PR: it refreshes
  the docs, backfills any undocumented released builds, writes the changelog entry for the version the
  merge will mint, runs the fast checks (`format:check`, `lint`, `tsc -b`), and opens or updates the
  PR. It replaces the previous Claude docs-freshness `Stop` hook.

### Docs

- **CONTRIBUTING and AGENTS** now document the named-version changelog model and the `Changelog`
  guard, replacing the previous `[Unreleased]`-cut release step.

## [1.2.11] - 2026-07-16

### Internal

- **`vite` (dev) 8.1.4 → 8.1.5.** (#85)

## [1.2.10] - 2026-07-15

### Internal

- **Dependabot config gains `npm` and `github-actions` PR labels.** (#83)

## [1.2.9] - 2026-07-15

### Internal

- **`actions/setup-node` (GitHub Actions) 6 → 7.** (#81)

## [1.2.8] - 2026-07-15

### Internal

- **`@supabase/supabase-js` 2.110.5 → 2.110.6.** (#82)

## [1.2.7] - 2026-07-15

### Internal

- **Dependabot now runs on a daily schedule (05:00).** (#80)

## [1.2.6] - 2026-07-15

### Internal

- **`@supabase/supabase-js` 2.110.4 → 2.110.5.** (#79)

## [1.2.5] - 2026-07-14

### Internal

- **`@supabase/supabase-js` 2.110.2 → 2.110.4.** (#78)

## [1.2.4] - 2026-07-13

### Internal

- **`supabase/setup-cli` (GitHub Actions) 2 → 3.** (#77)

## [1.2.3] - 2026-07-10

### Internal

- **Prettier 3.9.4 → 3.9.5.** (#76)

## [1.2.2] - 2026-07-09

### Internal

- **Line endings normalized via `.gitattributes`** — every text file is enforced LF in both the
  repository and the working tree (`* text=auto eol=lf`; binaries marked). Ends the local
  `npm run format:check` false-failures on Windows checkouts, where `core.autocrlf` produced CRLF
  working trees that Prettier (default `endOfLine: "lf"`) flagged even though CI passed. (#75)

## [1.2.1] - 2026-07-09

### Docs

- **Docs audit & consolidation** — `AGENTS.md` is now the canonical agent guide (`CLAUDE.md` just
  imports it); the documented required checks match the actual ruleset (`Format` / `Test` / `Build` /
  `Functions` + CodeQL); CONTRIBUTING gains the changelog-cut release step and the `release/*`
  branch-name warning; the completed implementation plans under `docs/` are marked as historical
  records. (#74)

## [1.2.0] - 2026-07-09

### Added

- **Export & import** — download the whole board (tasks, repeating series, settings) as JSON
  from Settings → Data, and import a previous export additively: fresh ids, series links
  preserved, nothing overwritten.
- **Overdue tasks** — unfinished tasks from past days get a red accent, the Today button shows
  their count, and the Agenda pins an Overdue group to the top with one-click "Move all to
  today" (recurring occurrences keep their identity and never regenerate on the old day).
- **Pinned notes** — pin important tasks from the editor or the 📌 button on any card. Cork's
  classic red pin now appears only on pinned notes; brutal gets a corner flash; glass a violet
  glow. A "📌 Pinned" quick filter shows pinned tasks only — manual drag order is never
  re-sorted by pinning.
- **Due times** — tasks can carry an optional time of day: set or clear it in the editor's
  Schedule row, see it as a chip on cards, and the Agenda sorts timed tasks first within each
  day (calendar cells keep manual drag order). Recurring series pass their time to every
  occurrence.
- **Realtime multi-device sync** — edits, drags, and deletions now appear live on every
  signed-in device via Supabase realtime (`postgres_changes` under RLS). A pure reducer
  (`src/data/realtime.ts`) applies remote changes — deduping recurring instances by
  occurrence, keeping templates off the board — while echoes of the device's own writes
  are suppressed. The board also refetches on reconnect, on coming back online, and when
  the tab becomes visible again (fixes stale boards on phones). Theme and default-view
  changes propagate live too.
- **Delete account** — a Danger-zone section on `/settings` permanently deletes the account
  and all data (typed confirmation required). Deletion runs in a JWT-verified `delete-account`
  edge function; Postgres cascades remove the user's tasks and settings.
- **Password reset** — a "Forgot password?" flow on the login page emails a recovery link
  (never revealing whether an account exists); the link lands on a new `/auth/reset` page
  that sets the new password. A recovery session can't reach the board until the password
  is changed.
- **Settings page** — a `/settings` route (gear button in the toolbar) with theme and
  default-view controls and Privacy/Terms links; built as a section registry that account,
  data, and preference features will extend.
- **Mobile‑responsive layout** — the board now adapts to phone‑width screens: the toolbar stacks into
  compact rows, Week view becomes a vertical day list, the month Calendar pans sideways at a readable
  width, Kanban columns swipe horizontally with snap points, and the Inbox docks full‑width below the
  board as a collapsible panel. The task editor opens as a bottom sheet and form fields use 16px text
  on phones so iOS Safari no longer zooms on focus. Layout branches on a new `useIsMobile()`
  matchMedia hook (`src/lib/useMediaQuery.ts`), since the inline‑style theming can't use CSS media
  queries. The shell also sizes with `100dvh` so the collapsing mobile URL bar no longer cuts off the
  bottom of the board.
- **Touch drag‑and‑drop** — dragging now works on touch screens: a long‑press (250ms) picks up a card
  while a plain swipe scrolls the board. Previously cards set `touch-action: none` and the pointer
  sensor treated any 6px touch movement as a drag, which made touch scrolling impossible.

### Changed

- **Theme lives in Settings; the default view is stable** — the cork/brutal/glass switcher moved
  out of the toolbar into Settings → Appearance (theme still syncs live across devices).
  Switching view tabs no longer changes your saved default view — the default is set only in
  Settings and is the view you land on when you open the app; the view you pick during a session
  is remembered for that tab (across refreshes) and resets on a new tab or sign-out.

### Fixed

- **Recurring‑occurrence drag no longer resurrects a copy** — moving a recurring instance to a
  different day used to re‑create a duplicate on its original day after reload (and delete/edit
  "all future" on a moved occurrence trimmed the series at the wrong boundary). Instances now record
  an immutable `recur_origin_day`; materialization, the delete skip‑list, series edit/delete scope,
  and the `tasks_recur_instance_uniq` index all key off the origin occurrence instead of the movable
  `day`. Existing instances are backfilled to `recur_origin_day = day`; any instance already moved,
  inboxed, or deleted‑while‑moved before this release has an unrecoverable origin and may regenerate
  a duplicate one final time.

### Security

- **Security response headers** — `public/_headers` (served by Cloudflare Pages) adds a
  Content‑Security‑Policy, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
  and a minimal `Permissions-Policy`. (#33)
- **Per‑user recurrence index** — `tasks_recur_instance_uniq` is now scoped by `user_id`
  (`(user_id, recur_parent_id, day)`), closing a theoretical cross‑tenant existence leak. (#33)

### Internal

- **Release versioning** — the `Version` workflow now creates standard three-part SemVer releases
  (`v<major>.<minor>.<build>`) on every merge to `main`, auto-incrementing the build per major/minor
  line while allowing a new line to start at `x.y.0`.
- **Edge Function scaffolding** — `supabase/functions/` with a shared JWT-verification helper
  (`requireUser`), CORS handling, a `hello` template function, Deno tests in a new CI `Functions`
  job, and a `Deploy Functions` workflow that ships functions to production on merge to `main`.
- **Auto‑deploy migrations** — a `Deploy Migrations` GitHub Actions workflow applies Supabase migrations
  to production on merge to `main` (changes under `supabase/migrations/**`) via `supabase db push`. (#34)
- **Repo health** — added `CODEOWNERS` and a `FUNDING.yml` sponsor button. (#32)

## [1.1.1] - 2026-06-30

Maintenance release — dev‑toolchain upgrades and documentation. No user‑facing feature or behavior
changes.

### Internal

- **Vite 6 → 8, Vitest 3 → 4, `@vitejs/plugin-react` 4 → 6** — combined major dev‑toolchain upgrade.
  The three move in lockstep (plugin‑react 6 requires Vite `^8`; Vitest 4 spans the gap), so they were
  bumped atomically to avoid an unsatisfiable peer range in CI. Vite 8 is Rolldown‑powered and
  plugin‑react now drives React Refresh via Oxc. (#27)
- **`@supabase/supabase-js` 2.108 → 2.110** plus a follow‑up **Vite 8.1.0 → 8.1.1** patch. (#30)
- **Prettier 3.9.3 → 3.9.4.** (#23)
- **Dependabot** now runs on an explicit schedule (time/timezone) with PR labels, and a `vite`‑ecosystem
  group keeps the interdependent major bumps landing together. (#29, #27)

### Docs

- **Added [ROADMAP.md](./ROADMAP.md)** and normalized formatting across the project docs. (#28)

## [1.1.0] - 2026-06-29

Maintenance release — dependency and toolchain modernization. No user‑facing feature or behavior
changes; the app already ran cleanly on the new versions.

### Internal

- **React 18 → 19** — `react`, `react-dom`, and their `@types` upgraded together (one atomic bump, since
  the pair must move in lockstep); no source changes required (the app was already on `createRoot`). (#21)
- **TypeScript 5.9 → 6.0.** (#9)
- **ESLint 9 → 10** — `eslint`, `@eslint/js`, and `eslint-plugin-react-hooks` bumped atomically. (#20)
- **`@dnd-kit/sortable` 8 → 10.** (#11)
- **Test/lint tooling** — `jsdom` 25 → 29 (#10) and `globals` 15 → 17 (#6), plus a grouped batch of
  minor/patch updates. (#18)
- **CI on Node 26** with an `engines` field (`node >=26`) now declared; `actions/checkout` 4 → 7 and
  `actions/setup-node` 4 → 6. (#19, #2, #1)

## [1.0.1] - 2026-06-29

### Added

- **Legal pages** — Privacy Policy and Terms of Service, linked from the app. (#14)
- **Branding** — wordmark/logo, social (Open Graph / Twitter) meta tags, and app icons/favicons. (#15)

### Fixed

- **Theme and default‑view preferences now persist.** Changing the theme or default view updated local
  state but never reached the database: the Supabase `user_settings` upsert was built but never executed
  (a query builder only issues its request when awaited / `.then`‑ed), so the preference reset to Cork /
  Calendar on every reload. The write now fires and logs failures.
- **Larger logo** in the toolbar and on the login screen. (#16)

### Internal

- CI split into separate **Format / Test / Build** jobs; added Dependabot and a `CLAUDE.md` contributor
  guide.

## [1.0.0] - 2026-06-29

Initial public release — [magicagenda.app](https://magicagenda.app).

### Added

- **Accounts** — email/password and Google (OAuth) sign‑in via Supabase Auth, with route gating.
- **Per‑user data** — Postgres with Row‑Level Security; each user sees only their own tasks. A signup
  trigger seeds a `user_settings` row.
- **Views** — Calendar (month grid), Week, Agenda, and Kanban; the default view is persisted.
- **Themes** — Cork, Neon‑Brutalist, and Aurora‑Glass; the selected theme is persisted.
- **Drag‑and‑drop** — reorder within and move across days/weeks/columns/inbox (dnd‑kit), with a drag
  ghost and a 6px click‑vs‑drag threshold.
- **Task editor** — title, description, colour, category, checklist, status, and schedule.
- **Search & filter** — live client‑side filtering by text, category, and status.
- **Recurring tasks** — daily/weekly/monthly with interval and end date, materialized over a rolling
  90‑day horizon, with this‑occurrence / all‑future edit and delete and a deleted‑occurrence skip‑list.
- **Optimistic CRUD** with rollback and error toasts on sync failures.
- **Deployment** — Cloudflare Pages, auto‑deploying from GitHub `main`, on the custom domain
  `magicagenda.app` with SPA deep‑link fallback.

### Known limitations

- Dragging a recurring occurrence to a different day may cause a copy to reappear on its original day
  after reload (instances don't yet record their origin date).
- The Google consent screen shows the `…supabase.co` callback host on the free Supabase tier.

[Unreleased]: https://github.com/jwh3times/magic-agenda/compare/v1.8.5...HEAD
[1.8.5]: https://github.com/jwh3times/magic-agenda/compare/v1.8.4...v1.8.5
[1.8.4]: https://github.com/jwh3times/magic-agenda/compare/v1.8.3...v1.8.4
[1.8.3]: https://github.com/jwh3times/magic-agenda/compare/v1.8.2...v1.8.3
[1.8.2]: https://github.com/jwh3times/magic-agenda/compare/v1.8.1...v1.8.2
[1.8.1]: https://github.com/jwh3times/magic-agenda/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/jwh3times/magic-agenda/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/jwh3times/magic-agenda/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/jwh3times/magic-agenda/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/jwh3times/magic-agenda/compare/v1.4.3...v1.5.0
[1.4.3]: https://github.com/jwh3times/magic-agenda/compare/v1.4.2...v1.4.3
[1.4.2]: https://github.com/jwh3times/magic-agenda/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/jwh3times/magic-agenda/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/jwh3times/magic-agenda/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/jwh3times/magic-agenda/compare/v1.2.80...v1.3.0
[1.2.80]: https://github.com/jwh3times/magic-agenda/compare/v1.2.79...v1.2.80
[1.2.79]: https://github.com/jwh3times/magic-agenda/compare/v1.2.78...v1.2.79
[1.2.78]: https://github.com/jwh3times/magic-agenda/compare/v1.2.77...v1.2.78
[1.2.77]: https://github.com/jwh3times/magic-agenda/compare/v1.2.76...v1.2.77
[1.2.76]: https://github.com/jwh3times/magic-agenda/compare/v1.2.75...v1.2.76
[1.2.75]: https://github.com/jwh3times/magic-agenda/compare/v1.2.74...v1.2.75
[1.2.74]: https://github.com/jwh3times/magic-agenda/compare/v1.2.73...v1.2.74
[1.2.73]: https://github.com/jwh3times/magic-agenda/compare/v1.2.72...v1.2.73
[1.2.72]: https://github.com/jwh3times/magic-agenda/compare/v1.2.71...v1.2.72
[1.2.71]: https://github.com/jwh3times/magic-agenda/compare/v1.2.70...v1.2.71
[1.2.70]: https://github.com/jwh3times/magic-agenda/compare/v1.2.69...v1.2.70
[1.2.69]: https://github.com/jwh3times/magic-agenda/compare/v1.2.68...v1.2.69
[1.2.68]: https://github.com/jwh3times/magic-agenda/compare/v1.2.67...v1.2.68
[1.2.67]: https://github.com/jwh3times/magic-agenda/compare/v1.2.66...v1.2.67
[1.2.66]: https://github.com/jwh3times/magic-agenda/compare/v1.2.65...v1.2.66
[1.2.65]: https://github.com/jwh3times/magic-agenda/compare/v1.2.64...v1.2.65
[1.2.64]: https://github.com/jwh3times/magic-agenda/compare/v1.2.63...v1.2.64
[1.2.63]: https://github.com/jwh3times/magic-agenda/compare/v1.2.62...v1.2.63
[1.2.62]: https://github.com/jwh3times/magic-agenda/compare/v1.2.61...v1.2.62
[1.2.61]: https://github.com/jwh3times/magic-agenda/compare/v1.2.60...v1.2.61
[1.2.60]: https://github.com/jwh3times/magic-agenda/compare/v1.2.59...v1.2.60
[1.2.59]: https://github.com/jwh3times/magic-agenda/compare/v1.2.58...v1.2.59
[1.2.58]: https://github.com/jwh3times/magic-agenda/compare/v1.2.57...v1.2.58
[1.2.57]: https://github.com/jwh3times/magic-agenda/compare/v1.2.56...v1.2.57
[1.2.56]: https://github.com/jwh3times/magic-agenda/compare/v1.2.55...v1.2.56
[1.2.55]: https://github.com/jwh3times/magic-agenda/compare/v1.2.54...v1.2.55
[1.2.54]: https://github.com/jwh3times/magic-agenda/compare/v1.2.53...v1.2.54
[1.2.53]: https://github.com/jwh3times/magic-agenda/compare/v1.2.52...v1.2.53
[1.2.52]: https://github.com/jwh3times/magic-agenda/compare/v1.2.51...v1.2.52
[1.2.51]: https://github.com/jwh3times/magic-agenda/compare/v1.2.50...v1.2.51
[1.2.50]: https://github.com/jwh3times/magic-agenda/compare/v1.2.49...v1.2.50
[1.2.49]: https://github.com/jwh3times/magic-agenda/compare/v1.2.48...v1.2.49
[1.2.48]: https://github.com/jwh3times/magic-agenda/compare/v1.2.47...v1.2.48
[1.2.47]: https://github.com/jwh3times/magic-agenda/compare/v1.2.46...v1.2.47
[1.2.46]: https://github.com/jwh3times/magic-agenda/compare/v1.2.45...v1.2.46
[1.2.45]: https://github.com/jwh3times/magic-agenda/compare/v1.2.44...v1.2.45
[1.2.44]: https://github.com/jwh3times/magic-agenda/compare/v1.2.43...v1.2.44
[1.2.43]: https://github.com/jwh3times/magic-agenda/compare/v1.2.42...v1.2.43
[1.2.42]: https://github.com/jwh3times/magic-agenda/compare/v1.2.41...v1.2.42
[1.2.41]: https://github.com/jwh3times/magic-agenda/compare/v1.2.40...v1.2.41
[1.2.40]: https://github.com/jwh3times/magic-agenda/compare/v1.2.39...v1.2.40
[1.2.39]: https://github.com/jwh3times/magic-agenda/compare/v1.2.38...v1.2.39
[1.2.38]: https://github.com/jwh3times/magic-agenda/compare/v1.2.37...v1.2.38
[1.2.37]: https://github.com/jwh3times/magic-agenda/compare/v1.2.36...v1.2.37
[1.2.36]: https://github.com/jwh3times/magic-agenda/compare/v1.2.35...v1.2.36
[1.2.35]: https://github.com/jwh3times/magic-agenda/compare/v1.2.34...v1.2.35
[1.2.34]: https://github.com/jwh3times/magic-agenda/compare/v1.2.33...v1.2.34
[1.2.33]: https://github.com/jwh3times/magic-agenda/compare/v1.2.32...v1.2.33
[1.2.32]: https://github.com/jwh3times/magic-agenda/compare/v1.2.31...v1.2.32
[1.2.31]: https://github.com/jwh3times/magic-agenda/compare/v1.2.30...v1.2.31
[1.2.30]: https://github.com/jwh3times/magic-agenda/compare/v1.2.29...v1.2.30
[1.2.29]: https://github.com/jwh3times/magic-agenda/compare/v1.2.28...v1.2.29
[1.2.28]: https://github.com/jwh3times/magic-agenda/compare/v1.2.27...v1.2.28
[1.2.27]: https://github.com/jwh3times/magic-agenda/compare/v1.2.26...v1.2.27
[1.2.26]: https://github.com/jwh3times/magic-agenda/compare/v1.2.25...v1.2.26
[1.2.25]: https://github.com/jwh3times/magic-agenda/compare/v1.2.24...v1.2.25
[1.2.24]: https://github.com/jwh3times/magic-agenda/compare/v1.2.23...v1.2.24
[1.2.23]: https://github.com/jwh3times/magic-agenda/compare/v1.2.22...v1.2.23
[1.2.22]: https://github.com/jwh3times/magic-agenda/compare/v1.2.21...v1.2.22
[1.2.21]: https://github.com/jwh3times/magic-agenda/compare/v1.2.20...v1.2.21
[1.2.20]: https://github.com/jwh3times/magic-agenda/compare/v1.2.19...v1.2.20
[1.2.19]: https://github.com/jwh3times/magic-agenda/compare/v1.2.18...v1.2.19
[1.2.18]: https://github.com/jwh3times/magic-agenda/compare/v1.2.17...v1.2.18
[1.2.17]: https://github.com/jwh3times/magic-agenda/compare/v1.2.16...v1.2.17
[1.2.16]: https://github.com/jwh3times/magic-agenda/compare/v1.2.15...v1.2.16
[1.2.15]: https://github.com/jwh3times/magic-agenda/compare/v1.2.14...v1.2.15
[1.2.14]: https://github.com/jwh3times/magic-agenda/compare/v1.2.13...v1.2.14
[1.2.13]: https://github.com/jwh3times/magic-agenda/compare/v1.2.12...v1.2.13
[1.2.12]: https://github.com/jwh3times/magic-agenda/compare/v1.2.11...v1.2.12
[1.2.11]: https://github.com/jwh3times/magic-agenda/compare/v1.2.10...v1.2.11
[1.2.10]: https://github.com/jwh3times/magic-agenda/compare/v1.2.9...v1.2.10
[1.2.9]: https://github.com/jwh3times/magic-agenda/compare/v1.2.8...v1.2.9
[1.2.8]: https://github.com/jwh3times/magic-agenda/compare/v1.2.7...v1.2.8
[1.2.7]: https://github.com/jwh3times/magic-agenda/compare/v1.2.6...v1.2.7
[1.2.6]: https://github.com/jwh3times/magic-agenda/compare/v1.2.5...v1.2.6
[1.2.5]: https://github.com/jwh3times/magic-agenda/compare/v1.2.4...v1.2.5
[1.2.4]: https://github.com/jwh3times/magic-agenda/compare/v1.2.3...v1.2.4
[1.2.3]: https://github.com/jwh3times/magic-agenda/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/jwh3times/magic-agenda/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/jwh3times/magic-agenda/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/jwh3times/magic-agenda/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/jwh3times/magic-agenda/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/jwh3times/magic-agenda/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/jwh3times/magic-agenda/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/jwh3times/magic-agenda/releases/tag/v1.0.0
