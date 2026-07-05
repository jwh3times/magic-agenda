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
realtime multi-device sync) **shipped 2026-07-05** — see [CHANGELOG.md](./CHANGELOG.md) — and their
sections have been removed below; remaining dependencies on them are satisfied.

| Order | Item                             | Pri | Size | Hard dependencies  |
| ----- | -------------------------------- | --- | ---- | ------------------ |
| 2.1   | Due time / time-of-day           | P2  | M    | —                  |
| 2.2   | Priority via pins                | P2  | M    | —                  |
| 2.3   | Overdue handling & roll-forward  | P2  | M    | —                  |
| 2.4   | Export / import                  | P2  | M    | —                  |
| 3.1   | Installable PWA + offline read   | P2  | L    | —                  |
| 4.1   | Settings: week-start & timezone  | P3  | M    | —                  |
| 3.2   | Reminders / notifications        | P2  | XL   | 2.1, 3.1, 4.1      |
| 4.2   | Custom labels / categories       | P2  | XL   | —                  |
| 4.3   | Richer recurrence                | P3  | L    | —                  |
| 4.4   | Quick-add & keyboard shortcuts   | P3  | L    | —                  |
| 4.5   | Bulk multi-select                | P3  | L    | —                  |
| 4.6   | Undo                             | P3  | M    | best after 4.5     |
| 4.7   | Completed / archive view + stats | P3  | M    | —                  |
| 5.1   | Public landing page              | P3  | M    | —                  |
| 5.2   | Google "G" logo on OAuth button  | P3  | S    | —                  |
| 5.3   | Privacy & Terms links in-app     | P2  | S    | bundle with 5.1    |
| 5.4   | Roles & feature flags            | P2  | L    | —                  |
| 5.5   | Admin dashboard                  | P2  | L    | 5.4                |
| 5.6   | Custom auth domain               | P3  | S    | plan/cost decision |
| 6.1   | iCal calendar feed               | P3  | L    | —                  |
| 6.3   | Attachments                      | P3  | L    | —                  |
| 6.2   | Shared / collaborative boards    | P3  | XL   | 5.4, ideally 4.2   |

Total rough effort for the remaining items: ~8–12 weeks of focused solo work.

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

## Phase 2 — Scheduling depth

- [ ] **Due time / time-of-day** · **P2** · M — `day` is date-only; add an optional time so the
      calendar and agenda show _when_, not just _which day_. Schema:
      `alter table tasks add column at_time time;` (NULL = all-day, no backfill). App:
      `Task.atTime: 'HH:MM' | null` mapped in `mappers.ts`; optional clearable time input in the
      editor (≥16px on mobile); small per-theme time chip on cards. Agenda sorts timed-before-
      untimed then by time; day cells keep **manual drag order** (time is display metadata there —
      lane sorting would fight `reorder.ts`). Templates store the time; `makeInstance` copies it.
      Times are naive local until 4.1 adds a timezone. Unlocks reminders (3.2 needs a concrete
      "when").
- [ ] **Priority via pins** · **P2** · M — no priority field today; reuse the sticky-note pin
      visual to flag important notes. Schema:
      `alter table tasks add column pinned boolean not null default false;` Editor toggle + tap
      target on the card. Visuals per theme in `cardStyles.ts`: cork's existing pin becomes the
      pinned signal, brutal gets a corner flash, glass a glow border. **Decision**: manual order
      stays authoritative — pinned-first is an optional "Pinned" quick filter, not a forced sort,
      to avoid fighting drag reindexing.
- [ ] **Overdue handling & roll-forward** · **P2** · M — overdue =
      `isScheduled(day) && day < today && status !== 'done'`; derived, no schema. Overdue accent on
      cards + count badge on the Today button; agenda gains an "Overdue" group pinned to the top
      with a "Move all to today" button calling a new `rollForward()` in `useTasks` (batched
      `persistReorder`-style upsert appending to today's order). Auto roll-forward on load stays
      opt-in behind a settings toggle (column arrives in Phase 4; ship manual-only first).
      Recurring instances roll forward safely because identity is the immutable `recur_origin_day`.
- [ ] **Export / import** · **P2** · M — JSON backup and data ownership; client-only, from
      `/settings`. Export: `{ version: 1, exportedAt, settings, tasks, templates }` in app-domain
      shape. Import: validate with hand-rolled guards (no new dep) → remap all ids preserving
      `recurParentId` links → chunked batch insert via `taskToRow`. Additive only (no
      merge/overwrite); dupes are the user's to clean — say so in the UI copy. Imported templates
      arrive with their instances, so `reload()` after import naturally skips re-materialization.

## Phase 3 — PWA & notifications

- [ ] **Installable PWA + offline** · **P2** · L — no manifest or service worker today. Use
      `vite-plugin-pwa` (generateSW): manifest + maskable icons in `public/`; precache the app
      shell with `navigateFallback: index.html`; runtime-cache Google Fonts. **Never cache Supabase
      API responses in the SW** — auth-scoped data in a shared cache is a footgun. Offline data:
      last-known board snapshot in `localStorage` (written on every successful `reload()`/
      mutation); on boot without network, hydrate in **read-only mode** ("Offline — changes
      disabled" banner) — a write-queue/reconciler is explicitly out of scope (XL; revisit after
      realtime soaks). Update flow: `registerType: 'prompt'` + a "New version — refresh" toast.
      Realtime sync (shipped) already reloads on `online`, so offline snapshots and reconnects
      compose. Verify install on real
      iOS/Android.
- [ ] **Reminders / notifications** · **P2** · XL — web push (email fallback later); the
      highest-ops item on the list. Schema: `push_subscriptions` table (owner-only RLS) +
      `tasks.last_notified_at timestamptz` (prevents re-sends) +
      `user_settings.reminder_lead_minutes int` (NULL = off) — store nothing derived; a reminder is
      just `day` + `at_time` + lead time. Client: settings section with permission request +
      `PushManager.subscribe` (VAPID). Sender: `pg_cron` invoking an Edge Function every 5 minutes —
      query tasks due in the window (service role), send via a Deno `web-push` port, delete dead
      subscriptions on 404/410. iOS needs the PWA installed to Home Screen (16.4+) — surface in the
      settings copy. Do **after** 4.1's timezone setting or reminders fire in UTC. Depends on
      2.1, 3.1.

## Phase 4 — Productivity & personalization

- [ ] **Settings: week-start & timezone** · **P3** · M — completes the settings page; dates are
      effectively UTC today. Schema: `user_settings.week_start int not null default 0`,
      `user_settings.timezone text` (IANA, NULL = browser). `startOfWeek`, `buildWeekCells`,
      `buildMonthGrid` take a `weekStart` param (pure — test-first; weekday headers rotate);
      "today" moves behind `todayYmd(tz?)` in `lib/dates.ts` using `Intl.DateTimeFormat`. Risk:
      `weekStart` touches month-grid padding math — extend the existing selector tests for
      Monday-start.
- [ ] **Custom labels / categories** · **P2** · XL — `category` is a hardcoded 5-value enum; let
      users define their own labels and colors. The deepest data change on the list — three PRs:
  1. Schema + backfill: `labels` table (`id, user_id, name, dot_color, position`, owner-only RLS);
     `tasks.label_id uuid references labels on delete set null`. Backfill the 5 built-ins per
     existing user and map `category` → `label_id`; keep the `category` column temporarily
     (deploy-window tolerance), drop one release later. `handle_new_user` seeds defaults.
  2. App read path: `useLabels(userId)`; `Task.labelId`; `CAT` becomes a fallback. Card dot,
     editor picker, and filter dropdown consume the user's label list.
  3. Management UI on `/settings`: create/rename/recolor/reorder/delete (delete ⇒ "Unlabeled").

  Risk: the `Category` type is load-bearing in `constants.ts` — it dissolves into `string` label
  ids, a wide but shallow type ripple. Write the backfill migration idempotent.

- [ ] **Richer recurrence** · **P3** · L — specific weekdays (e.g. Mon/Wed/Fri) and "end after N
      occurrences", beyond daily/weekly/monthly + interval + until. Schema:
      `tasks.recur_weekdays int[]` (weekly templates only), `tasks.recur_count int` (mutually
      exclusive with `recur_until` in the editor; in data, whichever ends first wins). All logic in
      `src/data/recurrence.ts` test-first: `occurrencesFrom` gains weekday filtering and a count
      cap — the count is measured from the template's first occurrence, so materialization counts
      from `template.day`, not the horizon start. Trimming a count-capped series
      (`deleteSeriesFuture`) converts the cap to a `recur_until` (simplest correct semantics).
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
      Bulk delete of recurring instances routes through `deleteOccurrence` semantics — coalesce the
      N skip-list writes into one template update and surface a count note.
- [ ] **Undo** · **P3** · M — toast-based "undo last action" reusing the optimistic-rollback
      plumbing. Snapshot-based, scoped to board-safe ops: `useTasks` gains
      `pushUndo(label, prevTasks, prevTemplates)` before toggleDone, delete (non-recurring), bulk
      ops, drag persist, roll-forward; undo restores the snapshot and diff-upserts/deletes affected
      rows (deleted rows re-insert with original ids). Surface via `Toast.tsx` gaining an action
      button (6s). Series-level ops (`updateSeries`/`deleteSeriesFuture`) are **excluded** in v1;
      `deleteOccurrence` _is_ undoable (remove skip entry + re-insert). Undo after a realtime
      change from another device is last-write-wins; document it.
- [ ] **Completed / archive view + light stats** · **P3** · M — history of done tasks plus simple
      streak/throughput insight. "History" section on `/settings` (not a fifth board view): done
      tasks grouped by completion week. Small schema addition: `tasks.completed_at timestamptz`,
      set when status flips to done, cleared when it flips back. Stats: done-per-week bars (last 8
      weeks, plain divs — no chart dep) + current streak. Optional auto-archive: selector filter
      hiding done tasks older than 30 days from the board (they remain in History).

## Phase 5 — Public face & admin

- [ ] **Public landing page (unblocks Google OAuth branding verification)** · **P3** · M — Google's
      branding verification fails on three counts, all because `magicagenda.app` routes straight to
      the login wall: the home page is behind a login, doesn't explain the app's purpose, and the
      domain isn't verified as owned. Signed-out `/` renders a static marketing page (hero, theme
      screenshots, feature bullets, Privacy/Terms, "Get started"); signed-in `/` keeps rendering
      the board — `session ? <BoardPage/> : <Landing/>` in `App.tsx`, no URL migration, no broken
      bookmarks. Add real `<title>`/meta per route. Manual steps in the PR: verify the domain in
      Google Search Console, re-request OAuth branding review.
- [ ] **Google "G" logo on Continue-with-Google** · **P3** · S — replace the generic blue "G" with
      the official multi-color mark as an inline SVG in `Login.tsx`, per Google branding
      guidelines.
- [ ] **Privacy & Terms links while logged in** · **P2** · S — surface the legal pages from inside
      the app, not just the login screen. The `/settings` footer already links them (shipped with
      the settings page); remaining: a small link row in the mobile toolbar overflow. Bundle into
      the 5.1 PR.
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
      change. Blocked on the Supabase plan decision — a cost call.

## Phase 6 — Bigger bets

Larger efforts that fit the app's direction but are not near-term.

- [ ] **iCal calendar feed** · **P3** · L — read-only `.ics` subscription so the board shows up in
      Google / Apple Calendar. Edge Function `ical` serving `text/calendar` at
      `?token=<uuid>`; schema: `user_settings.ical_token uuid default gen_random_uuid()` with a
      "rotate link" button on `/settings` (token = capability; document the secret-URL model).
      v1 exports recurring instances as literal events (simple and correct since instances are
      materialized rows); RRULE/EXDATE mapping is v2. Extract a pure `tasksToIcs()` module shared
      into the function dir, tested with Deno in a new `Functions Test` CI job. Cache 5 min via
      `Cache-Control` — calendar clients poll aggressively.
- [ ] **Attachments** · **P3** · L — file uploads on tasks via Supabase Storage. Bucket
      `attachments`, path `userId/taskId/filename`, storage RLS matching the path prefix to
      `auth.uid()`. Schema: `task_attachments` table (not jsonb — deletes cascade, quotas
      queryable). Editor upload section (10 MB cap, images + pdf first); image thumbnail chips with
      1h signed URLs. Task delete ⇒ DB cascade + best-effort storage delete (accept orphans;
      scheduled cleanup later). Watch free-tier storage egress/quota.
- [ ] **Shared / collaborative boards** · **P3** · XL (multi-PR epic) — multi-user boards and task
      sharing; the largest lift. Milestone-level plan only; re-plan in detail when scheduled:
  1. Data model: `boards`, `board_members`, `tasks.board_id` (NULL = personal board — zero
     migration for existing data). RLS rewrite: task policies become "owner OR board member" via a
     definer helper — **the entire RLS suite gets re-reviewed**; the single riskiest change.
  2. App: board switcher, `useTasks(userId, boardId)`, invites by email (Edge Function).
  3. Presence & conflict: realtime (shipped) already gives multi-writer sync; add `tasks.updated_by`
     for per-card attribution.
  4. Recurrence carries over cleanly — nothing keys on `user_id` except RLS.

  Depends on 5.4 (roles pattern), ideally 4.2 (shared boards force per-board
  labels; sequence labels first to avoid a double migration).
