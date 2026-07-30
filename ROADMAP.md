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
| 4.2   | Custom labels / categories       | P2  | XL   | —                      |
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
| 6.2   | Shared / collaborative boards    | P3  | XL   | 5.4, ideally 4.2       |

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
  - **A11y remediation has shipped.** The structural rules are cleared — `region`, `landmark-one-main`,
    `page-has-heading-one` and `select-name`, 177 of the 202 originally baselined. What remains is
    `color-contrast` 16 and `nested-interactive` 9, both deliberately deferred: contrast lives in
    `theme/themeConf.ts`, a verbatim port of the prototype, and nested-interactive needs `src/dnd`
    changes. See `docs/superpowers/specs/2026-07-30-a11y-landmarks-design.md`.
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
