# Implementation Plan

A meticulous, codebase-grounded implementation plan for every item in [ROADMAP.md](../ROADMAP.md).
Each item specifies the approach, schema changes, code touch points, test strategy, risks, size, and
dependencies. Items are grouped into **phases ordered by dependency and priority** — the phase order
is the recommended build order; items within a phase are independent unless noted.

Sizes: **S** ≤ half a day · **M** 1–2 days · **L** 3–5 days · **XL** 1–2 weeks+.

## Cross-cutting conventions (apply to every item)

- **One PR per item** (or per slice of an L/XL item); `main` is PR-only with Format/Test/Build +
  CodeQL gates, and merging deploys to production (app via Cloudflare Pages, migrations via the
  `Deploy Migrations` workflow). Every schema PR ships app code that tolerates both the old and new
  schema during the deploy window, because migrations and the Pages build land at slightly
  different moments.
- **Schema changes**: new file under `supabase/migrations/`, then regenerate
  `src/types/database.types.ts` with `supabase gen types --linked`. All app↔DB conversions stay in
  `src/data/mappers.ts` (`'inbox'` ↔ `NULL`, `order` ↔ `order_index`, derived `done`); new columns
  extend `rowToTask` / `taskToRow` and nothing else touches row shapes.
- **RLS is the only authorization boundary.** Every new table default-denies and scopes to
  `auth.uid() = user_id` (or an explicit membership/role policy). Anything requiring privileges the
  anon key must not have (deleting auth users, cross-user reads, push sending) goes in a **Supabase
  Edge Function** or `security definer` RPC — never in the client.
- **Test-first for pure logic** (`src/data`, `src/dnd`, `src/lib`): write the unit test, then the
  implementation. UI work gets Testing Library coverage in the component's test file; phone-layout
  branches stub `matchMedia` (see the mobile block in `Board.test.tsx`).
- **Recurrence invariants**: templates stay hidden (`templatesRef`), instances are keyed by
  `(recur_parent_id, recur_origin_day)`, deletions go through `recurSkip`. Any feature touching
  tasks must decide explicitly how it treats templates vs. instances.
- **Optimistic writes with rollback** (the `useTasks` pattern): apply local state first, persist,
  restore `prev` + surface `error` on failure.

---

## Phase 0 — Enabling infrastructure

These unlock later items and should land first.

### 0.1 Edge Function scaffolding · S

Several items (delete account, iCal feed, push reminders) need server-side code. Set up
`supabase/functions/` with one hello-world function, local `supabase functions serve` docs in
CONTRIBUTING, and a `Deploy Functions` GitHub workflow mirroring `deploy-migrations.yml`
(trigger: `supabase/functions/**`; `supabase functions deploy --project-ref …` with the existing
access-token secret). Establish the auth pattern once: functions receive the caller's JWT, verify
it with `supabase.auth.getUser(jwt)`, and use the service-role key only after that check.

### 0.2 Settings page shell · M

ROADMAP lists this as P3 UX, but it is a **dependency hub**: account deletion, export/import,
labels management, week-start/timezone, and notification preferences all need a home. Build the
shell early; later items add sections.

- **Approach**: new route `/settings` (protected), `src/pages/SettingsPage.tsx`, themed with the
  existing `useTheme()` tokens. Move Theme + default-view pickers here (keep the compact toolbar
  ThemeSwitcher — settings duplicates, not replaces). Sections render from a small registry so
  later features append panels. Link from the toolbar (gear button; on mobile it joins row 1) and
  add Privacy/Terms links in its footer (part of item 6.3).
- **Schema**: none yet (week-start/timezone arrive in Phase 4).
- **Touch points**: `App.tsx` (route), `Toolbar.tsx`, new page + test.
- **Tests**: renders sections, theme change persists via `useSettings`.
- **Risks**: none notable.

---

## Phase 1 — The P1 items

### 1.1 Password reset · M

- **Approach**: two halves.
  1. _Request_: "Forgot password?" link on `Login.tsx` → small form →
     `supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/reset` })`. Always
     show "check your email" (don't leak account existence).
  2. _Complete_: new route `/auth/reset` (`ResetPassword.tsx`). Supabase signs the user in via the
     recovery link (`AuthCallback` already handles the token exchange); the page collects a new
     password (mirror `SIGNUP_MIN_PASSWORD = 10`) and calls `supabase.auth.updateUser({ password })`.
     Listen for the `PASSWORD_RECOVERY` event in `AuthProvider.onAuthStateChange` and route to
     `/auth/reset` so deep-linked recovery sessions can't land on the board silently.
- **Config (manual, document in PR)**: add `/auth/reset` to the Supabase Auth redirect allowlist;
  customize the reset email template.
- **Touch points**: `Login.tsx`, `AuthProvider.tsx`, `App.tsx`, new `ResetPassword.tsx` + test.
- **Tests**: form validation, success/error paths with a mocked `supabase.auth`.
- **Risks**: redirect-allowlist misconfig only fails in production — verify on a preview deploy.

### 1.2 Delete account · M

- **Approach**: client cannot delete an `auth.users` row. Edge Function `delete-account`
  (from 0.1): verify caller JWT → `admin.deleteUser(userId)` using the service-role client.
  `on delete cascade` from `auth.users` already removes tasks and settings (`init.sql`). UI: a
  "Danger zone" section on `/settings` requiring the user to type `delete` to confirm, then call
  the function, `signOut()`, and route to `/login` with a goodbye notice.
- **Schema**: none (cascades exist).
- **Tests**: unit-test the confirmation gating; function gets a Deno test asserting a request
  without a valid JWT is rejected.
- **Risks**: irreversible by design — the confirmation friction is the mitigation. Consider a
  follow-up export prompt ("download your data first", links item 3.3).

### 1.3 Realtime multi-device sync · L

The riskiest P1 because it intersects the recurrence and optimistic-update machinery.

- **Approach**:
  1. _Migration_: `alter publication supabase_realtime add table public.tasks, public.user_settings;`
     RLS already constrains change feeds to the owner (Supabase realtime respects RLS for
     `postgres_changes`).
  2. _Pure reducer first (test-first)_: `src/data/realtime.ts` —
     `applyChange(tasks, templates, change) → { tasks, templates }` handling INSERT/UPDATE/DELETE
     of both instances and templates: dedupe instances by the `(recurParentId, recurOriginDay)`
     key (another device may materialize the same occurrences; the DB unique index makes one
     insert win — the reducer must tolerate the echo), route template rows to `templatesRef`, and
     drop no-op updates.
  3. _Wire-up in `useTasks`_: subscribe to a per-user channel
     (`postgres_changes`, `filter: user_id=eq.${userId}`) after the initial `reload()`; feed events
     through the reducer via `setTasks` + `templatesRef`. **Self-echo suppression**: keep a
     short-lived `Set` of ids this client just wrote (populated in every mutation) and skip
     matching events — otherwise every optimistic write is immediately re-applied.
  4. _Fallbacks_: on channel error/close → `reload()` and resubscribe with backoff; also `reload()`
     on `visibilitychange` → visible and `online` events (mobile Safari kills sockets aggressively;
     this also improves today's manual-refresh story on phones).
  5. `useSettings`: same channel pattern; a theme change on device A restyles device B.
- **Touch points**: `useTasks.ts`, `useSettings.ts`, new `realtime.ts` + tests, one migration.
- **Tests**: reducer unit tests are the core (instance echo, template update propagating nothing
  by itself, delete of a template dropping its instances locally); a `useTasks`-level test with a
  mocked channel asserting self-echo suppression.
- **Risks**: double-materialization races (two devices materialize the same horizon — unique index
  - reducer dedupe handles it); `updated_at` ordering (last-write-wins is acceptable for a
    single-user board; document it); free-tier realtime connection limits (one channel per session).

---

## Phase 2 — Scheduling depth

### 2.1 Due time / time-of-day · M

- **Schema**: `alter table tasks add column at_time time;` (NULL = all-day). Nullable, no backfill.
- **App**: `Task.atTime: string | null` ('HH:MM'); map in `mappers.ts`. Editor: optional time input
  in the Schedule row (clearable; ≥16px on mobile). Cards: small time chip (`cardStyles.ts` per
  theme). Agenda groups sort timed-before-untimed, then by time, then `order`; day cells keep
  **manual drag order** (time is display metadata there — changing lane sorting would fight
  `reorder.ts`). Recurring: template stores the time; `makeInstance` copies it.
- **Tests**: mapper round-trip; agenda sorting in `selectors.test.ts`.
- **Risks**: timezone display (times are naive local, like `day`) — fine until item 4.1 adds an
  explicit timezone; note it in the PR.
- **Size**: M. **Unlocks**: reminders (3.2 needs a concrete "when").

### 2.2 Priority via pins · M

- **Schema**: `alter table tasks add column pinned boolean not null default false;`
- **App**: `Task.pinned`; editor toggle + tap target on the card (small pin button, like the done
  checkbox). Visuals in `cardStyles.ts`: cork already draws a pin — make it the _pinned_ signal
  (pinned = red pin, unpinned = none); brutal gets a corner flash, glass a glow border — per-theme
  branching as usual. Sorting: pinned-first **within a lane** as a selector-level sort applied in
  `notesForDay` / `tasksForStatus`… **decision**: keep manual order authoritative and make
  pinned-first optional via filter bar ("Pinned" quick filter) to avoid fighting drag reindexing.
- **Tests**: theme test for pin visuals per theme; filter test.
- **Risks**: interaction with drag order — resolved by not force-sorting.

### 2.3 Overdue handling & roll-forward · M

- **Approach**: overdue = `isScheduled(day) && day < today && status !== 'done'` — derived, no
  schema. (a) Visual: overdue accent on cards + count badge on the Today button. (b) Agenda gains
  an "Overdue" group pinned to the top. (c) Roll-forward: explicit button in the Overdue group
  ("Move all to today") calling a new `rollForward()` in `useTasks` — a batched
  `persistReorder`-style upsert setting `day = today` (appended to today's order). Auto roll-forward
  on load stays **opt-in** behind a settings toggle (Phase 4 adds the column; ship manual-only
  first).
- **Recurrence**: instances roll forward like normal tasks — safe because identity is
  `recur_origin_day`, which never changes (this is exactly what the origin-day migration enables).
- **Tests**: pure `overdueTasks(tasks, today)` selector + roll-forward reindex math, test-first.
- **Risks**: none major; batch upsert reuses the proven reorder path.

### 2.4 Export / import · M

- **Approach**: client-only. _Export_: serialize `{ version: 1, exportedAt, settings, tasks,
templates }` (app-domain shape, not row shape) to a downloaded JSON file — from `/settings`.
  _Import_: file picker → validate shape (hand-rolled guards; no new dep) → remap all ids
  (`newId()`, preserving `recurParentId` links and checklist ids) → batch insert via `taskToRow`,
  chunked ~200 rows. Additive only (no merge/overwrite semantics) — dupes are the user's to clean;
  document in the UI copy.
- **Tests**: round-trip (export → import produces equivalent tasks, fresh ids, intact
  template↔instance links); validator rejects malformed files.
- **Risks**: importing a series whose horizon already materialized → instances come _with_ the
  export, so skip re-materialization for imported templates on the same load (`reload()` after
  import handles it naturally).

---

## Phase 3 — PWA & notifications

### 3.1 Installable PWA + offline · L

- **Approach**: `vite-plugin-pwa` (generateSW mode).
  1. Manifest: name/short_name, theme/background colors per default theme, maskable icons
     (generate from the logo; add to `public/`).
  2. Precache the app shell (build assets); `navigateFallback: index.html` for the SPA. Runtime
     caching: Google Fonts (stale-while-revalidate). **Never cache Supabase API responses in the
     SW** — auth-scoped data in a shared cache is a footgun.
  3. Offline data: last-known board snapshot in `localStorage` (tasks + templates keyed by user
     id, written on every successful `reload()`/mutation). On boot without network, `useTasks`
     hydrates from the snapshot in **read-only mode** (banner: "Offline — changes disabled");
     mutations stay disabled rather than building a write-queue/reconciler (that's XL territory;
     explicitly out of scope, revisit after realtime has soaked).
  4. Update flow: `registerType: 'prompt'` + a "New version — refresh" toast (reuse `Toast.tsx`).
- **Tests**: snapshot hydrate/persist unit tests; manifest presence asserted in build (CI check
  that `dist/manifest.webmanifest` exists).
- **Risks**: stale-shell bugs (mitigated by prompt-update); iOS PWA quirks (no push without 16.4+,
  see 3.2). Verify install on real iOS/Android.
- **Depends on**: nothing hard, but do after 1.3 so offline snapshots and realtime reconnects
  compose (`reload()` on `online` already exists).

### 3.2 Reminders / notifications · XL

- **Approach** (web push; email fallback later):
  1. _Schema_: `push_subscriptions` table (`id, user_id, endpoint unique, keys jsonb, created_at`,
     RLS owner-only) + `remind_at timestamptz` computed at write time? **No** — store nothing
     derived: reminder = task with `day` + `at_time` and a per-user lead-time preference
     (`user_settings.reminder_lead_minutes int`, NULL = off).
  2. _Client_: settings section — permission request, `PushManager.subscribe` with VAPID public
     key, save subscription; toggle per task is a non-goal for v1.
  3. _Sender_: `pg_cron` (Supabase-hosted) invoking an Edge Function every 5 minutes: query tasks
     due within the window for users with subscriptions (service role), send via `web-push` (Deno
     port), delete dead subscriptions on 404/410. Store `last_notified_at` on tasks to prevent
     re-sends.
  4. iOS requires the PWA installed to Home Screen (16.4+); surface that in the settings copy.
- **Depends on**: 0.1 (functions), 2.1 (due time), 3.1 (installability). **Schema**: table +
  `tasks.last_notified_at timestamptz` + settings column, one migration.
- **Tests**: window-selection query logic as a pure SQL test via a `security definer` RPC unit
  (or extract the window math into the function and test with Deno); client subscribe flow mocked.
- **Risks**: highest-ops item on the list (VAPID keys as function secrets, cron reliability,
  timezone correctness — do **after** 4.1's timezone setting or reminders will fire in UTC).

---

## Phase 4 — Productivity & personalization

### 4.1 Settings: week-start & timezone · M

Completes 0.2. **Schema**: `user_settings.week_start int not null default 0` (0=Sun, 1=Mon),
`user_settings.timezone text` (IANA name, NULL = browser). App: `startOfWeek`, `buildWeekCells`,
`buildMonthGrid` take a `weekStart` param (pure — test-first; weekday header arrays rotate);
"today" derivation (`ymd(new Date())`) moves behind `todayYmd(tz?)` in `lib/dates.ts` using
`Intl.DateTimeFormat` with the configured zone. Thread via `useSettings` → `Board` → views.
**Risks**: `weekStart` touches month-grid padding math — the existing selector tests are the
safety net; extend them for Monday-start.

### 4.2 Custom labels / categories · XL

The deepest data change on the list — plan as three PRs.

1. **Schema + backfill** (`labels` table: `id, user_id, name, dot_color, position`, RLS
   owner-only; `tasks.label_id uuid references labels on delete set null`). Backfill: insert the
   5 built-in labels per existing user (a migration `do` block over `auth.users`), map
   `tasks.category` → `label_id`. Keep `category` column + check constraint temporarily
   (deploy-window tolerance), drop in a follow-up migration one release later. Signup trigger
   (`handle_new_user`) seeds the default 5 for new users.
2. **App read path**: `useLabels(userId)` hook (CRUD + realtime later); `Task.labelId`;
   `CAT` constant becomes a fallback for label-less rendering. Card dot/label, editor picker,
   filter dropdown all consume the user's label list.
3. **Management UI**: settings section — create/rename/recolor/reorder/delete (delete ⇒
   `label_id` nulls out; UI shows "Unlabeled"). Color options reuse `CAT` dot palette + a few new.

- **Tests**: mapper, backfill idempotence (write the migration so re-running is safe), filter by
  label, editor picker.
- **Risks**: the enum is load-bearing in `constants.ts` `CAT` (typed `Record<Category, …>`) —
  the `Category` type dissolves into `string` label ids; expect a wide but shallow type ripple
  (`task.ts`, `filters.ts`, `TaskEditor`, `TaskCard`, `SearchFilterBar`, tests).

### 4.3 Richer recurrence · L

- **Schema**: `tasks.recur_weekdays int[]` (0–6, weekly templates only) and
  `tasks.recur_count int` ("end after N occurrences"; mutually exclusive with `recur_until` —
  enforce in the editor, tolerate both in data by treating whichever ends first).
- **App**: all logic lands in `src/data/recurrence.ts` **test-first**: `occurrencesFrom` gains
  weekday filtering and a count cap (count is measured from the template's first occurrence, so
  materialization must count _all_ occurrences from `template.day`, not from the horizon start —
  the existing skip/origin machinery is unaffected because identity stays the origin date).
  Editor: weekday chips when freq = weekly; "until date / after N times" radio. `updateSeries` and
  `deleteSeriesFuture` need one decision documented in code: trimming a count-capped series
  converts the cap to a `recur_until` (simplest correct semantics).
- **Tests**: heavy pure-function coverage (Mon/Wed/Fri patterns, count caps crossing the 90-day
  horizon, skip + count interaction, interval × weekday combos).
- **Risks**: correctness of count-across-horizon; mitigated by the pure-function-first approach.

### 4.4 Quick-add & keyboard shortcuts · L

- **Approach**: (a) Pure parser `src/data/quickAdd.ts` (test-first): "groceries tomorrow",
  "dentist fri", "report jul 22" → `{ title, day }`; unrecognized dates → inbox. No NLP dep —
  a small token grammar (today/tomorrow/weekday names/`MMM d`/`d/m`). (b) Command palette:
  `Cmd/Ctrl+K` overlay with the quick-add input + actions (switch view, switch theme, go to
  today, new task). (c) Shortcuts: `n` new task, `t` today, `1–4` views, `/` focus search —
  registered in one `useKeyboardShortcuts` hook that no-ops when a modal/input has focus.
  (d) Keyboard drag: `KeyboardSensor` is already wired; verify `useSortable`'s spread
  `attributes` leave cards focusable (tabIndex 0) and add `aria-describedby` announcement text —
  fix focus styling so the ring is visible per theme.
- **Tests**: parser table-driven tests; palette open/execute; shortcut suppression while typing.
- **Risks**: shortcut collisions with browser/OS — keep the set minimal and documented in a `?`
  help overlay.

### 4.5 Bulk multi-select · L

- **Approach**: selection mode in `Board` (long-press on desktop = ctrl/cmd-click; explicit
  "Select" toolbar toggle on mobile). Selected ids in `Board` state; cards render a check overlay.
  While active, disable drag via the existing `DragDisabledContext` (same mechanism as filtering —
  no sensor changes). Action bar (bottom sheet on mobile): move to day (date picker), set status,
  set color, delete. Each action = one batched upsert/delete through new `useTasks.bulkUpdate` /
  `bulkDelete` (optimistic + rollback like everything else). Recurring instances participate;
  bulk delete of an instance routes through `deleteOccurrence` semantics (skip-list) — surface a
  count note ("3 repeating tasks will skip this occurrence").
- **Tests**: selection reducer; bulk ops in a `useTasks`-style harness; DnD stays disabled.
- **Risks**: recurrence-delete semantics — reusing `deleteOccurrence` per instance keeps it
  correct if slower (N updates to the template's skip list → coalesce into one template update).

### 4.6 Undo · M

- **Approach**: snapshot-based, scoped to _board-safe_ ops. `useTasks` gains an internal
  `pushUndo(label, prevTasks, prevTemplates)` before: toggleDone, delete (non-recurring), bulk
  ops, drag persist, roll-forward. Undo = restore snapshot locally + diff-upsert/delete the
  affected rows (reuse the reorder upsert path; deleted rows re-insert with their original ids).
  Surface via `Toast.tsx` gaining an action button ("Deleted 'X' — Undo", 6s). Recurrence
  series-level ops (updateSeries/deleteSeriesFuture) are **excluded** in v1 (their inverse is
  genuinely complex); deleteOccurrence _is_ undoable (remove the skip entry + re-insert).
- **Tests**: undo after each covered op restores exact state (ids included); toast timing.
- **Risks**: undo after a realtime change from another device — snapshot may resurrect a task
  edited elsewhere; acceptable last-write-wins, document it.

### 4.7 Completed / archive view + light stats · M

- **Approach**: no schema. "History" section on `/settings` (not a fifth board view — keeps the
  ViewSwitcher tight): done tasks grouped by completion week (needs `completed_at` — **small
  schema addition**: `tasks.completed_at timestamptz`, set in `applyToggleDone` mapping when
  status flips to done, cleared when it flips back). Stats: done-per-week bar (last 8 weeks,
  plain divs — no chart dep), current streak (consecutive days with ≥1 completion). Optional
  auto-archive (hide done tasks older than 30 days from the board via a selector filter — they
  remain in History).
- **Tests**: streak/week-bucket pure functions test-first; `completed_at` mapper round-trip.

---

## Phase 5 — Public face & admin

### 5.1 Public landing page · M

- **Approach**: signed-out `/` renders a static marketing page (hero, three theme screenshots,
  feature bullets, Privacy/Terms links, "Sign in / Get started") instead of redirecting to
  `/login`; signed-in `/` keeps rendering the board (no URL migration — nothing moves to `/app`,
  no bookmarks break). Implementation: `App.tsx` route for `/` becomes
  `session ? <BoardPage/> : <Landing/>`; `Landing.tsx` reuses `LegalLayout`'s styling approach.
  Add real `<title>`/meta per route. **Manual steps documented in the PR**: verify
  `magicagenda.app` in Google Search Console, re-request OAuth branding review (this unblocks all
  three Google findings: public home, purpose explanation, domain ownership).
- **Tests**: routing test (signed-out sees landing; signed-in sees board).
- **Risks**: none technical; OAuth review turnaround is external.

### 5.2 Google "G" logo on the OAuth button · S

Official multi-color G as an inline SVG asset in `Login.tsx`, per Google branding
guidelines (fixed padding/contrast rules). Pure asset swap + snapshot-style test.

### 5.3 Privacy & Terms links while logged in · S

Footer links in `/settings` (done as part of 0.2) **plus** a small link row under the board
toolbar overflow on mobile. Trivial; bundle into the 0.2 or 5.1 PR if convenient.

### 5.4 Roles & feature flags · L

- **Schema**: `user_roles (user_id pk references auth.users, role text check (role in ('admin')))`
  — presence = admin; RLS: users read own row only. `feature_flags (key text pk, enabled boolean,
description text)` — RLS: select for all authenticated, write for admins via a policy on a
  `security definer` helper `public.is_admin()` (`exists (select 1 from user_roles where user_id =
auth.uid())` — definer avoids RLS recursion). Admins are seeded by SQL (no self-serve).
- **App**: `useFlags()` (load once, expose `flag(key)`), `useRole()`. Gate experimental features
  (labels, quick-add) behind flags to allow dark-launching.
- **Tests**: `is_admin` policy behavior via mapper-level integration is impractical client-side —
  cover the hook logic; policy correctness reviewed via the `code-reviewer` agent checklist (RLS
  section).
- **Risks**: RLS recursion (solved by the definer helper); don't put role in the JWT yet — a
  custom-claims auth hook is an optimization for later.

### 5.5 Admin dashboard · L

- **Approach**: `/admin` route gated on `useRole() === 'admin'` (and RLS actually enforcing —
  the route gate is cosmetic). Data via `security definer` RPCs that internally check
  `is_admin()`: `admin_stats()` (user count, task count, tasks/day 30-day series),
  `admin_users(limit, offset)` (id, email, created_at, task count). Flag toggles write
  `feature_flags` directly (RLS-permitted for admins). No per-user task _content_ access — stats
  only, by design (privacy stance worth keeping).
- **Depends on**: 5.4.
- **Tests**: role-gated routing; RPC guards return empty/error for non-admins (documented manual
  check against a branch DB).

### 5.6 Custom auth domain · S (mostly ops)

Supabase custom domain (paid add-on): CNAME `auth.magicagenda.app` → project, activate in
dashboard, update `VITE_SUPABASE_URL` in Pages env, redeploy; Google OAuth consent then shows the
branded host. **No code change** beyond the env var. Document in README deploy section. Blocked
on the Supabase plan decision — flag as a cost call.

---

## Phase 6 — Bigger bets

### 6.1 iCal calendar feed · L

- **Approach**: Edge Function `ical` serving `text/calendar` at
  `/functions/v1/ical?token=<uuid>`. **Schema**: `user_settings.ical_token uuid default
gen_random_uuid()`, regenerate-able from `/settings` ("rotate link"). The function looks up the
  token with the service role (token = capability; document the secret-URL model in the UI),
  emits VEVENTs: scheduled tasks as all-day (or timed once 2.1 lands) events; recurring templates
  as `RRULE:FREQ=…;INTERVAL=…` + `EXDATE` from `recurSkip` — mapping our model to RRULE keeps the
  feed small and correct for moved instances via `RECURRENCE-ID` overrides (v2; v1 exports
  instances as literal events, simpler and correct because instances are materialized rows).
- **Tests**: pure `tasksToIcs(tasks, templates)` generator unit-tested in `src/`… no — the
  generator lives in the function; extract to a shared pure module vendored into the function dir
  and test with Deno test in CI (new `Functions Test` job).
- **Risks**: calendar clients poll aggressively (cache 5 min via `Cache-Control`); token leakage
  (rotation UI is the answer).

### 6.2 Shared / collaborative boards · XL (multi-PR epic)

Plan only at milestone level; re-plan in detail when scheduled:

1. **Data model**: `boards (id, owner_id, name)`, `board_members (board_id, user_id, role
member|editor)`, `tasks.board_id uuid` (NULL = personal board, preserving today's semantics —
   zero-migration for existing data). RLS rewrite: task policies become "owner OR member of
   task's board" via definer helper `can_access_board(board_id)` — **the entire RLS suite gets
   re-reviewed**; this is the single riskiest change in the epic.
2. **App**: board switcher (toolbar), `useTasks(userId, boardId)`, invites by email (Edge
   Function creating a pending membership + magic link).
3. **Presence & conflict**: realtime (1.3) already gives multi-writer sync; add per-card "edited
   by" attribution (`tasks.updated_by uuid`).
4. **Recurrence on shared boards**: templates belong to the board, skip-lists are shared — the
   semantics carry over cleanly because nothing keys on `user_id` except RLS.

- **Depends on**: 1.3 (realtime), 5.4 (roles pattern), ideally 4.2 (labels are per-user today —
  shared boards force per-board labels; sequence labels first to avoid double migration).

### 6.3 Attachments · L

- **Approach**: Supabase Storage bucket `attachments`, path convention `userId/taskId/filename`;
  storage RLS policies matching path prefix to `auth.uid()`. **Schema**: `task_attachments (id,
task_id references tasks on delete cascade, user_id, path, name, size, created_at)` — a table,
  not jsonb, so deletes can cascade and quotas can be queried. Editor section: upload (10 MB cap,
  images + pdf first), thumbnail chip on cards (image attachments only, signed URLs with 1h
  expiry). Delete task ⇒ DB cascade + a cleanup Edge Function or client best-effort storage
  delete (accept orphans; scheduled cleanup function later).
- **Tests**: attachment mapper/hook with mocked storage; RLS path policy reviewed manually.
- **Risks**: storage egress/quota on free tier — cap sizes; orphaned files (documented cleanup
  strategy).

---

## Suggested sequence at a glance

| Order | Item                                | Size | Hard dependencies     |
| ----- | ----------------------------------- | ---- | --------------------- |
| 0.1   | Edge Function scaffolding           | S    | —                     |
| 0.2   | Settings page shell (+ legal links) | M    | —                     |
| 1.1   | Password reset                      | M    | —                     |
| 1.2   | Delete account                      | M    | 0.1                   |
| 1.3   | Realtime sync                       | L    | —                     |
| 2.1   | Due time                            | M    | —                     |
| 2.2   | Priority pins                       | M    | —                     |
| 2.3   | Overdue & roll-forward              | M    | —                     |
| 2.4   | Export / import                     | M    | 0.2                   |
| 3.1   | Installable PWA + offline read      | L    | best after 1.3        |
| 4.1   | Week-start & timezone               | M    | 0.2                   |
| 3.2   | Reminders / push                    | XL   | 0.1, 2.1, 3.1, 4.1    |
| 4.2   | Custom labels                       | XL   | 0.2                   |
| 4.3   | Richer recurrence                   | L    | —                     |
| 4.4   | Quick-add & shortcuts               | L    | —                     |
| 4.5   | Bulk multi-select                   | L    | —                     |
| 4.6   | Undo                                | M    | best after 4.5        |
| 4.7   | Archive + stats                     | M    | 0.2                   |
| 5.1   | Landing page                        | M    | —                     |
| 5.2   | Google G logo                       | S    | —                     |
| 5.4   | Roles & feature flags               | L    | —                     |
| 5.5   | Admin dashboard                     | L    | 5.4                   |
| 5.6   | Custom auth domain                  | S    | plan/cost decision    |
| 6.1   | iCal feed                           | L    | 0.1                   |
| 6.3   | Attachments                         | L    | 0.1                   |
| 6.2   | Shared boards                       | XL   | 1.3, 5.4, ideally 4.2 |

Total rough effort: ~10–14 weeks of focused solo work; the P1 block (0.1 → 1.3) is ~1.5–2 weeks.
