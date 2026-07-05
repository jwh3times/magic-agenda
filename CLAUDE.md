# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Magic Agenda is a drag-and-drop task board (day / week / kanban views, recurring tasks, three visual
themes) built as a pure React + TypeScript SPA on Supabase (Postgres + Auth), deployed to Cloudflare
Pages at [magicagenda.app](https://magicagenda.app). Pages live in `src/pages/`: `BoardPage` (the app),
`Login`, `AuthCallback`, and the static legal pages `Privacy` / `Terms` (both rendered through
`src/components/LegalLayout.tsx`).

## Commands

```bash
npm run dev            # Vite dev server at http://localhost:5173
npm run build          # tsc -b (typecheck) && vite build -> dist/
npm test               # vitest run (all tests once)
npm run test:watch     # vitest watch mode
npm run lint           # eslint
npm run format         # prettier --write (src only; design/ is .prettierignore'd)
npm run format:check   # prettier --check (the CI "Format" job runs this + lint)

# Run one test file or one test by name:
npx vitest run src/dnd/reorder.test.ts
npx vitest run -t "persists a cross-lane move"

# Database (Supabase CLI; project is linked):
npx supabase db push                                              # apply supabase/migrations/*
npx supabase gen types typescript --linked > src/types/database.types.ts
```

Tests are hermetic — `vite.config.ts` injects dummy `VITE_SUPABASE_*` env, so they never hit the real
project. Local dev needs a real `.env.local` (copy `.env.example`); `src/lib/supabase.ts` throws at
startup if the two `VITE_SUPABASE_*` vars are missing.

`main` is **protected — PR-only, no direct pushes** (no admin bypass). Land changes via a branch + PR;
the `Format` / `Test` / `Build` checks and CodeQL must pass and review threads resolve before merge (0
approvals required, so you can self-merge once green). Cloudflare Pages builds & deploys `main`
(`npm run build` → `dist`), so production only ships after a checks-passing merge. Database migrations
are applied to production on the same merge by the `Deploy Migrations` workflow (triggered by changes
under `supabase/migrations/**`). `VITE_*` vars are inlined at **build time**, so they must be set in the
Pages project, not just locally. Every merge to `main` is also stamped by the `Version` workflow
(`.github/workflows/version.yml`), which pushes a build tag `v<package.json version>.<build>`
(e.g. `v1.1.1.3`) with an auto-incrementing build number; release tags stay 3-part (`v1.1.1`).

## Architecture (the parts that span multiple files)

Pure SPA → Supabase, no server of our own. Postgres **Row-Level Security is the only authorization
boundary** (every table default-denies and scopes to `auth.uid() = user_id`); the anon key is public
by design.

### App / DB boundary conventions — get these wrong and data breaks subtly

- **`'inbox'` ↔ `NULL`**: the app `Task.day` is the literal `'inbox'` (unscheduled) or `'YYYY-MM-DD'`.
  The `'inbox'` sentinel stays everywhere in app/DnD logic and maps to a `NULL` `day` **only** in
  `src/data/mappers.ts`.
- **`order` is reserved SQL** → the column is `order_index`; the app keeps `order`/`korder`.
- **`done` is derived** (`status === 'done'`), never stored.
- These conversions live entirely in `mappers.ts` (`rowToTask` / `taskToRow`). Everything else works in
  app-domain `Task` objects (`src/types/task.ts`).

### Data ownership: `BoardPage` owns state, `Board` is prop-driven

`pages/BoardPage.tsx` wires `useTasks(userId)` + `useSettings(userId)` + `ThemeProvider` and passes
tasks and every mutation down to `components/Board.tsx` as props. `Board` holds only **UI** state (view,
anchor date, editing modal, pop animation, filter). This decoupling is deliberate — it keeps `Board`
testable without Supabase (`Board.test.tsx` renders it with a stateful `Harness`). `useTasks` is the
single source of truth for board tasks: optimistic CRUD with rollback, plus `persistReorder` (upserts
only the changed lanes). To follow a write end-to-end, read `BoardPage` → `Board` → `useTasks`.
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
prompt → `Board` routes to `updateSeries` / `deleteOccurrence` / `deleteSeriesFuture`). `reload()` has an
in-flight guard because React StrictMode double-invokes the load effect, which otherwise double-inserts
instances and trips the `(recur_parent_id, day)` unique index (Postgres 23505).

### Drag-and-drop: pure core, then dnd-kit wiring

`src/dnd/reorder.ts` is **pure and unit-tested** (`moveToDay` / `moveToStatus` / `reindex` /
`findContainer`) — it reindexes **both** the source and destination lanes on a cross-container move.
`src/dnd/useBoardDnd.ts` wires dnd-kit: `onDragOver` does optimistic cross-lane moves; `onDragEnd`
persists the touched lanes. Critical, non-obvious detail: persistence must fire **even when
`over.id === active.id`** (after an optimistic move the dragged card sits under the cursor as its own
drop target) — tracked via a `didMove` ref. Container ids are `dateStr | 'inbox'` (day mode) or status
(kanban). While a search filter is active, drag is disabled via `DragDisabledContext` (consumed by
`SortableCard`'s `useSortable({ disabled })`) — this keeps the `DndContext` sensors array a constant
size, avoiding a dnd-kit hook-deps warning. Sensors are split Mouse/Touch (not `PointerSensor`):
touch drags require a **250ms long-press** and cards use `touchAction: 'manipulation'` — together
that's what lets a plain swipe over a card scroll the board on phones. Don't collapse these back
into a `PointerSensor` or set `touchAction: 'none'`.

### Responsive layout branches on `useIsMobile()`, not CSS media queries

Because styles are inline objects (below), media queries can't reach them. Components that adapt to
phones (`Board`, `Toolbar`, `CalendarView`, `WeekView`, `KanbanView`, `Inbox`, `SearchFilterBar`,
`TaskEditor`) call `useIsMobile()` from `src/lib/useMediaQuery.ts` (a reactive `matchMedia` hook;
breakpoint `MOBILE_QUERY` = 760px) and branch in JSX, spreading overrides onto the chrome styles.
The hook returns `false` where `matchMedia` is missing, so jsdom tests render the desktop layout
unless they stub `matchMedia` (see the mobile block in `Board.test.tsx`). Mobile layouts: stacked
toolbar rows, vertical Week list, side-panning month grid (min-width 640px), snap-scroll kanban
columns, and a collapsible full-width Inbox docked under the board. The shell height is the
`.app-root` CSS class (`100dvh` with a `100vh` fallback) — inline styles can't express the
fallback, so don't move it back into `rootStyle`. Form fields use ≥16px text on mobile (smaller
triggers iOS Safari's focus zoom).

### Theming is an inline-style-object model, not CSS

Ported verbatim from the prototype. `theme/constants.ts` (CAT/COLORS/STATUS/PAPER), `theme/themeConf.ts`
(~26 tokens per theme), `theme/cardStyles.ts` (the style half of the prototype's `noteView`, incl.
`rotOf`, pin, DONE stamp), and `theme/chrome.ts` (board/cell/inbox/column/toolbar styles) all return
plain style objects with per-theme branching (rotation, pins, hard vs. soft shadows, blur). Three
themes: `cork` / `brutal` / `glass`. **Do not refactor this to CSS variables** — the look depends on the
branching that CSS vars can't express cleanly.

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

## Agents & docs automation

Project subagents live in `.claude/agents/`: `docs-updater` (keeps CLAUDE.md, README.md, ROADMAP.md,
CHANGELOG.md in sync with the code) and `code-reviewer` (reviews diffs against the app/DB boundary,
RLS, recurrence, and DnD correctness rules before merging). Docs freshness is auto-checked at the
end of every response turn by a read-only Stop hook in `.claude/settings.json` (single pre-approved
git command + Read/Grep/Glob — it never edits files). When it detects drift it blocks the stop with
specifics and the main session invokes `docs-updater` to fix exactly that drift.
