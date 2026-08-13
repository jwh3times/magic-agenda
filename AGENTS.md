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
npm run lint           # Oxlint, including TypeScript 7 type-aware linting
npm run lint:fix       # apply Oxlint's safe fixes
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

`.oxlintrc.json` owns the entire lint policy. `options.typeAware` delegates semantic rules to
`oxlint-tsgolint`, whose compiler engine is TypeScript 7, while `react/react-compiler` covers the
React Compiler diagnostics. Oxlint v1.78.0 reports an internal invariant on valid
`DataSection.tsx`, so that component carries one narrow inline suppression; re-check it when Oxlint
is upgraded. Generated Supabase types and Deno Edge Functions stay outside the Node lint project.

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
boundary** (every table default-denies; `tasks`/`user_settings` scope to `auth.uid() = user_id`,
and the Board tables scope through Membership — see below); the anon key is public
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
carry `?token_hash=` and are redeemed explicitly via `verifyOtp()`: `ResetPassword`
(`/auth/reset`) renders its form on `session && passwordRecovery`, never on "redemption succeeded this
mount" (the token is single-use, so reloads and `ProtectedRoute` re-entry must still work); `AuthConfirm`
(`/auth/confirm`, a public route) redeems a signup token and signs the user straight in, skipping the
old "confirm, then come back and sign in" round trip. Both pages refuse to redeem over an existing
session (the residual session-fixation guard). `ProtectedRoute` is unchanged —
`verifyOtp({ type: 'recovery' })` still fires `PASSWORD_RECOVERY` itself.

### The auth seam: pages never touch `supabase.auth`

**`src/auth/authGateway.ts` is the only module in `src/` that may call `supabase.auth.*`.** Until
v1.2.55 seven of the ten call sites lived in `Login`, `ResetPassword`, and `AuthConfirm`, and the
cost was visible in the churn: the refuse-to-redeem guard had three different encodings, the error
policy four, and the redirect-after-success rule five. Every commit touching three or more of those
files was one conceptual change crossing a seam that did not exist.

Two invariants hold for **every** `AuthGateway` method, and they are why the interface earns its
keep:

1. **Nothing rejects.** Failures are values (`AuthOutcome`), never exceptions. That is structural,
   not stylistic — a missing `.catch` on `verifyOtp` used to strand `/auth/reset` and
   `/auth/confirm` on a spinner forever, with the single-use token already scrubbed from the URL.
2. **No vendor error type crosses it.** `src/auth/authOutcome.ts` maps GoTrue `error_code`s (not
   messages — those get reworded across releases) to an `AuthFailureReason` union this app owns.
   `unknown` is part of that union on purpose and keeps the vendor's own text, so an unmapped code
   degrades to the old behaviour rather than to silence. `bad-credentials` deliberately does not
   say which half was wrong; a message that did would make the sign-in form an account-enumeration
   oracle.

`Session`/`User` still cross the seam in the success direction, so the eleven modules reading
`session`/`user` off the context remain typed against the vendor. Narrowing that is deferred, not
overlooked.

**`redeemDecision()` in `src/auth/redemption.ts` is the single home of the session-fixation guard.**
It is pure and total, and **the clause order is the security property**: `hasSession` is tested
before `tokenHash`, so an existing session always wins and a valid token is never redeemed over it.
Reordering those two lines silently reopens the finding the 2026-07-25 review closed, which is why
`redemption.test.ts` asserts the refusal for a *valid* token specifically.

`useTokenRedemption()` wraps it, and its two guards are separate on purpose. The **decision is
latched in state** once auth settles — without that, the app's own successful redemption produces a
session, the decision recomputes to `refuse`, and the page announces "you're already signed in" in
the middle of the flow it just completed (the real client fires `SIGNED_IN`/`PASSWORD_RECOVERY` from
*inside* `verifyOtp`, before the promise resolves, so this is the normal path, not a race). A
**ref guards the redemption call itself and is read only inside the effect** — StrictMode runs
effect setup → cleanup → setup against the same latched decision, so without it a single-use token
is spent twice. Note `react-hooks/refs` forbids reading a ref during render, so the latch cannot be
collapsed back into the ref.

**Tests render the real `AuthProvider` with `fakeAuthGateway()`** (`src/auth/fakeAuthGateway.ts`,
the second adapter) rather than stubbing `useAuth`. The old approach hand-built a `vi.mock` factory
shaped like whichever methods each page happened to call, which is untyped: `Login.test.tsx` stubbed
3 of the context's 6 members while its siblings stubbed 6, and nothing caught the drift. The fake
carries no vitest import and nothing in the app imports it, so it never reaches the bundle.

`src/auth/verifyOtpContract.test.ts` pins the vendor ordering that the recovery gate depends on. It
lived in `src/lib/` with no module behind it; `redeemToken` is now its owner, which is why the
"do not defer this call" warning sits in that method's body.

### Board ownership: schema is live, containment is not yet authoritative

`account_profiles`, `boards`, and `board_memberships` exist in production, every Account has exactly
one Board, and every task carries a `board_id`. **None of it is an authorization boundary yet.**
`tasks` policies still compare `user_id` to `auth.uid()`, so board containment is data integrity,
not access control — `tests/rls/boards.test.ts` asserts that state deliberately, and that test flips
to expecting an error at the cutover. Do not read "boards exist" as "tasks are scoped by boards".

Four things here are load-bearing and none is obvious from the schema alone:

- **`handle_new_user` now seeds four rows** — settings, profile, Board, Owner Membership — in the
  signup transaction. A failure in any of them fails registration, which is the correct trade (an
  Account with no Board is broken) but puts this function on the critical path of every signup. It
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
- **`tasks_infer_board_id` is temporary, and dropping it is a security event.** It routes a
  board-less insert (what the currently-deployed client sends) to the account's single Board. That
  is only correct while there *is* a single Board: the moment a second can exist, it silently files
  a stale client's task into the wrong one. It must be dropped in the same release that enables
  Board creation, so stale clients hit the NOT NULL and fail closed. A client-version prompt cannot
  substitute — navigations are network-first, so the worker updates on navigation and a long-open
  board tab never navigates.
- **No `app_private` schema yet, deliberately.** Only the *co-member* clause on `board_memberships`
  needs a `security definer` helper, because it subqueries its own table and raises `infinite
  recursion detected in policy for relation`. That clause is a sharing feature with nothing to do
  while every Board has one Membership. Everything shipped is self-scoped or crosses relations.
  Measured, not assumed: a policy calling a function in a private schema requires the **calling**
  role to hold `USAGE` and `EXECUTE` or the query dies with `permission denied for function`, so
  such a helper can never be hidden from `authenticated` — only from `anon`. What actually keeps a
  schema off the Data API is `[api] schemas` in `config.toml`; PostgREST refuses an unlisted schema
  with `PGRST106` even for `service_role`.

The Board tables grant **SELECT only**, and nothing at all to `service_role` — a deliberate
departure from `tasks`/`user_settings`, which grant full DML to all three Data API roles. Board
lifecycle and membership administration carry invariants a direct table write cannot enforce, so
there is no correct direct-write grant. The one exception is column-level: `grant update
(default_view)` and `grant update (display_name)`, because RLS cannot express "only this column
changed" — a policy cannot see the old row. Practical consequence: a fixture that reaches for the
service client to create a Board gets a permission error; seed through direct SQL instead of
widening the grant.

### App / DB boundary conventions: get these wrong and data breaks subtly

- **`'inbox'` <-> `NULL`**: the app `Task.day` is the literal `'inbox'` (unscheduled) or `'YYYY-MM-DD'`.
  The `'inbox'` sentinel stays everywhere in app/DnD logic and maps to a `NULL` `day` **only** in
  `src/data/mappers.ts`.
- **`order` is reserved SQL** -> the column is `order_index`; the app keeps `order`/`korder`.
- **`done` is derived** (`status === 'done'`), never stored.
- These conversions live entirely in `mappers.ts` (`rowToTask` / `taskToRow`). Everything else works in
  app-domain `Task` objects (`src/types/task.ts`).

### Data ownership: `BoardPage` owns state; task operations cross one context seam

`pages/BoardPage.tsx` wires `useTasks(userId, hasSession)` + `useSettingsContext()` +
`ThemeProvider`, then publishes the board-facing half of `useTasks` through `TaskBoardContext`.
`Board` holds only **UI** state (view, anchor date, editing modal, pop animation, filter); its four
props are account settings/navigation, not task operations. This keeps `Board` testable without
Supabase: `Board.test.tsx` supplies the same `TaskBoard` interface with a stateful in-memory adapter.
Tests that mock `useTasks` itself start from `fakeUseTasks()` so interface additions cannot leave
partial, untyped return objects behind.
`useTasks` remains the single source of truth for board tasks: optimistic CRUD with rollback, plus
`persistReorder` (upserts only the changed lanes). Its raw React setter is private; drag-over uses
the narrower `previewReorder(next)` command.

`BoardActionContext` is the internal UI seam below `Board`. It publishes editor/add/card actions and
the done-pop id at their use sites, so the view modules pass tasks and layout parameters rather than
relaying a handler bag through `CalendarView` -> `DayCell` -> `SortableCard` -> `TaskCard`. With no
provider, `TaskCard` is deliberately decorative; the landing preview relies on that default. To
follow a write end-to-end, read the consuming card/cell -> `Board` -> `TaskBoardContext` ->
`useTasks`.

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
conflation lets a sessionless reconnect persist an empty board. That rule now has **one
implementation**, `canPersistSnapshot()` in `src/data/snapshot.ts`, which both hooks call and
whose docstring explains why each of its five clauses is load-bearing. It previously had two
implementations and three prose copies, one of which smuggled the rule in as a positional boolean
argument named `persistSnapshot`.

### Realtime sync is one module, not two copies

`src/data/useSyncedTable.ts` owns the per-user `postgres_changes` channel, echo suppression for
this client's own writes (`useOwnWrites`, a 5s per-id TTL), reconnect with capped exponential
backoff, and catch-up on `visibilitychange`/`online`. `useTasks` and `useSettings` are its two
adapters and keep only their own load, state shape, and snapshot envelope.

This was two divergent copies until v1.2.57, and the divergence was a live bug, not just
duplication: **`useSettings` had no reconnect path at all.** Its entire subscription tail was
`.subscribe()` — no status callback, no backoff, no catch-up listener — so a settings channel that
errored after a phone slept stayed dead for the session while the board kept syncing, and
cross-device theme/week-start/timezone changes silently stopped arriving. This paragraph used to
describe both hooks as reloading and resubscribing with backoff; only one of them did (#130).

Two details worth keeping: `rowIdOf` reads `payload.old` for DELETE and `payload.new` otherwise,
because a DELETE payload carries **only** the primary key (replica identity is DEFAULT, and
Supabase forces that for RLS-enabled tables) — reading `new` would make every delete look like
another client's write. And the primary key differs per table (`tasks.id` vs
`user_settings.user_id`), which is why the id extraction could not stay inline in either hook.

Remote task changes still flow through the pure reducer in `src/data/realtime.ts` (instance dedupe
by `(recurParentId, recurOriginDay)`, templates routed to `templatesRef`).

### Recurrence is a hidden-template model (the most complex subsystem)

A recurring series is a **hidden template row** (`recurFreq != 'none'`, `recurParentId === null`, see
`isTemplate()`) that is **kept out of the board `tasks` list** (held in a separate ref inside
`useTasks`) plus **materialized instance rows** (`recurFreq 'none'`, `recurParentId = template id`).
Keeping templates out of the board list is what keeps reorder/DnD math clean. On load, `useTasks`
materializes any missing instances over a rolling 90-day horizon; deleted occurrences are remembered
in a per-template `recurSkip` array so they are never regenerated. `reload()` has an in-flight guard
because React StrictMode double-invokes the load effect, which otherwise double-inserts instances and
trips the `(recur_parent_id, day)` unique index (Postgres 23505).

**`src/data/series.ts` owns this model, and everything it decides is pure.** It holds `instanceKey`
(occurrence identity), `makeInstance`, `pendingInstances`, the scope resolvers (`resolveSave` /
`resolveDelete`), and a **plan** for each series operation — the next board, the next templates, the
rows to upsert, the deletions to run, the ids to mark as our own writes. `src/data/recurrence.ts` is
its pure date core. `useTasks.runPlan` is the only effectful part: it applies the optimistic state,
sends the writes, and honours each step's `FailureHandling`.

That split is what made this subsystem testable. Before it, the three scope operations were a
207-line block inside `useTasks` that **no test reached** — `deleteSeriesFuture`, the branchiest
function in the data layer, had zero — while the cheap date maths in `recurrence.ts` had 22 tests.

Three details worth keeping:

- **Scope is always by occurrence origin, never by the card's day.** `instanceOrigin` is what stops a
  dragged instance from being scoped wrongly, from resurrecting as a duplicate, or from
  false-triggering the whole-series branch of a delete.
- **`FailureHandling` is two independent questions** (`abort` and `recover`) because the original
  behaviour answered them independently: a failed content upsert aborts the trim that follows it,
  while a failed `recurSkip` write must *not* stop the occurrence being deleted.
- **`pendingInstances` takes the board as a required argument.** It used to default to a ref whose
  own docstring called the default unsafe — `setTasks` writes that ref inside a deferred React
  updater, so passing it right after a load makes every occurrence look missing and re-inserts rows
  that already exist. Three of the four call sites took the default and none was tested.

`Board` no longer knows any of this: the editor's scope prompt produces a `RecurScope`, and
`saveTask` / `deleteTask` resolve it. The four-way save dispatch and three-way delete dispatch that
used to live in the UI shell — including the rule-stripping on the this-occurrence path, enforced by
nothing but a comment — are `resolveSave` / `resolveDelete`.

**`src/data/editIntent.ts` is the editor's half of the same split.** `series.ts` decides *which
occurrences* an operation touches; `editIntent.ts` decides *whether the editor may proceed at all*
and *whether it has to ask first* — `cleanDraft`, `changedTaskKeys`, `onlyPerOccurrenceChanged`,
`intendSave`, `intendDelete`. All pure, and all previously private to a 739-line
`TaskEditor.tsx`, which is why its eight tests reached them by clicking through the DOM and why the
fail-safe property documented on `changedTaskKeys` was asserted by nothing.

Two facts that used to be undeclared and now live in types:

- **`onSave`'s scope is definite for a recurring instance.** It was `undefined` on the
  per-occurrence-only path, and `Board` had to know that meant "this occurrence". `resolveSave`
  still defends against `undefined` — that default is tested — but nothing produces it for an
  instance now.
- **`onDelete` carries only an id**, and `useTasks.deleteTask` looks the row up in its own state.

The delete seam is worth understanding, because the obvious framing of it is the wrong one.
[#132](https://github.com/jwh3times/magic-agenda/issues/132) asked whether deleting should act on
the edited draft or on the stored task, since the editor passed a whole `Task` and the two differ.
Both answers left the same hazard: `onDelete(task: Task)` promised far more than the delete path
used — it reads only `id`, `recurParentId`, `recurOriginDay` and `day` — so any field read from it
later would silently start depending on unsaved edits, with no test failing. Passing an id removes
the question instead of answering it, and is strictly more correct than either option was, because
`initial` is **not** the stored row: `Board.openTask` merges the template's
`recurFreq`/`recurInterval`/`recurUntil` onto an instance before handing it to the editor.

An unknown id is a **no-op**, which is what an already-deleted-elsewhere row looks like.

(For the record, the original bug was inert: of the four fields the path reads, only `day` is
editable, and it is reached only via `instanceOrigin`'s `recurOriginDay ?? day` fallback — which
`20260630130000_recur_origin_day.sql` backfilled for every instance that had a day. The null-origin
rows left are inbox instances from before that migration, for which `instanceOrigin` already
returns the meaningless `'inbox'`.)

`PER_OCCURRENCE_FIELDS` (which fields skip the prompt) and `seriesContent()` in `series.ts` (which
fields an all-future edit propagates) are two halves of one classification, deliberately kept
separate: they answer different questions and are not exact complements — `day`, `order`,
`checklist` and the recurrence fields are in neither.

### Drag-and-drop: every decision is pure; dnd-kit is an adapter

Two pure modules, then thin wiring. `src/dnd/reorder.ts` is the **splice math** (`moveToDay` /
`moveToStatus`): it reindexes **both** the source and destination lanes on a cross-container move.
`src/dnd/resolveDrop.ts` is **every decision** — `modeForView`, `containerOf`, `isBelowOver`,
`insertionIndex`, and the `resolveDrop` session reducer that accumulates `touched` and `didMove`.
Neither imports `@dnd-kit/core`. `src/dnd/useBoardDnd.ts` is now only sensors, event mapping, and
React state.

The seam moved here in v1.2.56, and the reason is worth keeping: it had been drawn at "pure vs
impure" rather than "hard vs easy", so the tested half was the easy half. `reorder.ts` had 17 tests
across four exports — **two of which had no production call site at all** — while the wiring held
the container-id overloading, the above/below geometry, the insertion arithmetic, and the
multi-hop lane accumulation behind one test that needed ~45 lines of hand-cast dnd-kit fixtures.
`findContainer` was the sharpest symptom: exported, tested four ways, never called, and returning
`undefined` for an id matching no task — while the wiring's own copy returned **the id itself**,
which is the only reason a drop onto an empty lane worked. Both are now one tested function.

Critical, non-obvious detail: persistence must fire **even when `over.id === active.id`** (after an
optimistic move the dragged card sits under the cursor as its own drop target), tracked by
`DragSession.didMove` — `resolveDrop` returns `null` for that event while the session stays
"moved". Container ids are overloaded on purpose: `dateStr | 'inbox'` (day mode) or a status
(kanban) identifies a *lane*, and an id matching no task **is** a lane id.

`useBoardDnd` must be given the **unfiltered** board, even though views render `visibleTasks`.
Passing the filtered list would corrupt data rather than merely narrow the drag: `persistReorder`
writes back every task in a touched lane, so the visible tasks would get contiguous `0..n-1`
indices while hidden tasks in the same lane kept theirs. Dragging under an active filter is
prevented one level up.

While a search filter is active, drag is disabled via `DragDisabledContext` (consumed by
`SortableCard`'s `useSortable({ disabled })`); this keeps the `DndContext` sensors array a constant
size, avoiding a dnd-kit hook-deps warning. Sensors are split Mouse/Touch (not `PointerSensor`):
touch drags require a **250ms long-press** and cards use `touchAction: 'manipulation'`; together
that's what lets a plain swipe over a card scroll the board on phones. Do not collapse these back
into a `PointerSensor` or set `touchAction: 'none'`.

The pinned `@dnd-kit/*` 0.5 packages in `devDependencies` belong only to the successor-API prototype
under `src/dnd/dndKitNext.*`; production still uses `@dnd-kit/core` / `sortable`. The prototype
proved that the successor can feed the existing pure drop seam on desktop, but its single
pointer-type-aware sensor has not passed real iOS Safari and Android Chrome scroll/long-press tests.
Before changing the production adapter or removing those prototype dependencies, read
`docs/specs/2026-08-12-dnd-kit-next-prototype.md` and satisfy its touch-hardware exit criteria.

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

`CalendarView`, `WeekView`, and `KanbanView` remain separate modules on purpose: each concentrates a
responsive layout fork behind a narrow task/layout interface, so folding them into `Board` would
move complexity without removing it. Their direct tests stub `matchMedia` and pin the mobile
scroll/stack/snap behavior; keep those assertions at the view seam.

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
(~28 tokens per theme), `theme/cardStyles.ts` (the style half of the prototype's `noteView`, incl.
`rotOf`, pin, DONE stamp), and `theme/chrome.ts` (board/cell/inbox/column/toolbar styles) all return
plain style objects with per-theme branching (rotation, pins, hard vs. soft shadows, blur). Three
themes: `cork` / `brutal` / `glass`. **Do not refactor this to CSS variables**: the look depends on the
branching that CSS vars cannot express cleanly.

`theme/chrome.ts` contains shared or theme-branching chrome factories, not speculative interaction
states. The DnD adapter does not currently publish a per-lane hover state, so `cellChrome` /
`columnChrome` have no `isDrop` parameter. Add such a branch only together with a real caller and an
observable interaction test.

Scrollbars are themed the same way, via `scrollbars(conf)` in `chrome.ts` — spread into every
container that can overflow (the shared month/desktop-week `grid`, a day cell's `notesWrap`,
`inboxList`, a kanban column's `listStyle`, and the two mobile-only scrollers in `WeekView` /
`CalendarView`). It works because `scrollbar-width` and `scrollbar-color` are **standard**
properties and so are expressible
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
injects dummy `VITE_SUPABASE_*` values to enforce that, pointed at port 1 — privileged, and
nothing listens there — so an unmocked call fails fast with `ECONNREFUSED` rather than reaching
the local stack, which is live whenever `test:rls` is running. Keep `tests/**` excluded from
that project.

`npm run test:rls` is a **separate Vitest project** (`vitest.rls.config.ts`) running integration
tests in `tests/rls/` against a real local stack — start one with `npm run test:rls:up`. It is
where the authorization boundary is actually exercised: RLS is the only thing standing between
one user's rows and another's, and every unit test mocks it away. Its tests come in two kinds,
split across two files, and the distinction matters when adding one.

`structure.test.ts` holds **catch-alls** that need no knowledge of any particular table and hold
forever: RLS enabled everywhere, every RLS-enabled table has a policy, no security-definer views,
every table reachable by the Data API roles, a newly created table reachable by *none* of them, and
every realtime-published table keyed on uuid only. That last one is the machine-checkable half of
the publication rule above — DELETE fan-out caps its payload at the primary key, so the PK is the
entire content of a cross-tenant broadcast, and a `text` PK on a published table (an email, a slug,
a board name) is the realistic version of that mistake. It follows the publication rather than
assuming `public`, and it treats a published table with *no* PK as a failure too: under replica
identity DEFAULT that table publishes no old record, so deletes stop reaching subscribers and the
client reducer silently diverges.

`baseline.test.ts` holds **baselines** — the security posture as it is *today*, asserted by strict
equality in both directions, so changing it is a deliberate act with a diff attached. Three of
them: every function in `public` with its definer flag / `search_path` / whether it carries its own
ACL, every schema reachable by the Data API roles, and every policy that applies to `PUBLIC`
because it names no role. All three deliberately record known weaknesses rather than a clean bill
of health — `handle_new_user` is `security definer` with `search_path=public` rather than the empty
path a definer should have, both functions are EXECUTE-able by `PUBLIC` via PostgreSQL's default,
and all seven legacy policies target `PUBLIC`. Each is tolerable for a specific reason stated in
the file, and each stops being tolerable at a specific point in the board work; recording them is
what turns "someday" into a line someone has to delete. A baseline that *shrinks* is a failure too:
that means it is stale and the smaller set must be committed.

Of the catch-alls, the definer-view check asserts over an **empty set** today because `public` holds no views, so the
option-spelling parser it depends on lives in `tests/rls/reloptions.ts` and is tested directly in
`reloptions.test.ts` — the same split that makes `src/sw/policy.ts` testable when `src/sw.ts`
itself cannot be. `policy.test.ts` runs inside `npm test` (the `Test` job) and `reloptions.test.ts`
only under `npm run test:rls` (the `RLS` job); **both jobs are required checks and both run on every
PR**, so `isSecurityInvoker` is genuinely gated. This paragraph previously recorded the opposite —
that `RLS` was neither required nor had ever executed — which was true when written and is no longer:
verified 2026-07-29 against the ruleset and six consecutive successful `RLS` job runs. The CLI is pinned as an exact
`supabase` devDependency rather than through `supabase/setup-cli`, because every call goes
through `npx`, which ignores a PATH binary in favour of a local one and otherwise installs
`latest`.

`npm run test:e2e` is a **third layer**: Playwright (Chromium only) against a **real deployed
build**, not a local server. That is the whole point — `public/_headers` is Cloudflare-specific,
and the v1.2.37 CSP bug could not be reproduced locally. In CI it runs against the PR's Cloudflare
Pages preview; locally, point `E2E_BASE_URL` at a preview URL or production.

**Finding the preview is not obvious and the obvious way does not work.** This repo has no GitHub
Deployments — Cloudflare reports as a check run named `Cloudflare Pages` whose `details_url` points
at the dashboard, and no GitHub API exposes the preview URL. `scripts/preview-url.mjs` polls that
check run and derives `https://<first 8 of the deployment UUID>.magic-agenda.pages.dev`. Both the
link shape and the URL convention are undocumented, so the pure derivation is unit-tested in
`scripts/preview-url.test.mjs` and fails loudly rather than guessing. The fallback, if Cloudflare
changes either, is their deployments API with an API token.

**Playwright traces are GPG-encrypted before upload, and that is not optional.** A trace records the
Supabase request headers verbatim, including `authorization: Bearer <JWT>` in full for the E2E
account — and this repository is public, so anything a job uploads is downloadable by anyone. It is
the same constraint that makes `backup.yml` encrypt its dump, and the fix is deliberately the same
shape (`--symmetric --cipher-algo AES256`, a no-op check, a round-trip check). If
`E2E_TRACE_GPG_PASSPHRASE` is absent the traces are **discarded, not uploaded** — losing a debug
artifact beats leaking a credential, and gpg would otherwise cheerfully "encrypt" with an empty
passphrase. Do not replace this with a plain upload of `test-results/`. The general rule: **treat
every artifact this repo uploads as public**, and check what a new one actually contains before
adding it.

E2E drives **one dedicated account in the production project**, so runs are serialised twice:
`workers: 1` within a run, and a `concurrency` group across PRs — scoped to `pull_request` events, so
a push to `main` (where the job only gate-skips) cannot occupy the group's single pending slot and
evict a queued PR. Seeding uses the anon key and that account's own credentials — **the service-role
key must never enter CI.** All three skip conditions (non-PR events, fork PRs, runs without secrets)
report success from inside a step, never a job-level `if:`.

Five non-obvious constraints on the specs themselves. Four cost a real debugging pass; the fifth
is a deliberate tradeoff worth understanding before it costs one:

- **Seed data is dated relative to today.** `Board` anchors on today and `CalendarView` renders a
  fixed 42-cell grid around that month, so an absolutely-dated row is in the database and on no
  screen. The a11y baseline no longer keys on CSS target paths, but `page.clock` is still pinned
  and the seed anchor pinned to match — for a different reason: `nested-interactive` is counted one
  per rendered card, so an unpinned clock could place a seeded task on a day the fixed 42-cell grid
  doesn't carry that month, silently dropping it from the count. (`color-contrast` no longer needs
  this: it reached zero across every cell state — including brutal's out-of-month day numbers — in
  the pass recorded in `src/theme/themeConf.ts`.) The two must move together, because the clock
  moves only the browser while `seedBoard` runs in the test process in real time.
- **`document.fonts.check()` cannot detect the CSP regression.** It returns true for a family with no
  `FontFace` registered at all, which is exactly the broken state. The font assertion iterates
  `document.fonts` instead. (There is also no font named `Inter` in this app.)
- **`context.setOffline(true)` + `page.reload()` does not work here, and is not a bug in the app.**
  CDP offline emulation fails the top-level navigation with `net::ERR_FAILED` before the service
  worker is consulted, even though the worker is alive and `/index.html` is precached — measured
  both ways. The offline test therefore aborts only Supabase, which is the actual condition
  `useTasks` guards. No browser-level test here covers the worker serving the shell offline;
  `src/sw/policy.test.ts` covers that policy.
- **A scan that races a loading state scores clean, it does not merely miss content.** `<Spinner/>`
  is `position: fixed; inset: 0`, and axe's `isModalOpen()` heuristic treats any absolute/fixed
  element covering ≥75% of the viewport as an open modal. `landmark-one-main` and
  `page-has-heading-one` both carry `passForModal: true`, so they pass for free against a loading
  screen. That is how the original baseline came to hold a single `region: #root` entry for
  `settings` and nothing else: it never scanned the settings page. Every scan waits for real
  content, and `FREEZE_ANIMATION` is injected before every scan because `page.clock` does not stop
  CSS animations and a drifting glass blob turns a `color-contrast` violation into an `incomplete`.
- **The a11y baseline asserts counts by strict equality, in both directions.** A count that rose is
  a regression; a count that FELL means the baseline is stale and the lower number must be
  committed. That second direction is deliberate — tolerating it is what lets a ratchet's ceiling
  drift above reality — but it has one confusing consequence: any merge that lands without an E2E
  run (a non-PR event, a fork PR, a Dependabot PR) and incidentally reduces a count leaves the next
  human PR red for a number it did not cause. The fix is always to commit the lower number.
  Regeneration in practice means reading the counts out of the CI log: `E2E_A11Y_UPDATE_BASELINE=1`
  still works but needs the E2E account's credentials, which exist only as repository secrets.

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

That fail-closed premise was **not** true in production until `20260729190000`. Production
carried `pg_default_acl` entries granting `anon` and `authenticated` full DML on every future
table in `public` — inherited from the legacy auto-expose era, and invisible to CI, which always
builds a fresh database whose defaults are already restrictive. Any table shipped without
`enable row level security` would have been world-readable and writable through the public anon
key. That migration revokes them for the `postgres` role, which is what both migrations and the
Studio table editor (pg-meta connects as `postgres`) create through. **`authenticated` is revoked
for the same reason as `anon`, not as belt-and-braces**: signup is open, so `authenticated` is
`anon` plus one free registration. `service_role` is deliberately left alone — the Edge Functions
hold the service key precisely to cross this boundary.

**One residual gap, by necessity:** `supabase_admin` carries the same permissive defaults and
`postgres` is not a member of that role, so the migration's second statement raises
`insufficient_privilege` and is skipped with a notice. Tables the Supabase platform itself
creates in `public` as `supabase_admin` are still auto-granted. Closing that needs the dashboard
or support, not a migration. The fifth structural test ("a newly created table is NOT reachable
by the Data API roles by default") creates a real table and reads the privileges it landed with,
so it guards the `postgres` path against regression — but it connects as `postgres` and cannot
see the `supabase_admin` path.

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
`docs-updater`), evaluates the release level from shipped compatibility and user impact, gets
confirmation before starting a major/minor line, records the resulting version in `CHANGELOG.md`,
runs the fast checks (`format:check`, `lint`, `tsc -b`), pushes, and opens or updates the PR; run it
with "ship it" when a branch is ready. Whether or not you use it, keep `AGENTS.md`, `README.md`,
`ROADMAP.md`, and `CHANGELOG.md` aligned when a change affects project behavior, commands,
architecture, or release notes.

### Two authored trees, two generated trees — opposite directions on purpose

Both Claude Code and Codex are used on this repo, and they read different files. Rather than keep
hand-written copies that drift, each generated tree is produced from an authored one by
`scripts/sync-codex.mjs` (`npm run codex:sync`):

| Authored (edit this)   | Generated (never edit)   | How                                            |
| ----------------------- | ------------------------ | ---------------------------------------------- |
| `.claude/agents/<n>.md` | `.codex/agents/<n>.toml` | frontmatter + body -> `developer_instructions` |
| `.agents/skills/<n>/**` | `.claude/skills/<n>/**`  | copied verbatim, plus a "generated" banner     |

The two rows run in **opposite** directions, and that asymmetry is deliberate, not a typo: each
authored tree is wherever something actually writes to it. Subagents are hand-written under
`.claude/agents/`. Skills are installed by a skills-sync tool (e.g. a Matt Pocock skills sync) that
writes real files straight into `.agents/skills/<n>/` — making that side authored is what keeps
installing or updating a skill a one-way write, with nothing to hand-copy back into `.claude/`.
Claude Code itself only discovers skills by scanning `.claude/skills` from the cwd up to the repo
root, so that side has to be the generated one. Both generated trees are **committed**, so a Codex
or Claude session gets them without running Node.

**Skills used to run the same direction as subagents** (`.claude/skills/` authored,
`.agents/skills/` generated), bridged by OS symlinks so both paths resolved to the same bytes. That
broke for two independent reasons, hit for real in this repo once a skills-sync tool wrote into
`.agents/skills/<n>/` and symlinked `.claude/skills/<n>` back to it:

1. `readdirSync(dir, { withFileTypes: true })` reports a symlinked directory as
   `isSymbolicLink()`, not `isDirectory()`. The sync script's directory walker filtered on
   `isDirectory()`, so it treated every symlinked skill as a single file and handed it to
   `readFileSync` — which throws `EISDIR` once it resolves through the link to a directory.
2. `git config core.symlinks` is `false` on a stock Windows checkout (no symlink privilege), so Git
   cannot store a symlink as a symlink: `git add` on one walks through it and stages the target's
   file contents under the link's path, silently duplicating every byte instead of recording a link.

**Never reintroduce a symlink under `.claude/skills/` or `.agents/skills/`** — either failure mode
comes back. `scripts/sync-codex.mjs`'s walker now throws immediately on any symlink it finds, in
either tree, specifically so a repeat shows up as a loud error instead of one of the two failures
above.

Rules for this pipeline:

- **`.claude/agents/` and `.agents/skills/` are authored — edit those directly.** `.codex/agents/`
  and `.claude/skills/` are generated — never hand-edit them, run `npm run codex:sync`. The script
  owns every byte in both generated trees, so a file with no source is deleted as stale.
- **Never "adapt" skill prose in transit.** A blind `CLAUDE.md` -> `AGENTS.md` substitution is what
  once produced "edit `AGENTS.md`, never add content to `AGENTS.md`". References to `CLAUDE.md` are
  correct as written for both tools, because it really does exist and really is just an import.
- The Claude-only frontmatter keys are translated, not dropped silently: `tools:` without any
  file-writing tool becomes `sandbox_mode = "read-only"`, and `model:` is recorded in a comment as
  not carried over (Claude's tiers name no Codex model; Codex uses `agents.default_subagent_model`).
- A generated `SKILL.md` carries its banner as a YAML comment on line 2 — line 1 stays `---`, so the
  frontmatter still parses — rather than as prose after the closing `---`; every other file in a
  skill directory (`references/*.md`, `scripts/*.sh`, `agents/*.yaml`, …) is copied byte-for-byte.
- Neither generated tree is covered by `npm run format` (its globs are `src`/`tests`/`scripts` TS
  only), so there is no format-before-sync ordering concern today — but if a future formatter glob
  ever reaches `.md`/`.yaml`/`.sh`, run `npm run format` before `npm run codex:sync`, not after, or
  the generated copy mirrors unformatted content and drifts again on the next format pass.
- The required **`Agents` CI job** runs `npm run codex:check`, which fails on any missing, hand-edited,
  or stale generated file, and also asserts `CLAUDE.md` still contains its `@AGENTS.md` import line.
  Pure logic in the script is unit-tested in `scripts/sync-codex.test.mjs`.
- `skills-lock.json` at the repo root is the skills-sync tool's own lockfile (source repo + commit
  hash per installed skill) — committed as installer metadata, untouched by `sync-codex.mjs`.

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

It also asserts the three Board tables are in `data.sql` and that `schema.sql` defines
`handle_new_user`, `handle_account_deletion`, and `tasks_infer_board_id`. Both additions guard the
same failure: a bundle that verifies clean and restores into a broken database. Without the Board
tables, every restored task carries a `board_id` pointing at nothing — and because `data.sql` sets
`session_replication_role = replica` on its own first line, the foreign key does not stop it, so the
restore *succeeds* into a database where no task belongs to any reachable board. Without the
functions, the restored schema has policies and constraints whose lifecycle triggers are missing,
which shows up first as `Database error deleting user`. The function check matters most because
`supabase db dump` takes **no `--schema` flag** here, so what it captures is a vendor default this
repo does not control.

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

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for jwh3times/magic-agenda. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix), used as-is. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
