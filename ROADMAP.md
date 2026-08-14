# Roadmap

Planned features and fixes for Magic Agenda, each with a codebase-grounded implementation sketch
(approach, schema, tests, risks). This is **aspirational, not a commitment** — priorities shift and
nothing here has a guaranteed date. For what has already shipped, see [CHANGELOG.md](./CHANGELOG.md).

Items are grouped into **phases ordered by dependency and priority** — the phase order is the
recommended build order; items within a phase are independent unless noted.

**Legend** — status: `[ ]` planned · `[~]` in progress.
Priority: **P1** near-term · **P2** medium · **P3** nice-to-have.
Size: **S** ≤ half a day · **M** 1–2 days · **L** 3–5 days · **XL** 1–2 weeks+.

## Build order at a glance

Phases 0 and 1 (Edge Function scaffolding, settings page shell, password reset, delete account,
realtime multi-device sync) **shipped 2026-07-05**, and Phase 2 (Scheduling depth — due times,
pinned notes, overdue handling & roll-forward, export/import) **shipped 2026-07-06** — see
[CHANGELOG.md](./CHANGELOG.md) — and their sections have been removed below; remaining
dependencies on them are satisfied. Items **5.7 (branded auth emails, 2026-07-26)**, **5.1 / 5.2 /
5.3 (public landing page, Google mark, in-app legal links, 2026-07-27)**, **3.1 (installable
PWA, offline read, 2026-07-27)**, and **4.1 (settings: week-start & timezone, 2026-07-28)** shipped
and have been removed the same way.

| Order | Item                             | Pri | Size | Hard dependencies      |
| ----- | -------------------------------- | --- | ---- | ---------------------- |
| 3.2   | Reminders / notifications        | P2  | XL   | —                      |
| 4.2   | Custom labels / categories       | P2  | XL   | — (6.2 step 1, landed) |
| 4.3   | Richer recurrence                | P3  | L    | —                      |
| 4.4   | Quick-add & keyboard shortcuts   | P3  | L    | —                      |
| 4.5   | Bulk multi-select                | P3  | L    | —                      |
| 4.6   | Undo                             | P3  | M    | best after 4.5         |
| 4.7   | Completed / archive view + stats | P3  | M    | —                      |
| 4.8   | Two-factor (TOTP) enrollment UI  | P3  | M    | —                      |
| 5.4   | Roles & feature flags            | P2  | L    | —                      |
| 5.5   | Admin dashboard                  | P2  | L    | 5.4                    |
| 5.6   | Custom auth domain               | P3  | S    | Supabase Pro (~$35/mo) |
| 5.8   | Leaked-password protection       | P3  | S    | Supabase Pro ($25/mo)  |
| 6.1   | iCal calendar feed               | P3  | L    | —                      |
| 6.3   | Attachments                      | P3  | L    | —                      |
| 6.2   | Multiple private boards          | P3  | XL   | —                      |
| 6.4   | Shared / collaborative boards    | P3  | L    | 6.2, 5.4               |

Total rough effort for the remaining items: ~7–10 weeks of focused solo work.

**Test coverage, not a numbered item:** RLS integration tests (`tests/rls/`, `npm run test:rls`)
were added as their own effort rather than a roadmap feature — see
`docs/superpowers/plans/2026-07-29-rls-integration-tests.md`. Two follow-ups:

- **~~Verify production's `pg_default_acl`~~ — answered 2026-07-29, and it was the bad case.**
  Production carried entries granting `anon` and `authenticated` `arwdDxtm` (full DML) on every
  future table in `public`, for both the `postgres` and `supabase_admin` creator roles. So the
  fail-closed premise of `20260729100000_explicit_data_api_grants.sql` — verified on a fresh local
  stack, never in production — was false where it mattered: any table shipped without
  `enable row level security` would have been world-readable and writable through the public anon
  key. `20260729190000_revoke_permissive_default_privileges.sql` revokes them for `postgres`, the
  role both migrations and the Studio table editor create through.

  **Residual gap, still open and not closeable from a migration:** the same entries exist for
  `supabase_admin`, and `postgres` is not a member of that role, so the revoke raises
  `insufficient_privilege` and is skipped with a notice in the deploy log. Tables the Supabase
  platform itself creates in `public` are therefore still auto-granted. Closing it needs the
  dashboard or Supabase support. Narrow in practice — this project's tables are all created as
  `postgres` — but it is the one part of the boundary that no test or migration here can reach.
- **Part 2A (Playwright smoke + a11y) has shipped** in v1.2.43 — `tests/e2e/`, driven against the
  PR's Cloudflare Pages preview. Two follow-ups remain:
  - **Part 2B (visual regression)** is still unbuilt — see
    `docs/superpowers/specs/2026-07-29-e2e-smoke-a11y-design.md`. Pin `@playwright/test` out of
    Dependabot's reach at that point, since a Playwright upgrade invalidates every screenshot
    baseline.
  - **A11y remediation has shipped, including all of `color-contrast`.** The structural rules were
    cleared first (`region`, `landmark-one-main`, `page-has-heading-one`, `select-name` — 177 of the
    202 originally baselined), then contrast reached zero in two passes: near-miss token nudges
    (glass/brand accent `#7c5cff` → `#7452ff`, cork `toolbarSub` alpha `.6` → `.65`, foot-link
    opacity `.55` → `.6`) and per-theme judgment calls (brutal accent `#CD4128`, a new `numTodayFg`
    token because the today-number and button roles pull in opposite contrast directions, neutral
    out-of-month numbers, blue card `#3D6CF2`). What remains is `nested-interactive` 9, an
    **accepted violation** (2026-07-31): the role-swap and drag-handle remedies were evaluated and
    declined — see the header comment in `tests/e2e/a11y.spec.ts`. Revisit alongside any future
    keyboard-UX pass (keyboard users also cannot open the editor today; Enter starts a drag). See
    `docs/superpowers/specs/2026-07-30-a11y-landmarks-design.md`.
- **No browser-level coverage of offline shell serving.** The service worker demonstrably serves
  precached assets with the network down, but Playwright's CDP offline emulation fails a top-level
  navigation before the worker is consulted, so the deployed offline-boot path cannot be exercised
  from this suite. `src/sw/policy.test.ts` covers the policy; the end-to-end behaviour is verified
  by hand. Worth revisiting if Playwright's offline emulation changes.

## Conventions that apply to every item

- **One PR per item** (or per slice of an L/XL item); `main` is PR-only and merging deploys to
  production, so every schema PR ships app code that tolerates both the old and new schema during
  the deploy window (migrations and the Pages build land at slightly different moments).
- **Schema changes**: new file under `supabase/migrations/`, then regenerate
  `src/types/database.types.ts` with `supabase gen types --linked`. All app↔DB conversions stay in
  `src/data/mappers.ts` (`'inbox'` ↔ `NULL`, `order` ↔ `order_index`, derived `done`); new columns
  extend `rowToTask` / `taskToRow` and nothing else touches row shapes.
- **RLS is the only authorization boundary.** Every new table default-denies and scopes to
  `auth.uid() = user_id` (or an explicit membership/role policy). Anything requiring privileges the
  anon key must not have (deleting auth users, cross-user reads, push sending) goes in a **Supabase
  Edge Function** or `security definer` RPC — never in the client.
- **Test-first for pure logic** (`src/data`, `src/dnd`, `src/lib`). UI work gets Testing Library
  coverage; phone-layout branches stub `matchMedia` (see the mobile block in `Board.test.tsx`).
- **Recurrence invariants**: templates stay hidden (`templatesRef`), instances are keyed by
  `(recur_parent_id, recur_origin_day)`, deletions go through `recurSkip`. Any feature touching
  tasks must decide explicitly how it treats templates vs. instances.
- **Optimistic writes with rollback** (the `useTasks` pattern): apply local state first, persist,
  restore `prev` + surface `error` on failure.

## Phase 3 — PWA & notifications

- [ ] **Reminders / notifications** · **P2** · XL — web push (email fallback later); the
      highest-ops item on the list. Schema: `push_subscriptions` table (owner-only RLS) +
      `tasks.last_notified_at timestamptz` (prevents re-sends) +
      `user_settings.reminder_lead_minutes int` (NULL = off) — store nothing derived; a reminder is
      just `day` + `at_time` + lead time. Client: settings section with permission request +
      `PushManager.subscribe` (VAPID). Sender: `pg_cron` invoking an Edge Function every 5 minutes —
      query tasks due in the window (service role), send via a Deno `web-push` port, delete dead
      subscriptions on 404/410. iOS needs the PWA installed to Home Screen (16.4+) — surface in the
      settings copy. 4.1 shipped the stored timezone; note that NULL means "follow the browser",
      which a server-side sender cannot resolve — prompt for a concrete zone when enabling
      reminders.

## Phase 4 — Productivity & personalization

- [ ] **Custom labels / categories** · **P2** · XL — `category` is a hardcoded 5-value enum; let
      users define their own labels and colors. The deepest data change on the list — three PRs:
  1. Schema + backfill: `labels` table (`id, board_id, name, dot_color, position`, membership RLS);
     `tasks.label_id uuid references labels on delete set null`, constrained so a task cannot carry
     a label from another board. Backfill the 5 built-ins per board and map `category` → `label_id`;
     keep the `category` column temporarily (deploy-window tolerance), drop one release later. Board
     creation seeds defaults.
  2. App read path: `useLabels(boardId)`; `Task.labelId`; `CAT` becomes a fallback. Card dot,
     editor picker, and filter dropdown consume the board's label list.
  3. Management UI on `/settings`: create/rename/recolor/reorder/delete (delete ⇒ "Unlabeled").

  **Labels are board-scoped from their first migration — `board_id`, never `user_id`.** An earlier
  version of this entry specified account-owned labels, which reads as the cheaper start and is not:
  boards force per-board labels, so account-scoped labels would be built, backfilled, and then
  migrated again, with a window where a label's owner and its tasks' owner are different columns
  that must agree. That is the same two-ownership-models trap as `board_id = NULL` in 6.2, one table
  over. Hence the dependency: this needs 6.2's `boards` / `board_memberships` foundation and its
  backfilled board-per-account, but **not** the rest of 6.2 — labels land while every account still
  has exactly one board, which is the cheapest place to get the `category` → label migration wrong.

  **The dependency landed 2026-08-13 (v1.2.76), as 6.2's step 1** — `boards`, `board_memberships`,
  and one backfilled board per account all exist, and every task already carries a `board_id`
  (nullable in the schema still, but never NULL in practice: the backfill closed the gap and a
  compatibility trigger routes every new insert). 6.2's remaining steps — the RLS rewrite that makes
  `board_id` NOT NULL, and step 3's board-creation UI — have **not** shipped, which per the paragraph
  above is exactly the window this entry wanted: 4.2 can now start while every account still has
  exactly one board, and doing it before step 3 lands is cheaper than doing it after. Priority
  consequence, stated plainly: 4.2 is P2 and was blocked behind P3 work only for its dependency; that
  dependency is now satisfied, so scheduling is a priority call, not a blocked one.

  Risk: the `Category` type is load-bearing in `constants.ts` — it dissolves into `string` label
  ids, a wide but shallow type ripple. Write the backfill migration idempotent.

- [ ] **Richer recurrence** · **P3** · L — specific weekdays (e.g. Mon/Wed/Fri) and "end after N
      occurrences", beyond daily/weekly/monthly + interval + until. Schema:
      `tasks.recur_weekdays int[]` (weekly templates only), `tasks.recur_count int` (mutually
      exclusive with `recur_until` in the editor; in data, whichever ends first wins). All logic in
      `src/data/recurrence.ts` test-first: `occurrencesFrom` gains weekday filtering and a count
      cap — the count is measured from the template's first occurrence, so materialization counts
      from `template.day`, not the horizon start. Trimming a count-capped series
      (`planDeleteSeriesFrom` in `src/data/series.ts`) converts the cap to a `recur_until`
      (simplest correct semantics).
- [ ] **Quick-add & keyboard shortcuts** · **P3** · L — fast capture plus a command palette. Pure
      parser `src/data/quickAdd.ts` (test-first): "groceries tomorrow" → `{ title, day }`; small
      token grammar (today/tomorrow/weekday/`MMM d`/`d/m`), no NLP dep; unrecognized dates → inbox.
      `Cmd/Ctrl+K` palette (quick-add + switch view/theme, go to today, new task); shortcuts (`n`,
      `t`, `1–4`, `/`) in one `useKeyboardShortcuts` hook that no-ops while a modal/input has
      focus. Keyboard drag: `KeyboardSensor` is already wired — verify cards stay focusable, add
      `aria-describedby` announcements, and make the focus ring visible per theme. Keep the
      shortcut set minimal and documented in a `?` help overlay.
- [ ] **Bulk multi-select** · **P3** · L — select several notes to move, delete, or recolor at
      once. Selection mode in `Board` (ctrl/cmd-click on desktop; explicit "Select" toggle on
      mobile); while active, disable drag via the existing `DragDisabledContext` (no sensor
      changes). Action bar (bottom sheet on mobile): move to day, set status, set color, delete —
      each one batched through new `useTasks.bulkUpdate` / `bulkDelete` (optimistic + rollback).
      Bulk delete of recurring instances routes through `planDeleteOccurrence` (`src/data/series.ts`)
      semantics — coalesce the N skip-list writes into one template update and surface a count note.
- [ ] **Undo** · **P3** · M — toast-based "undo last action" reusing the optimistic-rollback
      plumbing. Snapshot-based, scoped to board-safe ops: `useTasks` gains
      `pushUndo(label, prevTasks, prevTemplates)` before toggleDone, delete (non-recurring), bulk
      ops, drag persist, roll-forward; undo restores the snapshot and diff-upserts/deletes affected
      rows (deleted rows re-insert with original ids). Surface via `Toast.tsx` gaining an action
      button (6s). Series-level ops (`planEditSeriesFrom`/`planDeleteSeriesFrom` in
      `src/data/series.ts`) are **excluded** in v1; `planDeleteOccurrence` _is_ undoable (remove
      skip entry + re-insert). Undo after a realtime change from another device is last-write-wins;
      document it.
- [ ] **Completed / archive view + light stats** · **P3** · M — history of done tasks plus simple
      streak/throughput insight. "History" section on `/settings` (not a fifth board view): done
      tasks grouped by completion week. Small schema addition: `tasks.completed_at timestamptz`,
      set when status flips to done, cleared when it flips back. Stats: done-per-week bars (last 8
      weeks, plain divs — no chart dep) + current streak. Optional auto-archive: selector filter
      hiding done tasks older than 30 days from the board (they remain in History).

- [ ] **Two-factor (TOTP) enrollment UI** · **P3** · M — **production already allows TOTP and the
      app cannot reach it**: `supabase/config.toml`'s `[auth.mfa.totp]` sets `enroll_enabled` and
      `verify_enabled` true (max 10 factors), while nothing in `src/` calls `supabase.auth.mfa.*`.
      So this is closing a live gap, not adding a capability — and it needs **no config change**.
      Two halves: (a) a "Two-factor authentication" section on `/settings` — `mfa.enroll` (factor
      type `totp`) renders the returned QR SVG + secret, `mfa.challenge` + `mfa.verify` activate it,
      `mfa.listFactors` lists enrolled factors, `mfa.unenroll` removes one behind a confirm; (b) a
      step-up gate at login — after sign-in, `mfa.getAuthenticatorAssuranceLevel()` returning
      `currentLevel: 'aal1'` with `nextLevel: 'aal2'` must render a 6-digit challenge before the
      board, which belongs in `ProtectedRoute` (the one place every signed-in route passes through).
      Test with the `mfa` methods mocked, the way `Login.test.tsx` mocks auth today. Two risks to
      write down rather than discover: Supabase issues **no backup codes**, so a lost authenticator
      needs maintainer intervention on a solo project — say so in the settings copy; and RLS policies
      key on `auth.uid()` only, so enrolling does **not** harden the data boundary unless a policy
      later requires `aal2`. Do not gate RLS on AAL in the same PR.

## Phase 5 — Public face & admin

- [ ] **Roles & feature flags** · **P2** · L — the foundation the admin dashboard builds on.
      Schema: `user_roles (user_id pk, role text check (role in ('admin')))` — presence = admin,
      users read own row only; `feature_flags (key text pk, enabled boolean, description text)` —
      select for all authenticated, write for admins via `security definer` helper
      `public.is_admin()` (definer avoids RLS recursion). Admins seeded by SQL (no self-serve).
      App: `useFlags()` / `useRole()`; gate experimental features (labels, quick-add) behind flags
      for dark-launching. Don't put the role in the JWT yet — custom claims are a later
      optimization.
- [ ] **Admin dashboard** · **P2** · L — internal view for users, tasks, and flags; depends on
      roles & feature flags. `/admin` route gated on `useRole() === 'admin'` (the route gate is
      cosmetic — RLS enforces). Data via `security definer` RPCs that check `is_admin()`:
      `admin_stats()` (user/task counts, 30-day series), `admin_users(limit, offset)`. **No
      per-user task content access — stats only, by design** (a privacy stance worth keeping).
- [ ] **Custom auth domain** · **P3** · S (mostly ops) — the Google consent screen shows the
      `…supabase.co` callback host on the free tier. Supabase custom domain (paid add-on): CNAME
      `auth.magicagenda.app`, activate, update `VITE_SUPABASE_URL` in Pages env, redeploy. No code
      change. **Deferred by decision, not undecided:** priced 2026-07-26 at Supabase Pro ($25/mo,
      org-level) plus the custom-domain add-on ($10/mo, per project) = $35/mo. The plan decision
      went the other way for now — nightly encrypted `pg_dump` backups (v1.2.25) bought back Pro's
      strongest benefit for $0 — so this waits until the app has users beyond the maintainer. The
      same purchase is what would enable leaked-password protection (HIBP), the one open item from
      the security reviews.

- [ ] **Leaked-password protection (HIBP)** · **P3** · S (ops, no code) — the last open security
      finding, carried since 2026-06-30. Supabase checks new passwords against Have I Been Pwned
      (k-anonymity: only the first 5 hex chars of the SHA-1 leave the project), but it is a **Pro**
      feature, so this is the same $25/mo purchase as 5.6 and is deferred with it. Current
      mitigation, live in `config.toml`: `minimum_password_length = 10` plus
      `password_requirements = "lower_upper_letters_digits_symbols"` — that excludes most weak
      passwords and leaves exactly one hole, the breached-yet-complex password. When bought, this is
      a one-key config change that deploys through the existing `Deploy Auth Config` workflow. The
      full argument lives in the maintainer's git-ignored security reviews; it is named here so the
      public roadmap doesn't imply the item doesn't exist.

## Phase 6 — Bigger bets

Larger efforts that fit the app's direction but are not near-term.

- [ ] **iCal calendar feed** · **P3** · L — read-only `.ics` subscription so the board shows up in
      Google / Apple Calendar. Edge Function `ical` serving `text/calendar` at
      `?token=<uuid>`; schema: `user_settings.ical_token uuid default gen_random_uuid()` with a
      "rotate link" button on `/settings` (token = capability; document the secret-URL model).
      v1 exports recurring instances as literal events (simple and correct since instances are
      materialized rows); RRULE/EXDATE mapping is v2. Extract a pure `tasksToIcs()` module shared
      into the function dir, tested with Deno under the **existing** required `Functions` CI job
      (`ci.yml`, `deno test` run from inside `supabase/functions`). Cache 5 min via
      `Cache-Control` — calendar clients poll aggressively.
- [ ] **Attachments** · **P3** · L — file uploads on tasks via Supabase Storage. Bucket
      `attachments`, path `userId/taskId/filename`, storage RLS matching the path prefix to
      `auth.uid()`. Schema: `task_attachments` table (not jsonb — deletes cascade, quotas
      queryable). Editor upload section (10 MB cap, images + pdf first); image thumbnail chips with
      1h signed URLs. Task delete ⇒ DB cascade + best-effort storage delete (accept orphans;
      scheduled cleanup later). Watch free-tier storage egress/quota.
- [ ] **Multiple private boards** · **P3** · XL (multi-PR epic) — one account, many boards. This is
      the bulk of the lift, and it is worth having on its own: every hard part (containment, the RLS
      rewrite, per-board storage and realtime) is needed whether or not a second person ever joins.
      Milestone-level plan only; re-plan in detail when scheduled:
  1. **Landed 2026-08-13 (v1.2.76), schema and backfill only — this is one step of the epic, not the
      epic.** `account_profiles`, `boards`, and `board_memberships` (carrying `role` from the first
      migration — it is the column you never want to retrofit under live policies) exist, and every
      account has been backfilled with one board and an owner membership. `tasks.board_id` shipped
      **nullable**, not NOT NULL as originally sketched here: it becomes NOT NULL only at the
      authorization cutover in step 2, so the currently-deployed client — which sends no `board_id` —
      keeps working via a temporary insert trigger that must be dropped the moment a second board can
      exist. `tasks.revision` and the attribution columns (`author_id`, `last_editor_id`,
      `author_kind`) also landed with this step rather than waiting for step 2 as sketched below. None
      of it is an authorization boundary yet — `tasks` policies still compare `user_id` to
      `auth.uid()` — so containment is data integrity, not access control, until step 2 ships. See
      AGENTS.md § "Board ownership: schema is live, containment is not yet authoritative". The
      NOT NULL cutover itself is still ahead, and the reasoning for it wasn't relitigated:

      Explicitly *not* `NULL = personal board`: the zero-migration appeal is real, but it preserves
      two task-ownership models indefinitely, and every reader, policy, realtime filter, snapshot,
      and export path then has to handle both forever.
  2. RLS rewrite: task policies move from `user_id` to board membership — **the entire RLS suite
      gets re-reviewed**; the single riskiest change in the roadmap. (`tasks.revision` and the
      attribution columns already landed with step 1, ahead of this schedule.)
  3. App: board directory and selection, per-board offline snapshots with an authoritative
      access-loss purge, `board_id` realtime filter, and a one-board export/import format.
      **Partially landed, app layer only — no schema or RLS change, so this is still step 1's
      "not an authorization boundary yet."** `useBoardDirectory` now loads `board_memberships`
      joined to `boards`, remembers the open Board, and purges any Board snapshot the server stops
      returning; `useTasks` takes a `boardId` and loads/writes `.eq('board_id', boardId)`; board
      snapshots are keyed per Board. Still outstanding from this step: the realtime channel in
      `useSyncedTable` is still per-user, not per-Board, and `DataSection`'s import/export is
      scoped by `board_id` but the export file format itself is unchanged (still v1, not a
      one-Board format yet).
  4. Recurrence carries over cleanly — nothing keys on `user_id` except RLS — but its uniqueness
      and parent constraints become board-qualified so a series cannot span boards.

  4.2 is **interleaved with this item, not before or after it** — a shape the Deps column cannot
  express. Custom labels need the `boards` / `board_memberships` foundation above so they can be
  board-scoped from birth, and they should land before step 3 enables a second board, so the
  `category` → label migration happens while every account still has exactly one board. Sequencing
  them the other way costs a double migration; sequencing them later costs a riskier one.

- [ ] **Shared / collaborative boards** · **P3** · L — a second person on a board. Sits on top of
      6.2, which does the containment and authorization work; what is left is genuinely about other
      people:
  1. Invitations by verified email (Edge Function delivery — auth SMTP only sends auth templates),
     with rate limits and pending caps before the first one can be sent.
  2. Membership administration: roles, removal, leaving, the last-owner invariant under concurrency,
     and revoking access on a client that is currently online.
  3. Two product decisions this forces that 6.2 does not: whether tasks get an **assignee**, and who
     materialises recurrence on a board whose viewer cannot write.

  Depends on 6.2 and 5.4 (roles pattern). Note that feature flags matter *here*, not in 6.2 — this
  is the first change that reaches someone other than the account holder.
