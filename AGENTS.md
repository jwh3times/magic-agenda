# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## What this is

Magic Agenda is a drag-and-drop task board (calendar / week / agenda / kanban views — the four
`ViewName`s — recurring tasks, three visual themes) built as a pure React + TypeScript SPA on Supabase
(Postgres + Auth), deployed to Cloudflare Pages at [magicagenda.app](https://magicagenda.app). Pages
live in `src/pages/`: `BoardPage` (the app), `SettingsPage`, `Landing` (the public marketing page at
`/` for signed-out visitors), `Login`, `AuthCallback`, `AuthConfirm`, `ResetPassword`, and the static
legal pages `Privacy` / `Terms` (both rendered through `src/components/LegalLayout.tsx`).

## Commands

```bash
npm run dev            # Vite dev server at http://localhost:5173
npm run build          # tsc -b (typecheck) && vite build -> dist/
npm test               # vitest run (all tests once)
npm run test:watch     # vitest watch mode
npm run lint           # eslint
npm run format         # prettier --write (src only; design/ is .prettierignore'd)
npm run format:check   # prettier --check (the CI "Format" job runs this + lint)
npm run codex:sync     # regenerate Codex's agent config from .claude/ (see below)
npm run codex:check    # verify it is in sync (the CI "Agents" job runs this)

# Run one test file or one test by name:
npx vitest run src/dnd/reorder.test.ts
npx vitest run -t "persists a cross-lane move"

# Database (Supabase CLI; project is linked):
npx supabase db push                                              # apply supabase/migrations/*
npx supabase gen types typescript --linked > src/types/database.types.ts
```

Tests are hermetic: `vite.config.ts` injects dummy `VITE_SUPABASE_*` env, so they never hit the real
project. Local dev needs a real `.env.local` (copy `.env.example`); `src/lib/supabase.ts` throws at
startup if the two `VITE_SUPABASE_*` vars are missing.

`main` is **protected: PR-only, no direct pushes** (no admin bypass). Land changes via a branch + PR;
the `Format` / `Test` / `Build` / `Functions` / `Agents` / `Changelog` / `Config` checks and CodeQL must
pass and review threads resolve before merge (0 approvals required, so you can self-merge once green).
`Config` previews the pending `supabase config push` on PRs touching `supabase/config.toml` or
`supabase/templates/**` and no-ops elsewhere — it is required, so it reports on every PR. Branch names must not start
with `release/` — a ruleset protects that namespace and rejects the push; use `chore/release-vX.Y.Z`. Cloudflare Pages builds & deploys `main`
(`npm run build` -> `dist`), so production only ships after a checks-passing merge. Database migrations
are applied to production on the same merge by the `Deploy Migrations` workflow (triggered by changes
under `supabase/migrations/**`). `VITE_*` vars are inlined at **build time**, so they must be set in the
Pages project, not just locally. Every merge to `main` is also a release: the `Version` workflow
(`.github/workflows/version.yml`) tags `v<major>.<minor>.<build>` and creates a GitHub Release. The
next version is computed by `scripts/next-version.mjs` — the single source of truth, also called by the
CI guard below: for an existing major/minor line the build auto-increments from the highest existing
`v<major>.<minor>.*` tag; for a new major/minor line the `package.json` build is used as-is, so `x.y.0`
is valid and does not auto-bump to `x.y.1`. Because every merge ships, **`CHANGELOG.md` names the exact
version each merge will mint**: a PR adds a `## [x.y.z]` section for its target version (from that
script). The required `Changelog` job runs `scripts/check-changelog.mjs`, which enforces both that the
PR names its target version **and** that every already-released 3-part tag has a section. Dependabot
PRs are exempt from the first (a bot can't write an entry) — so their merges ship undocumented, and
the second rule fails the next human PR until those builds are backfilled. That job must keep
reporting a status on **every** PR including Dependabot's (the exemption lives inside the step, not in
a job-level `if:`) — a required check that never runs leaves a PR unmergeable forever. The `ship`
skill automates the whole flow, backfill included.

## Architecture (the parts that span multiple files)

Pure SPA -> Supabase, no server of our own. Postgres **Row-Level Security is the only authorization
boundary** (every table default-denies and scopes to `auth.uid() = user_id`); the anon key is public
by design.

Dated security reviews live in `private/` — **git-ignored, local to the maintainer's checkout**, so
they are not in a clone. They are where accepted risks and open findings are recorded, with the
reasoning. If that directory is present, read the newest one before changing auth, RLS, realtime
publication, or the Edge Functions; several non-obvious decisions in this repo (the redirect
allow-list wildcard, tokens in `localStorage`, the realtime DELETE fan-out) are accepted risks
argued there, not oversights to "fix". If it is absent, treat those decisions as load-bearing and
ask before changing them.

### Auth: PKCE, not implicit-flow URL fragments

`src/lib/supabase.ts` sets `flowType: 'pkce'` and, critically, `detectSessionInUrl: () => false` (the
**function** form, not `false`): that disables implicit adoption of `#access_token=` URL fragments — a
session-fixation vector, since that path has no state/nonce binding — while leaving PKCE `?code=`
handling intact for Google OAuth (`AuthCallback`). Password-reset and signup-confirmation email links
now carry `?token_hash=` and are redeemed explicitly via `supabase.auth.verifyOtp()`: `ResetPassword`
(`/auth/reset`) renders its form on `session && passwordRecovery`, never on "`verifyOtp` succeeded this
mount" (the token is single-use, so reloads and `ProtectedRoute` re-entry must still work); `AuthConfirm`
(`/auth/confirm`, a public route) redeems a signup token and signs the user straight in, skipping the
old "confirm, then come back and sign in" round trip. Both pages refuse to redeem over an existing
session (the residual session-fixation guard). `AuthProvider` / `ProtectedRoute` are unchanged —
`verifyOtp({ type: 'recovery' })` still fires `PASSWORD_RECOVERY` itself.

### App / DB boundary conventions: get these wrong and data breaks subtly

- **`'inbox'` <-> `NULL`**: the app `Task.day` is the literal `'inbox'` (unscheduled) or `'YYYY-MM-DD'`.
  The `'inbox'` sentinel stays everywhere in app/DnD logic and maps to a `NULL` `day` **only** in
  `src/data/mappers.ts`.
- **`order` is reserved SQL** -> the column is `order_index`; the app keeps `order`/`korder`.
- **`done` is derived** (`status === 'done'`), never stored.
- These conversions live entirely in `mappers.ts` (`rowToTask` / `taskToRow`). Everything else works in
  app-domain `Task` objects (`src/types/task.ts`).

### Data ownership: `BoardPage` owns state, `Board` is prop-driven

`pages/BoardPage.tsx` wires `useTasks(userId, hasSession)` + `useSettingsContext()` +
`ThemeProvider` and passes tasks and every mutation down to `components/Board.tsx` as props.
`Board` holds only **UI** state (view, anchor date, editing modal, pop animation, filter). This
decoupling is deliberate: it keeps `Board` testable without Supabase (`Board.test.tsx` renders it
with a stateful `Harness`). `useTasks` is the single source of truth for board tasks: optimistic
CRUD with rollback, plus `persistReorder` (upserts only the changed lanes). To follow a write
end-to-end, read `BoardPage` -> `Board` -> `useTasks`.

Settings are **session-scoped, not page-scoped**: `SettingsProvider` (`src/data/SettingsProvider.tsx`)
owns the single `useSettings(userId, hasSession)` call above `<Routes>` in `App.tsx`, so navigating
between `/` and `/settings` no longer refetches or rebuilds the realtime channel. It mounts for
signed-out visitors too, which is why `useSettings` no-ops on an empty `userId`. `useTasks` is
deliberately **not** hoisted with it — `BoardPage` is lazy-loaded to keep dnd-kit and the board data
layer out of the entry chunk.

**Both hooks take `userId` and `hasSession` as separate arguments on purpose.** `userId` may resolve
from the last-known id in `localStorage` with no live session behind it (the offline-boot fallback),
which is fine for _reading_ a snapshot — but a snapshot _write_ requires the stricter `hasSession`.
Collapsing the two is not hypothetical: a signed-out visitor with a stale `ma-last-user` queries
`user_settings` from the public landing page, RLS returns zero rows **with no error**, and treating
that as "no row yet" overwrites the user's saved settings snapshot with `DEFAULTS`. The same
conflation lets a sessionless reconnect persist an empty board. See the docstrings on
`useTasks`/`useSettings`.
`useTasks` and `useSettings` also subscribe to Supabase realtime (`postgres_changes`,
per-user channel): remote changes flow through the pure reducer in `src/data/realtime.ts`
(instance dedupe by `(recurParentId, recurOriginDay)`, templates routed to `templatesRef`),
while a short-TTL own-write set suppresses each client's own echoes. On channel error the
hook reloads and resubscribes with backoff; `visibilitychange`/`online` also trigger a
`reload()`.

### Recurrence is a hidden-template model (the most complex subsystem)

A recurring series is a **hidden template row** (`recurFreq != 'none'`, `recurParentId === null`, see
`isTemplate()`) that is **kept out of the board `tasks` list** (held in a separate ref inside
`useTasks`) plus **materialized instance rows** (`recurFreq 'none'`, `recurParentId = template id`).
Keeping templates out of the board list is what keeps reorder/DnD math clean. On load, `useTasks`
materializes any missing instances over a rolling 90-day horizon using the pure functions in
`src/data/recurrence.ts`; deleted occurrences are remembered in a per-template `recurSkip` array so they
are never regenerated. Edit/delete carry **this-occurrence vs. all-future** scope (the editor's scope
prompt -> `Board` routes to `updateSeries` / `deleteOccurrence` / `deleteSeriesFuture`). `reload()` has an
in-flight guard because React StrictMode double-invokes the load effect, which otherwise double-inserts
instances and trips the `(recur_parent_id, day)` unique index (Postgres 23505).

### Drag-and-drop: pure core, then dnd-kit wiring

`src/dnd/reorder.ts` is **pure and unit-tested** (`moveToDay` / `moveToStatus` / `reindex` /
`findContainer`): it reindexes **both** the source and destination lanes on a cross-container move.
`src/dnd/useBoardDnd.ts` wires dnd-kit: `onDragOver` does optimistic cross-lane moves; `onDragEnd`
persists the touched lanes. Critical, non-obvious detail: persistence must fire **even when
`over.id === active.id`** (after an optimistic move the dragged card sits under the cursor as its own
drop target), tracked via a `didMove` ref. Container ids are `dateStr | 'inbox'` (day mode) or status
(kanban). While a search filter is active, drag is disabled via `DragDisabledContext` (consumed by
`SortableCard`'s `useSortable({ disabled })`); this keeps the `DndContext` sensors array a constant
size, avoiding a dnd-kit hook-deps warning. Sensors are split Mouse/Touch (not `PointerSensor`):
touch drags require a **250ms long-press** and cards use `touchAction: 'manipulation'`; together
that's what lets a plain swipe over a card scroll the board on phones. Do not collapse these back
into a `PointerSensor` or set `touchAction: 'none'`.

### Responsive layout branches on `useIsMobile()`, not CSS media queries

Because styles are inline objects (below), media queries cannot reach them. Components that adapt to
phones (`Board`, `Toolbar`, `CalendarView`, `WeekView`, `KanbanView`, `Inbox`, `SearchFilterBar`,
`TaskEditor`) call `useIsMobile()` from `src/lib/useMediaQuery.ts` (a reactive `matchMedia` hook;
breakpoint `MOBILE_QUERY` = 760px) and branch in JSX, spreading overrides onto the chrome styles.
The hook returns `false` where `matchMedia` is missing, so jsdom tests render the desktop layout
unless they stub `matchMedia` (see the mobile block in `Board.test.tsx`). Mobile layouts: stacked
toolbar rows, vertical Week list, side-panning month grid (min-width 640px), snap-scroll kanban
columns, and a collapsible full-width Inbox docked under the board. The shell height is the
`.app-root` CSS class (`100dvh` with a `100vh` fallback): inline styles cannot express the
fallback, so do not move it back into `rootStyle`. Form fields use >=16px text on mobile (smaller
triggers iOS Safari's focus zoom).

### Dates are timezone-aware through one context, week start through one prop

`lib/dates.ts` still builds every `YYYY-MM-DD` from local `Date` parts, but "today" no longer comes
from an ad-hoc `ymd(new Date())`. It comes from `todayYmd(tz)` (pinned to the
`en-US-u-ca-gregory` locale so a non-Gregorian ambient locale cannot yield a Buddhist-era year),
published by `TodayProvider` and read with `useToday()`. The provider re-evaluates on a 60s timer
and on `visibilitychange`, so a board left open across midnight rolls over on its own.

`user_settings.timezone` is an IANA id where **NULL means "follow the browser"**, which is what
every pre-4.1 row means and why a single-device user sees no change. Item 3.2's server-side sender
cannot read NULL as "browser" — it has no browser — so that flow must prompt for a concrete zone
rather than auto-capturing one here.

Two settings, two delivery mechanisms, on purpose: `today` goes through a **context** because
`TaskCard` is four levels deep (`CalendarView → DayCell → SortableCard → TaskCard`), while
`weekStart` is a **prop** (`BoardPage → Board → CalendarView`) because it travels two levels and is
a parameter of a pure function. `TodayContext` lives in `todayContext.ts`, apart from the provider
component, so it stays a hook-only module (`react-refresh/only-export-components`); its default is
browser-local today, which is what lets every component test render unwrapped.

One call site is deliberately **not** converted: `useTasks`'s `materialize()` keeps browser-local
time, because it only anchors a 90-day rolling horizon and re-running materialization on a settings
change risks duplicate instance rows (23505). `CellMeta.dow` carries each cell's real weekday so
`WeekView` can label a rotated week without knowing `weekStart`; weekend shading stays absolute
Sat/Sun and never rotates.

### Theming is an inline-style-object model, not CSS

Ported verbatim from the prototype. `theme/constants.ts` (CAT/COLORS/STATUS/PAPER), `theme/themeConf.ts`
(~26 tokens per theme), `theme/cardStyles.ts` (the style half of the prototype's `noteView`, incl.
`rotOf`, pin, DONE stamp), and `theme/chrome.ts` (board/cell/inbox/column/toolbar styles) all return
plain style objects with per-theme branching (rotation, pins, hard vs. soft shadows, blur). Three
themes: `cork` / `brutal` / `glass`. **Do not refactor this to CSS variables**: the look depends on the
branching that CSS vars cannot express cleanly.

Scrollbars are themed the same way, via `scrollbars(conf)` in `chrome.ts` — spread into every
container that can overflow (the month `grid`, a day cell's `notesWrap`, `inboxList`, a kanban
column's `listStyle`, and the two mobile-only scrollers in `WeekView` / `CalendarView`). It works
because `scrollbar-width` and `scrollbar-color` are **standard** properties and so are expressible
in an inline style object; the per-theme thumb is the `scrollThumb` token. The
`::-webkit-scrollbar` rules in `index.css` are only a fallback for engines without standard support
— Firefox ignores that pseudo-element entirely, which is exactly why a themed board there used to
render a bulky grey platform scrollbar. Add `scrollbars(conf)` to any new scrollable surface, and
do not try to make the `index.css` rules theme-aware: pseudo-elements cannot read inline styles,
and reaching for CSS variables to bridge that is the refactor the paragraph above forbids.
`theme.test.ts` asserts every container in `chrome.ts` that sets `overflow: auto` also carries it.

### Installable PWA and offline read: authored worker, network-first navigation

`src/sw.ts` is **hand-authored, not generated.** `vite-plugin-pwa` runs in `injectManifest` mode
(`vite.config.ts`), which only supplies `self.__WB_MANIFEST` (the precache URL list) — none of
workbox's runtime-caching strategies ship in the built worker; every `fetch` handler in `sw.ts` is
ours. The load-bearing decision is that **navigations are network-first**
(`isNavigation()` in `src/sw/policy.ts`, dispatched from `sw.ts`'s `fetch` listener): a service
worker is the one deployed artifact a merge to `main` cannot reach directly, since it lives on the
user's device and only updates when the browser byte-compares `/sw.js` on a later navigation. If
navigations were cache-first, a bad deploy could make itself permanent for anyone who installed
the worker before the fix shipped — see `docs/runbooks/service-worker-rollback.md`, which exists
specifically because that failure mode has no other way back. Only content-hashed build assets
under `/assets/` and the two Google Fonts hosts are cache-first (`isCacheFirst()`); everything else,
including `/index.html` itself, goes to the network first and falls back to cache only when the
fetch throws.

**`*.supabase.co` is never written to any cache, over any scheme** (`isNeverCached()` — matches
both `https://` REST calls and the `wss://` realtime socket). A cache is a single, unscoped bucket
shared by every profile that has ever used the browser profile; caching an authenticated Supabase
response would leak one user's data to the next person who opens the app on that device. This
predicate is checked before the navigation branch, so it wins even for a Supabase URL that also
looks like a navigation. The rule and its edge cases (a lookalike hostname, `wss://`) are pinned in
`src/sw/policy.test.ts` — `src/sw.ts` itself cannot be unit-tested (no service-worker runtime in
jsdom), so this pure-predicate split is what makes the policy testable at all. Do not weaken or
delete these tests; they are the single most load-bearing check in this subsystem.

`public/_headers` trusts `fonts.googleapis.com`/`fonts.gstatic.com` in the **site-wide**
`connect-src`. That is deliberate and was arrived at the hard way — do not "tighten" it back to a
per-path rule. The asymmetry to understand: the page's own `<link>` to the Google Fonts stylesheet
is governed by `style-src` (always allowed), but the **service worker's** `fetch()` of that same
URL is governed by `connect-src`. Until v1.2.37 this file tried to widen `connect-src` for the
worker alone via a second rule scoped to the `/sw.js` response path. **That does not work, and it
is now confirmed in production, not theorised**: a scoped `_headers` rule does not replace the
site-wide one for that request, so the worker's fetch stayed bound by the narrower directive and
was refused —

```
Failed to load 'https://fonts.googleapis.com/css2?family=…'.
A ServiceWorker passed a promise to FetchEvent.respondWith() that rejected with
'TypeError: NetworkError when attempting to fetch resource.'
```

It only bit **returning** visitors, which is why it survived a preview-deploy smoke test: on a
first visit the worker is not yet controlling the page, so the fonts load normally and land in the
HTTP cache; on the next visit the worker intercepts and is blocked. Because `cacheFirst` had no
network-failure fallback, that rejection reached `respondWith()` and took out the whole stylesheet
for every controlled page — typography silently degraded to system fonts. `cacheFirst` now catches:
it retries the cache with `ignoreSearch` (Google Fonts URLs carry a long `family=` query) and
otherwise returns `Response.error()`, so a refused fetch costs one asset instead of the page. **That
catch is load-bearing — a `throw` there is a page-level outage, not a missing font.**

`script-src` also carries a sha256 for Cloudflare's auto-injected Web Analytics inline loader plus
`static.cloudflareinsights.com`, with `cloudflareinsights.com` in `connect-src`. The hash is
Cloudflare's snippet, not ours: a beacon update can change it and silently re-break analytics (the
app is unaffected). If the console reports a blocked inline script, copy the hash from that message
into `script-src`.

Offline read uses two versioned `localStorage` envelopes, both in `src/data/snapshot.ts` and both
keyed to the signed-in user id: a board snapshot (tasks, the hidden recurrence templates, and a
`savedAt` timestamp) and a settings snapshot. A version or user-id mismatch drops the envelope
rather than migrating it. **Both are cleared on `SIGNED_OUT`** (`AuthProvider`) — that clearing is
the entire justification for storing task text at rest in `localStorage` in the first place; see
the dated security review in `private/` before changing what gets persisted or when it's cleared.
`useTasks` hydrates from the board snapshot only when a server load fails, and deliberately
**skips `materialize()`** on that path — running recurrence materialization over snapshot state
would insert duplicate instance rows and hit `tasks_recur_instance_uniq` (Postgres 23505) the
moment connectivity returns and the real load reruns. `useSettings` falls back to the settings
snapshot on a failed load too, instead of silently resetting the user's theme to `DEFAULTS`.

`tsconfig.worker.json` is a **third project-reference sibling** (alongside the app and node
configs): it gives `src/sw.ts` and `src/sw/policy.ts` the WebWorker lib with no DOM, so the worker
can't accidentally reference `window` or `document`. Its `include` is an explicit two-file list,
not a glob, specifically to keep `src/sw/policy.test.ts` out of this project — that test typechecks
today only by accident, and the first ambient-globals or DOM-typed assertion added to it would
break `tsc -b` from a project it has no business being part of.

### `design/Task Board.dc.html` is the source of truth, reference-only

The original 821-line vanilla-JS prototype. The visual layer and the reorder/recurrence logic were
ported from it. It is **not built**, is in `.prettierignore`, and should not be edited.

## When changing the schema

Add a new file under `supabase/migrations/`. Migrations **auto-apply to production on merge to `main`**
via the `Deploy Migrations` workflow (`.github/workflows/deploy-migrations.yml`, which runs
`npx supabase db push`); run `npx supabase db push` yourself only to apply to a local/branch DB or to
get the schema in place before regenerating types. Regenerate `src/types/database.types.ts` with
`supabase gen types` once the schema is applied (`gen types --linked` reads the remote DB). Keep the
`mappers.ts` conventions above intact.
Prefer test-first for pure logic in `src/data` and `src/dnd` (these have thorough unit tests).

Two standing rules for any table in the `supabase_realtime` publication (today `tasks` and
`user_settings`): **never put a secret or semantically meaningful value in the primary key**, because
DELETE events are fanned out to every subscriber without an owner check (Postgres cannot check access
to an already-deleted row), and **never `disable row level security`** on one — that is the single
change that would escalate the leak from primary keys to full deleted rows. See the header comment on
`supabase/migrations/20260704090000_realtime_tasks.sql`.

## Testing layers

`npm test` is the fast unit/component suite: Vitest under jsdom with Supabase mocked, and it is
**hermetic by contract** — it must never need Docker, a database, or a network. `vite.config.ts`
injects dummy `VITE_SUPABASE_*` values to enforce that, pointed at an unbindable port so an
unmocked call fails loudly rather than reaching the local stack. Keep `tests/**` excluded from
that project.

`npm run test:rls` is a **separate Vitest project** (`vitest.rls.config.ts`) running integration
tests in `tests/rls/` against a real local stack — start one with `npm run test:rls:up`. It is
where the authorization boundary is actually exercised: RLS is the only thing standing between
one user's rows and another's, and every unit test mocks it away. Four of its tests are
schema-wide catch-alls that need no knowledge of any particular table (RLS enabled everywhere,
every RLS-enabled table has a policy, no security-definer views, every table reachable by the
Data API roles) — those are what keep working as the schema grows. One of the four, the
definer-view check, asserts over an **empty set** today because `public` holds no views, so the
option-spelling parser it depends on lives in `tests/rls/reloptions.ts` and is tested directly in
`reloptions.test.ts` — the same split that makes `src/sw/policy.ts` testable when `src/sw.ts`
itself cannot be, but the parity is not exact: `policy.test.ts` runs inside `npm test`, the
**required** `Test` job, on every PR, while `reloptions.test.ts` runs only under `npm run
test:rls` — a job that is not required and has, as of this writing, never executed in CI. Until
that changes, `isSecurityInvoker` has real test coverage on paper but nothing gating a merge on
it. The CLI is pinned as an exact
`supabase` devDependency rather than through `supabase/setup-cli`, because every call goes
through `npx`, which ignores a PATH binary in favour of a local one and otherwise installs
`latest`.

**Data API grants are explicit, per table, full stop** (`20260729100000_explicit_data_api_grants.sql`)
and must stay that way. `config.toml` leaves `auto_expose_new_tables` unset, so a new table is
unreachable through PostgREST until it is granted — and that compatibility flag is removed on
2026-10-30. The migration deliberately carries no `alter default privileges`: that clause would
auto-grant every table some future migration creates, forever, which turns "forgot to enable RLS
on a new table" into a silently world-readable table instead of a loud `42501` — the opposite of
this repo's default-deny model. A migration that adds a table must grant it explicitly right there;
the fourth structural test (`tests/rls/structure.test.ts`, "every table in public is reachable by
the Data API roles") is the backstop that catches one that doesn't. Note `anon` is granted
deliberately: RLS, not the grant, is what denies it, and `useSettings` depends on an
unauthenticated select returning zero rows rather than an error.

## When changing auth config

`supabase/config.toml`'s `[auth]` tree describes **production** exactly (site URL, redirect
allow-list, password policy, OTP settings, rate limits, the Resend SMTP block, the Google OAuth
block, TOTP MFA) — every edit is a production change, not local scaffolding. Changes to
`supabase/config.toml` or `supabase/templates/**` **auto-apply to production on merge to `main`**
via the `Deploy Auth Config` workflow (`.github/workflows/deploy-auth-config.yml`, which runs
`supabase config push --yes`). The `Config` CI job previews the pending push on PRs that touch
those paths — it declines every confirmation prompt (`yes n |`) so it can never apply: the CLI has
no `--dry-run`, and its prompts default to **yes** on EOF, so a naive non-interactive run would
silently push to production. Secrets referenced via `env(...)` in the file (`RESEND_API_KEY`,
`GOOGLE_OAUTH_CLIENT_SECRET`) exist only as repository secrets, used by both the `Config` and
`Deploy Auth Config` jobs; `deploy-migrations.yml` and `deploy-functions.yml` also carry them so
the CLI's config.toml parsing on every command can't fail on a missing var. **Never run
`supabase config push` locally** — it deploys straight to production, bypassing the PR preview.
The two auth email templates the app sends (confirm-signup, reset-password) live in
`supabase/templates/{confirmation,recovery}.html` and deploy the same way — edit the HTML files,
never the dashboard, which is no longer the source of truth for them. Three constraints on those
files: (1) the action link must stay exactly
`{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery|signup` — raw `&`, not `&amp;` —
because `ResetPassword` / `AuthConfirm` redeem it with `verifyOtp`; (2) they are **email**, so
table layout and inline styles only (no flexbox/grid, webfonts, gradients, or SVG), and the
`color-scheme: dark` meta pair is what stops dark-mode clients re-inverting the already-dark
design; (3) **the whole file is pushed as the email body**, comments included — keep comments to a
line, since anything here ships to every recipient's inbox.

## Agents and docs automation

This file is the **canonical agent guide**; `CLAUDE.md` is only an `@AGENTS.md` import so Claude Code
loads the same content. Edit `AGENTS.md` — never duplicate content into `CLAUDE.md`.

Project subagents live in `.claude/agents/`: `docs-updater` (keeps `AGENTS.md`,
`README.md`, `ROADMAP.md`, `CHANGELOG.md` in sync with the code) and `code-reviewer` (reviews diffs
against the app/DB boundary, RLS, recurrence, and DnD correctness rules before merging). The `ship`
skill (`.claude/skills/ship/`) takes a finished branch to an open PR — it refreshes the docs (via
`docs-updater`), records the change in `CHANGELOG.md`, runs the fast checks (`format:check`, `lint`,
`tsc -b`), pushes, and opens or updates the PR; run it with "ship it" when a branch is ready. Whether
or not you use it, keep `AGENTS.md`, `README.md`, `ROADMAP.md`, and `CHANGELOG.md` aligned when a
change affects project behavior, commands, architecture, or release notes.

### `.claude/` is the source of truth; the Codex trees are generated

Both Claude Code and Codex are used on this repo, and they read different files. Rather than keep
two hand-written copies that drift, **`.claude/` is authored and everything Codex-specific is
generated from it** by `scripts/sync-codex.mjs` (`npm run codex:sync`):

| Source                  | Generated                | How                                            |
| ----------------------- | ------------------------ | ---------------------------------------------- |
| `.claude/agents/<n>.md` | `.codex/agents/<n>.toml` | frontmatter + body -> `developer_instructions` |
| `.claude/skills/<n>/**` | `.agents/skills/<n>/**`  | copied verbatim, plus a "generated" banner     |

Those destinations are not a matched pair by choice — they are where Codex actually looks. Subagents
load only from `.codex/agents/`; skills are found by scanning `.agents/skills` from the cwd up to the
repo root. Both generated trees are **committed**, so a Codex session gets them without running Node.

Rules for this pipeline:

- **Never edit `.codex/` or `.agents/` by hand** — run `npm run codex:sync`. The script owns every
  byte in both trees, so a file with no source is deleted as stale.
- **Never "adapt" skill prose for Codex.** A blind `CLAUDE.md` -> `AGENTS.md` substitution is what
  once produced "edit `AGENTS.md`, never add content to `AGENTS.md`". References to `CLAUDE.md` are
  correct as written for both tools, because it really does exist and really is just an import.
- The Claude-only frontmatter keys are translated, not dropped silently: `tools:` without any
  file-writing tool becomes `sandbox_mode = "read-only"`, and `model:` is recorded in a comment as
  not carried over (Claude's tiers name no Codex model; Codex uses `agents.default_subagent_model`).
- The required **`Agents` CI job** runs `npm run codex:check`, which fails on any missing, hand-edited,
  or stale generated file, and also asserts `CLAUDE.md` still contains its `@AGENTS.md` import line.
  Pure logic in the script is unit-tested in `scripts/sync-codex.test.mjs`.

Completed implementation plans are archived under `docs/plans/` and `docs/specs/` (see
`docs/README.md`) — they are dated historical records of shipped work, not living documentation;
do not update them to match current code. `docs/runbooks/` is the exception: those are **living**
operational procedures and must be updated in the same PR as whatever they describe.

## Backups

The free Supabase tier has **no automated backups**, so `.github/workflows/backup.yml` takes a
nightly logical dump: `schema.sql` (DDL for `public`) plus `data.sql`, which carries **both** the
`public` and `auth` rows — `supabase db dump --data-only` includes Supabase-managed schemas even
though the schema dump excludes them. Do not "helpfully" add a separate `--schema auth` data dump;
one existed until v1.2.27 and was a strict subset that made restores fail on duplicate `auth.users`
keys. The verify step asserts `data.sql` contains both `public.tasks` and `auth.users`, which is what
would catch that CLI behaviour changing.

Because this repository is public and **GitHub artifacts on public repos are downloadable by
anyone**, the bundle is GPG-symmetric-encrypted on the runner before upload; the plaintext never
leaves the job. Never add a step that uploads anything unencrypted, and never echo dump contents to
the log — the verify step prints table names only, matched at line start and identifier-filtered,
because `COPY` payload rows are user data.

Restoring is not just "load the file": `on_auth_user_created` seeds a conflicting `user_settings`
row, so data loads under `session_replication_role = replica` — which `data.sql` already sets on its
own line 1. Three findings from the first real rehearsal (2026-07-27) that contradict what this file
used to say: the `tasks.recur_parent_id` self-reference is **not** a restore hazard (the CLI emits one
multi-row `INSERT` per table, so FK checks defer to end of statement — verified at 5,064 rows);
`schema.sql` **cannot** carry `on_auth_user_created`, because that trigger sits on `auth.users` and
the dump is `public`-only, so restoring from it alone leaves new signups with no settings row; and the
direct `db.<ref>.supabase.co` host is IPv6-only, so a restore needs the Session pooler. Full
procedure, including what to verify: `docs/runbooks/restore-from-backup.md`.
