# Phase 2 — Scheduling Depth Implementation Plan

> **Status: Shipped 2026-07-06.** Historical planning record, kept for reference — checkboxes and
> instructions reflect the moment the plan was written, not current state. For what shipped see
> [CHANGELOG.md](../../CHANGELOG.md); for current architecture see [AGENTS.md](../../AGENTS.md).

**Goal:** Ship the four Phase 2 roadmap items — 2.1 Due time, 2.2 Priority via pins, 2.3 Overdue handling & roll-forward, 2.4 Export / import — as four sequential PRs.

**Architecture:** Two additive `tasks` columns (`at_time time`, `pinned boolean`) flow through the established single-boundary path (migration → `database.types.ts` → `mappers.ts` → app-domain `Task`); everything else is pure selectors/serializers (test-first) plus surgical UI edits. Manual drag order stays authoritative everywhere — time affects only Agenda sorting, pinning is a filter, roll-forward appends to today's order.

**Tech Stack:** React 19 + TypeScript SPA, Supabase (Postgres + RLS + realtime), Vitest 4 + Testing Library, inline-style theming.

## Global Constraints

- `main` is PR-only. Each Part below is **one branch + one PR**, merged strictly in order A → B → C → D (they share files: `task.ts`, `mappers.ts`, `TaskEditor.tsx`, `cardStyles.ts`, `TaskCard.tsx`); each Part branches from freshly-pulled `main` AFTER the previous Part merged. Self-merge once green (required checks: Format, Test, Build, Functions + CodeQL).
- **Per-commit gate (every task):** `npm test`, `npm run lint`, `npm run build` (tsc catches Task-literal ripples and test-file typing — test+lint alone missed one in Phase 0/1), and `npx prettier --check <every touched src/** file>` (`--write` those exact files if it warns, then re-run tests). NEVER run repo-wide `npm run format` (local CRLF noise rewrites ~38 unrelated files; CI is authoritative).
- Commit messages: plain imperative subjects (no `feat:` prefixes), ending with the line `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Schema convention for this plan:** migrations auto-apply to production on merge (`Deploy Migrations` workflow, ~25s — consistently faster than the Pages build, which is the deploy-window ordering we rely on). `src/types/database.types.ts` is **hand-edited** in the same PR (the generated file can only be regenerated against the remote DB after the migration applies); mappers read the new columns defensively (`?? null` / `?? false`) so a stale-schema read can't produce `undefined`. A post-merge `gen types --linked` verification happens once after Part B (see "Post-merge wrap").
- All app↔DB conversions stay in `src/data/mappers.ts`; new columns extend `rowToTask` / `taskToRow` and nothing else touches row shapes. Realtime needs no extra work — `payloadToChange` maps rows through `rowToTask`, so new fields flow automatically, and `rowToTask`'s fixed key order keeps the reducer's `sameTask` comparison valid.
- **Adding a required field to `Task` ripples through every full Task literal.** Known sites: `src/types/task.ts` (interface), `src/data/mappers.ts` (both fns), `src/components/Board.tsx` (`newTaskTemplate`), `src/data/useTasks.ts` (`makeInstance`), `src/data/mockTasks.ts` (`mk`), `src/theme/theme.test.ts` (`task()`), `src/data/realtime.test.ts` (`base` + `row()`), `src/data/useTasks.test.ts` (`appTask` + `serverRow`). `npm run build` (tsc) is the completeness net — a literal you missed fails the build.
- Recurrence invariants: templates stay hidden in `templatesRef`; instance identity is the immutable `recur_origin_day`; `recurSkip` owns deletions. Roll-forward moves `day` only — never the origin.
- Manual drag order is authoritative: no lane may auto-sort by time or pin (Agenda's within-day time sort is the single sanctioned exception — Agenda is not a drag surface).
- Optimistic writes with rollback (the `useTasks` pattern); every new Supabase write in `useTasks` calls `markWrites(ids)` before the await (realtime echo suppression).
- Form fields that appear on phones use ≥16px font (`ctlFont` in TaskEditor already handles this — reuse it).
- Test-first for all pure logic (`src/data`, `src/lib`, `src/theme` style functions); UI gets Testing Library coverage.
- Windows/dev env: Deno not needed for this plan. gh CLI authenticated.

## PR sequencing

| Part | Roadmap item | Branch | Depends on |
| ---- | ---------------------------- | ------------------------- | ------------------- |
| A | 2.1 Due time / time-of-day | `feat/due-time` | — |
| B | 2.2 Priority via pins | `feat/priority-pins` | A merged |
| C | 2.3 Overdue & roll-forward | `feat/overdue-rollforward` | B merged |
| D | 2.4 Export / import | `feat/export-import` | B merged (exports include `atTime`+`pinned`); run after C for simplicity |

---

# Part A — 2.1 Due time / time-of-day (PR 1)

`day` stays date-only; a task gains an optional `atTime: 'HH:MM' | null` (NULL = all-day). Editor gets a clearable time input in the Schedule row; cards show a compact time chip; the Agenda sorts timed-before-untimed within each day. Day cells keep manual drag order (time is display metadata there). Templates carry the time; every materialized occurrence copies it.

### Task A1: Data layer — migration, types, `Task.atTime`, mappers (TDD)

**Files:**
- Create: `supabase/migrations/20260705100000_task_at_time.sql`
- Modify: `src/types/database.types.ts` (tasks Row/Insert/Update — hand-edit), `src/types/task.ts`, `src/data/mappers.ts`, `src/components/Board.tsx` (`newTaskTemplate`), `src/data/useTasks.ts` (`makeInstance`), `src/data/mockTasks.ts`, `src/theme/theme.test.ts` (`task()` factory), `src/data/realtime.test.ts` (`base`+`row()`), `src/data/useTasks.test.ts` (`appTask`+`serverRow`)
- Test: `src/data/mappers.test.ts` (extend)

**Interfaces:**
- Produces: `Task.atTime: string | null` ('HH:MM', required field); DB column `at_time time NULL`; `rowToTask` normalizes Postgres 'HH:MM:SS' → 'HH:MM'; `taskToRow` writes `at_time: task.atTime`.

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull --ff-only
git checkout -b feat/due-time
```

- [ ] **Step 2: Write the failing mapper tests**

Append to `src/data/mappers.test.ts` (match the file's existing row/task fixture style — extend the existing fixtures with the new field rather than duplicating them):

```ts
test('at_time round-trips and normalizes the seconds Postgres appends', () => {
  // Postgres `time` comes back as 'HH:MM:SS'; the app keeps 'HH:MM'.
  const withSeconds = rowToTask({ ...baseRow, at_time: '14:30:00' })
  expect(withSeconds.atTime).toBe('14:30')
  expect(taskToRow(withSeconds, 'u1').at_time).toBe('14:30')

  const allDay = rowToTask({ ...baseRow, at_time: null })
  expect(allDay.atTime).toBeNull()
  expect(taskToRow(allDay, 'u1').at_time).toBeNull()
})
```

(`baseRow` = whatever complete row fixture the file already uses; if it's named differently, use that name. If the file builds rows inline, add a helper-free version with the same fields.)

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/data/mappers.test.ts`
Expected: FAIL — `at_time` not in the row type / `atTime` undefined.

- [ ] **Step 4: Implement the data layer**

1. Create `supabase/migrations/20260705100000_task_at_time.sql`:

```sql
-- Optional due time for a task. NULL = all-day. No backfill needed; the app treats
-- a missing/NULL value as all-day, so old and new app versions tolerate each other
-- during the deploy window.
alter table public.tasks add column at_time time;
```

2. Hand-edit `src/types/database.types.ts` — in the `tasks` table block, add alphabetically (`at_time` sorts first):
   - Row: `at_time: string | null`
   - Insert: `at_time?: string | null`
   - Update: `at_time?: string | null`

3. `src/types/task.ts` — add to the `Task` interface after `day`:

```ts
  /** Optional due time 'HH:MM' (24h). null = all-day. Maps to the nullable at_time column. */
  atTime: string | null
```

4. `src/data/mappers.ts`:
   - `rowToTask`: add `atTime: row.at_time ? row.at_time.slice(0, 5) : null,` (defensive: also covers `undefined` during the deploy window).
   - `taskToRow`: add `at_time: task.atTime,`

5. Ripple `atTime` into every full Task literal (values):
   - `Board.tsx` `newTaskTemplate`: `atTime: null,`
   - `useTasks.ts` `makeInstance`: `atTime: tmpl.atTime,` ← **copies the template's time to every occurrence** (this is the one site that is NOT null)
   - `mockTasks.ts` `mk()`: `atTime: null,`
   - `theme.test.ts` `task()`: `atTime: null,`
   - `realtime.test.ts`: `base` gets `atTime: null,`; `row()` gets `at_time: null,`
   - `useTasks.test.ts`: `appTask` gets `atTime: null,`; `serverRow` gets `at_time: null,`

- [ ] **Step 5: Run the tests, then the full gate**

Run: `npx vitest run src/data/mappers.test.ts` → PASS.
Run: `npm test && npm run lint && npm run build` → all green (build failing = a Task literal you missed; fix it).
Run: `npx prettier --check` on every touched `src/**` file; `--write` + re-test if it warns.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260705100000_task_at_time.sql src/types/database.types.ts src/types/task.ts src/data/mappers.ts src/data/mappers.test.ts src/components/Board.tsx src/data/useTasks.ts src/data/mockTasks.ts src/theme/theme.test.ts src/data/realtime.test.ts src/data/useTasks.test.ts
git commit -m "Add an optional due time to tasks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task A2: Pure logic — `formatTime` + Agenda time sorting (TDD)

**Files:**
- Modify: `src/lib/dates.ts`, `src/data/selectors.ts` (`agendaGroups` sort)
- Test: `src/lib/dates.test.ts` (new), `src/data/selectors.test.ts` (extend)

**Interfaces:**
- Produces: `formatTime(hhmm: string): string` ('14:30' → '2:30pm', '09:00' → '9am', '00:15' → '12:15am', '12:00' → '12pm'); `agendaGroups` sorts each day's tasks timed-first (by time, ties by `order`), untimed after (by `order`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/dates.test.ts`:

```ts
import { expect, test } from 'vitest'
import { formatTime } from './dates'

test('formatTime renders compact 12-hour labels', () => {
  expect(formatTime('09:00')).toBe('9am')
  expect(formatTime('14:30')).toBe('2:30pm')
  expect(formatTime('12:00')).toBe('12pm')
  expect(formatTime('00:15')).toBe('12:15am')
  expect(formatTime('23:59')).toBe('11:59pm')
})
```

Append to `src/data/selectors.test.ts` (reuse the file's existing task-fixture helper; if it builds tasks inline, follow that style — every literal now needs `atTime`):

```ts
test('agendaGroups sorts timed tasks first within a day, then by time, then order', () => {
  const day = '2026-07-10'
  const tasks = [
    mkTask({ id: 'untimed-early', day, order: 0, atTime: null }),
    mkTask({ id: 'late', day, order: 1, atTime: '15:00' }),
    mkTask({ id: 'early', day, order: 2, atTime: '09:00' }),
    mkTask({ id: 'tie-b', day, order: 4, atTime: '09:00' }),
  ]
  const [group] = agendaGroups(tasks)
  expect(group.tasks.map((t) => t.id)).toEqual(['early', 'tie-b', 'late', 'untimed-early'])
})
```

(`mkTask` = the file's existing helper name; adapt. `early` before `tie-b` because equal times fall back to `order` 2 < 4.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/dates.test.ts src/data/selectors.test.ts`
Expected: FAIL — `formatTime` not exported; agenda order is plain `order` sort.

- [ ] **Step 3: Implement**

`src/lib/dates.ts` — append:

```ts
/** 'HH:MM' → compact 12-hour label, e.g. '14:30' → '2:30pm', '09:00' → '9am'. */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const ap = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12}${ap}` : `${h12}:${String(m).padStart(2, '0')}${ap}`
}
```

`src/data/selectors.ts` — add above `agendaGroups`:

```ts
/** Agenda within-day ordering: timed before untimed, by time, ties by manual order. */
function byAgendaTime(a: Task, b: Task): number {
  if (a.atTime && b.atTime && a.atTime !== b.atTime) return a.atTime < b.atTime ? -1 : 1
  if (a.atTime && !b.atTime) return -1
  if (!a.atTime && b.atTime) return 1
  return a.order - b.order
}
```

and change `agendaGroups`'s map line to:

```ts
    .map((day) => ({ day, tasks: (byDay.get(day) ?? []).sort(byAgendaTime) }))
```

(`notesForDay` / `tasksForStatus` are NOT touched — day cells and kanban keep manual order.)

- [ ] **Step 4: Run tests + full gate**

Run: `npx vitest run src/lib/dates.test.ts src/data/selectors.test.ts` → PASS.
Full gate + prettier per Global Constraints.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dates.ts src/lib/dates.test.ts src/data/selectors.ts src/data/selectors.test.ts
git commit -m "Sort agenda days by due time with a compact time formatter

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task A3: UI — editor time input + card time chip (TDD)

**Files:**
- Modify: `src/components/TaskEditor.tsx` (Schedule row), `src/components/TaskCard.tsx`
- Test: `src/components/TaskCard.test.tsx` (new)

**Interfaces:**
- Consumes: `formatTime` (A2), `Task.atTime` (A1).
- Produces: nothing later tasks need; the new `TaskCard.test.tsx` file is extended by Parts B/C.

- [ ] **Step 1: Write the failing test**

Create `src/components/TaskCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { ThemeProvider } from '../theme/ThemeProvider'
import { TaskCard, type TaskCardProps } from './TaskCard'
import { NO_RECUR, type Task } from '../types/task'

function mkTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Card under test',
    description: '',
    category: 'work',
    color: 'yellow',
    checklist: [],
    status: 'todo',
    done: false,
    day: '2026-07-10',
    order: 0,
    korder: 0,
    atTime: null,
    ...NO_RECUR,
    ...over,
  }
}

function renderCard(task: Task, props: Partial<TaskCardProps> = {}) {
  return render(
    <ThemeProvider>
      <TaskCard task={task} variant="inbox" {...props} />
    </ThemeProvider>,
  )
}

test('shows a compact time chip when the task has a due time', () => {
  renderCard(mkTask({ atTime: '14:30' }))
  expect(screen.getByText('2:30pm')).toBeInTheDocument()
})

test('shows no time chip for all-day tasks', () => {
  renderCard(mkTask({ atTime: null }))
  expect(screen.queryByText(/am|pm/)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/TaskCard.test.tsx`
Expected: the time-chip test FAILS (no chip rendered).

- [ ] **Step 3: Implement**

`src/components/TaskCard.tsx`:
1. Extend the dates import: `import { chipLabel, formatTime } from '../lib/dates'`
2. In the meta row, immediately after `<span style={s.catStyle}>{cat.label}</span>`, insert:

```tsx
        {task.atTime && <span style={s.chipStyle}>{formatTime(task.atTime)}</span>}
```

`src/components/TaskEditor.tsx` — in the Schedule row (the `<div>` holding the date input and the Send-to-inbox button), insert between the date `<input type="date">` and the inbox button:

```tsx
            <input
              type="time"
              aria-label="Due time"
              value={draft.atTime ?? ''}
              onChange={(e) => patch({ atTime: e.target.value || null })}
              style={{
                padding: '9px 12px',
                borderRadius: '9px',
                border: `1px solid ${border}`,
                background: fieldBg,
                color: fg,
                fontFamily: conf.ui,
                fontSize: ctlFont,
                fontWeight: 600,
                colorScheme: dark ? 'dark' : 'light',
              }}
            />
            {draft.atTime && (
              <button
                type="button"
                aria-label="Clear time"
                onClick={() => patch({ atTime: null })}
                style={{
                  padding: '9px 12px',
                  borderRadius: '9px',
                  cursor: 'pointer',
                  fontFamily: conf.ui,
                  fontSize: '12.5px',
                  fontWeight: 700,
                  border: `1px solid ${border}`,
                  background: 'transparent',
                  color: fg,
                }}
              >
                ✕ time
              </button>
            )}
```

(The style objects duplicate the adjacent date input's — that's this file's existing idiom; don't extract a shared const.)

- [ ] **Step 4: Run tests + full gate**

Run: `npx vitest run src/components/TaskCard.test.tsx` → 2/2 PASS. Then the full gate + prettier.

- [ ] **Step 5: Commit**

```bash
git add src/components/TaskEditor.tsx src/components/TaskCard.tsx src/components/TaskCard.test.tsx
git commit -m "Add a due-time input to the editor and a time chip to cards

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task A4: CHANGELOG + PR 1

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: CHANGELOG entry** — first bullet under `## [Unreleased]` → `### Added`:

```markdown
- **Due times** — tasks can carry an optional time of day: set or clear it in the editor's
  Schedule row, see it as a chip on cards, and the Agenda sorts timed tasks first within each
  day (calendar cells keep manual drag order). Recurring series pass their time to every
  occurrence.
```

- [ ] **Step 2: Full verification** — `npm test && npm run lint && npm run build` all green.

- [ ] **Step 3: Commit, push, PR**

```bash
git add CHANGELOG.md
git commit -m "Add due-time changelog entry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin feat/due-time
gh pr create --title "Due time / time-of-day (roadmap 2.1)" --body "$(cat <<'EOF'
Optional per-task due time (at_time time NULL): editor input (clearable), per-theme time chip on cards, timed-first sorting in the Agenda only — day cells keep manual drag order. Templates pass the time to materialized occurrences. database.types.ts hand-edited (post-merge gen-types verification per plan). Times are naive local until the timezone setting (roadmap 4.1) lands.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Merge when green; the migration auto-applies on merge.

---

# Part B — 2.2 Priority via pins (PR 2)

**Branch only after Part A merges.** `pinned boolean not null default false`. Editor toggle + a pin tap-target on every card; per-theme visuals (cork's decorative pin becomes the pinned signal; brutal gets a corner flash; glass a violet glow); a "📌 Pinned" quick filter. **Manual order is never overridden by pinning.**

### Task B1: Data layer — migration, types, `Task.pinned`, mappers, filter logic (TDD)

**Files:**
- Create: `supabase/migrations/20260705110000_task_pinned.sql`
- Modify: `src/types/database.types.ts` (hand-edit), `src/types/task.ts`, `src/data/mappers.ts`, `src/data/filters.ts`, plus the same Task-literal ripple sites as Task A1 (this time adding `pinned: false` / `pinned: false` in `serverRow`/`row()`; `makeInstance` copies `tmpl.pinned`)
- Test: `src/data/mappers.test.ts`, `src/data/filters.test.ts` (extend both)

**Interfaces:**
- Produces: `Task.pinned: boolean` (required); `FilterQuery.pinned: boolean` (`EMPTY_FILTER.pinned = false`; active filter when true; `applyFilters` keeps only pinned when on). `makeInstance` copies the template's pinned flag; `updateSeries` deliberately does NOT propagate pin changes (pinning stays per-occurrence, like status).

- [ ] **Step 1: Branch** — `git checkout main && git pull --ff-only && git checkout -b feat/priority-pins`

- [ ] **Step 2: Write the failing tests**

Append to `src/data/mappers.test.ts`:

```ts
test('pinned round-trips and defaults false when the column is absent', () => {
  const pinnedRow = rowToTask({ ...baseRow, pinned: true })
  expect(pinnedRow.pinned).toBe(true)
  expect(taskToRow(pinnedRow, 'u1').pinned).toBe(true)
  // Deploy-window tolerance: a row read before the migration applied has no field.
  const legacy = rowToTask({ ...baseRow, pinned: undefined as unknown as boolean })
  expect(legacy.pinned).toBe(false)
})
```

Append to `src/data/filters.test.ts` (adapt to the file's existing fixtures — its FilterQuery literals all need `pinned: false` added):

```ts
test('the pinned facet keeps only pinned tasks and counts as an active filter', () => {
  const tasks = [mkTask({ id: 'a', pinned: true }), mkTask({ id: 'b', pinned: false })]
  const q = { ...EMPTY_FILTER, pinned: true }
  expect(applyFilters(tasks, q).map((t) => t.id)).toEqual(['a'])
  expect(isFilterActive(q)).toBe(true)
  expect(isFilterActive(EMPTY_FILTER)).toBe(false)
})
```

- [ ] **Step 3: Run to verify they fail** — `npx vitest run src/data/mappers.test.ts src/data/filters.test.ts` → FAIL (unknown fields).

- [ ] **Step 4: Implement**

1. `supabase/migrations/20260705110000_task_pinned.sql`:

```sql
-- Sticky-note pin: a per-task importance flag surfaced by the per-theme pin visual
-- and a quick filter. Never a sort key — manual drag order stays authoritative.
alter table public.tasks add column pinned boolean not null default false;
```

2. `database.types.ts` tasks block: Row `pinned: boolean`; Insert `pinned?: boolean`; Update `pinned?: boolean` (alphabetical: after `order_index`).
3. `task.ts` — after `atTime`:

```ts
  /** Sticky-note pin (importance flag). Filterable, never a sort key. */
  pinned: boolean
```

4. `mappers.ts`: `rowToTask` adds `pinned: row.pinned ?? false,`; `taskToRow` adds `pinned: task.pinned,`
5. `filters.ts`:

```ts
export interface FilterQuery {
  text: string
  category: Category | 'all'
  status: Status | 'all'
  pinned: boolean
}

export const EMPTY_FILTER: FilterQuery = { text: '', category: 'all', status: 'all', pinned: false }

export function isFilterActive(q: FilterQuery): boolean {
  return q.text.trim() !== '' || q.category !== 'all' || q.status !== 'all' || q.pinned
}
```

and in `applyFilters`, first line of the predicate: `if (q.pinned && !t.pinned) return false`.

6. Ripple `pinned: false` into the same literal sites as A1 — with `makeInstance` copying `pinned: tmpl.pinned,` and the row factories (`row()` / `serverRow`) adding `pinned: false,`.

- [ ] **Step 5: Tests + full gate** — targeted tests PASS, then `npm test && npm run lint && npm run build` + per-file prettier.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260705110000_task_pinned.sql src/types/database.types.ts src/types/task.ts src/data/mappers.ts src/data/mappers.test.ts src/data/filters.ts src/data/filters.test.ts src/components/Board.tsx src/data/useTasks.ts src/data/mockTasks.ts src/theme/theme.test.ts src/data/realtime.test.ts src/data/useTasks.test.ts
git commit -m "Add a pinned flag to tasks with a pinned-only filter facet

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task B2: Per-theme pin visuals in `cardStyles` (TDD)

**Files:**
- Modify: `src/theme/cardStyles.ts`
- Test: `src/theme/theme.test.ts`

**Interfaces:**
- Produces: `showPin` true only for a PINNED task on cork (existing red pin) or brutal (new corner flash), never for ghost; glass expresses pinning as a violet glow appended to `wrap.boxShadow`. `CardStyles` gains `pinBtn: CSSProperties` (the tap-target style Task B3 consumes).

- [ ] **Step 1: Update + write tests (one of these is a semantics CHANGE)**

In `src/theme/theme.test.ts`, REPLACE the existing test `'cork shows a pin; non-cork themes do not'` (lines ~59-63) with:

```ts
  it('the pin is the pinned signal: cork red pin / brutal corner flash, only when pinned', () => {
    expect(cardStyles('cork', task(), 'cell').showPin).toBe(false)
    expect(cardStyles('cork', task({ pinned: true }), 'cell').showPin).toBe(true)
    expect(cardStyles('brutal', task(), 'cell').showPin).toBe(false)
    const b = cardStyles('brutal', task({ pinned: true }), 'cell')
    expect(b.showPin).toBe(true)
    expect(String(b.pinStyle.borderTop)).toContain('#FF4D2E')
    expect(cardStyles('glass', task({ pinned: true }), 'cell').showPin).toBe(false)
  })

  it('glass pinned cards glow; unpinned do not', () => {
    const off = String(cardStyles('glass', task(), 'cell').wrap.boxShadow)
    const on = String(cardStyles('glass', task({ pinned: true }), 'cell').wrap.boxShadow)
    expect(off).not.toContain('rgba(124,92,255')
    expect(on).toContain('rgba(124,92,255')
  })
```

Also update the existing `'ghost variant suppresses pin and rotation'` test: change its first line to `const g = cardStyles('cork', task({ pinned: true }), 'ghost')` (a ghost must hide even a pinned task's pin).

- [ ] **Step 2: Run to verify the new expectations fail** — `npx vitest run src/theme/theme.test.ts` → FAIL (cork still shows pins unpinned; brutal never shows one).

- [ ] **Step 3: Implement in `src/theme/cardStyles.ts`**

1. In the brutal branch (`else if (theme === 'brutal')`), after the `titleStyle` assignment, add:

```ts
    if (task.pinned) {
      // Corner flash — brutal's pinned signal.
      pinStyle = {
        position: 'absolute',
        top: '-2px',
        right: '-2px',
        width: 0,
        height: 0,
        borderTop: '16px solid #FF4D2E',
        borderLeft: '16px solid transparent',
        zIndex: 2,
      }
    }
```

2. In the glass branch (the final `else`), after its `titleStyle` assignment, add:

```ts
    if (task.pinned && !isGhost) {
      // Violet glow — glass's pinned signal (accent #7c5cff).
      wrap.boxShadow = `${wrap.boxShadow}, 0 0 0 1.5px rgba(124,92,255,.85), 0 0 16px rgba(124,92,255,.35)`
    }
```

3. Add the tap-target style next to `check`:

```ts
  const pinBtn: CSSProperties = {
    width: '19px',
    height: '19px',
    flex: 'none',
    marginLeft: total ? '0px' : 'auto',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    fontSize: '12px',
    lineHeight: 1,
    padding: 0,
    opacity: task.pinned ? 1 : 0.35,
  }
```

4. Change the return: `showPin: (theme === 'cork' || theme === 'brutal') && task.pinned && !isGhost,` and add `pinBtn,` to the returned object (+ `pinBtn: CSSProperties` in the `CardStyles` interface).

- [ ] **Step 4: Tests + full gate** — `npx vitest run src/theme/theme.test.ts` PASS, full gate + prettier.

- [ ] **Step 5: Commit**

```bash
git add src/theme/cardStyles.ts src/theme/theme.test.ts
git commit -m "Make the pin visual mean pinned in every theme

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task B3: Editor toggle + card pin tap-target (TDD)

**Files:**
- Modify: `src/components/TaskEditor.tsx`, `src/components/TaskCard.tsx`, `src/dnd/SortableCard.tsx`, `src/components/boardHandlers.ts`, `src/components/Board.tsx`, `src/components/DayCell.tsx`, `src/components/Column.tsx`, `src/components/Inbox.tsx`, `src/components/AgendaView.tsx`
- Test: `src/components/TaskCard.test.tsx` (extend)

**Interfaces:**
- Consumes: `s.pinBtn` (B2), `Task.pinned` (B1).
- Produces: `TaskCardProps.onTogglePin?: (id: string) => void` (button renders only when provided — the drag overlay/ghost never passes it); `BoardHandlers.onTogglePin: (id: string) => void`; `SortableCardProps.onTogglePin?: (id: string) => void`.

- [ ] **Step 1: Write the failing test** — append to `src/components/TaskCard.test.tsx`:

```tsx
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

test('the pin tap-target toggles without opening the editor', async () => {
  const onTogglePin = vi.fn()
  const onOpen = vi.fn()
  renderCard(mkTask({ pinned: false }), { onTogglePin, onOpen })
  await userEvent.click(screen.getByRole('button', { name: 'Pin' }))
  expect(onTogglePin).toHaveBeenCalledWith('t1')
  expect(onOpen).not.toHaveBeenCalled()
})

test('no pin button renders when no handler is provided (drag overlay)', () => {
  renderCard(mkTask({ pinned: true }))
  expect(screen.queryByRole('button', { name: /Pin|Unpin/ })).not.toBeInTheDocument()
})
```

(Merge these imports with the file's existing import lines.)

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/components/TaskCard.test.tsx` → FAIL (no Pin button).

- [ ] **Step 3: Implement**

1. `TaskCard.tsx` — add to `TaskCardProps`: `onTogglePin?: (id: string) => void` (destructure it too). In the meta row, immediately BEFORE the done-check `<button>`:

```tsx
        {onTogglePin && (
          <button
            type="button"
            aria-label={task.pinned ? 'Unpin' : 'Pin'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onTogglePin(task.id)
            }}
            style={s.pinBtn}
          >
            📌
          </button>
        )}
```

and change the check button's style attribute to keep its layout correct when the pin button takes over the auto margin:

```tsx
          style={onTogglePin ? { ...s.check, marginLeft: '0px' } : s.check}
```

2. `boardHandlers.ts` — add `onTogglePin: (id: string) => void` to `BoardHandlers`.
3. `Board.tsx` — next to `handleToggle`, add:

```ts
  const handlePin = (id: string) => {
    const t = tasks.find((x) => x.id === id)
    if (t) onUpdate({ ...t, pinned: !t.pinned })
  }
```

and add `onTogglePin: handlePin,` to the `handlers` object.

4. `SortableCard.tsx` — add `onTogglePin?: (id: string) => void` to `SortableCardProps`, destructure, and forward `onTogglePin={onTogglePin}` to `<TaskCard>` (exactly mirroring `onToggleDone`).
5. Thread the handler at every site that currently passes `onToggleDone={handlers.onToggleDone}` — add a sibling line `onTogglePin={handlers.onTogglePin}` at each: `DayCell.tsx:45`, `Column.tsx:50`, `Inbox.tsx:60`, `AgendaView.tsx:72`, `AgendaView.tsx:90` (line numbers approximate — anchor on the `onToggleDone={handlers.onToggleDone}` lines; `grep -rn "onToggleDone={handlers" src` must return the same count of `onTogglePin` lines when you're done). Do NOT add it to `CardOverlay` — the overlay is display-only.
6. `TaskEditor.tsx` — after the Status section (its buttons `</div>`), insert:

```tsx
          <div style={fieldLabel}>Pin</div>
          <button
            type="button"
            onClick={() => patch({ pinned: !draft.pinned })}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              padding: '7px 13px',
              borderRadius: '20px',
              cursor: 'pointer',
              fontFamily: conf.ui,
              fontSize: '12.5px',
              fontWeight: 700,
              border: `1px solid ${draft.pinned ? conf.accent : border}`,
              background: draft.pinned ? `${conf.accent}22` : 'transparent',
              color: fg,
            }}
          >
            📌 {draft.pinned ? 'Pinned' : 'Pin this note'}
          </button>
```

- [ ] **Step 4: Tests + full gate** — TaskCard tests PASS; `npm test` (Board.test must stay green — the new handler is built inside Board), lint, build, per-file prettier.

- [ ] **Step 5: Commit**

```bash
git add src/components/TaskEditor.tsx src/components/TaskCard.tsx src/components/TaskCard.test.tsx src/dnd/SortableCard.tsx src/components/boardHandlers.ts src/components/Board.tsx src/components/DayCell.tsx src/components/Column.tsx src/components/Inbox.tsx src/components/AgendaView.tsx
git commit -m "Add pin toggles to the editor and every card

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task B4: Pinned quick filter in the filter bar + CHANGELOG + PR 2

**Files:**
- Modify: `src/components/SearchFilterBar.tsx`, `CHANGELOG.md`

- [ ] **Step 1: Implement the quick filter** — in `SearchFilterBar.tsx`, insert between the status `<select>` and the `{active && (` Clear button:

```tsx
      <button
        type="button"
        aria-label={query.pinned ? 'Show all tasks' : 'Show pinned only'}
        onClick={() => onChange({ ...query, pinned: !query.pinned })}
        style={{
          ...control,
          cursor: 'pointer',
          fontWeight: 700,
          ...(query.pinned ? { color: conf.accent, borderColor: conf.accent } : {}),
        }}
      >
        📌 Pinned
      </button>
```

(Note: while this filter is on, drag is disabled — that's the existing `DragDisabledContext` behavior for any active filter, and it's exactly why pinned-first never fights reorder math.)

- [ ] **Step 2: CHANGELOG entry** — first bullet under `### Added`:

```markdown
- **Pinned notes** — pin important tasks from the editor or the 📌 button on any card. Cork's
  classic red pin now appears only on pinned notes; brutal gets a corner flash; glass a violet
  glow. A "📌 Pinned" quick filter shows pinned tasks only — manual drag order is never
  re-sorted by pinning.
```

- [ ] **Step 3: Full verification + PR**

`npm test && npm run lint && npm run build` + per-file prettier, then:

```bash
git add src/components/SearchFilterBar.tsx CHANGELOG.md
git commit -m "Add a pinned-only quick filter and changelog entry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin feat/priority-pins
gh pr create --title "Priority via pins (roadmap 2.2)" --body "$(cat <<'EOF'
Adds tasks.pinned (default false): editor toggle, 📌 tap-target on cards, per-theme pinned visuals (cork red pin = pinned-only now, brutal corner flash, glass glow), and a pinned-only quick filter. Deliberate decision per roadmap: pinning never sorts lanes — manual drag order stays authoritative. Cork's visual change (decorative pin removed from unpinned cards) is intentional. database.types.ts hand-edited; gen-types verify post-merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# Part C — 2.3 Overdue handling & roll-forward (PR 3)

**Branch only after Part B merges.** Overdue is derived (`scheduled && day < today && status !== 'done'`), no schema. Cards get a red inset accent; the Today button shows a count; the Agenda pins an "Overdue" group on top with "Move all to today" (a batched, echo-marked upsert appending to today's order). Auto-roll-forward stays out (opt-in toggle arrives with roadmap 4.1's settings columns).

### Task C1: Pure selectors — `isOverdue`, `overdueTasks`, `applyRollForward` (TDD)

**Files:**
- Modify: `src/data/selectors.ts`
- Test: `src/data/selectors.test.ts`

**Interfaces:**
- Produces:
  - `isOverdue(t: Task, todayStr: string): boolean`
  - `overdueTasks(tasks: Task[], todayStr: string): Task[]` — sorted by day asc, ties by `order`
  - `applyRollForward(tasks: Task[], todayStr: string): { tasks: Task[]; changed: Task[] }` — moves every overdue task to `day = todayStr`, appending to today's existing max order in overdue-sort sequence; `recurOriginDay` untouched; returns the SAME `tasks` array reference (and `changed: []`) when nothing is overdue.

- [ ] **Step 1: Write the failing tests** — append to `src/data/selectors.test.ts` (adapt fixture helper name; `mkTask` fixtures already carry `atTime`/`pinned` from Parts A/B):

```ts
test('isOverdue: past + scheduled + not done, nothing else', () => {
  const today = '2026-07-10'
  expect(isOverdue(mkTask({ day: '2026-07-09', status: 'todo' }), today)).toBe(true)
  expect(isOverdue(mkTask({ day: '2026-07-09', status: 'done' }), today)).toBe(false)
  expect(isOverdue(mkTask({ day: '2026-07-10' }), today)).toBe(false)
  expect(isOverdue(mkTask({ day: 'inbox' }), today)).toBe(false)
})

test('overdueTasks sorts by day then manual order', () => {
  const today = '2026-07-10'
  const tasks = [
    mkTask({ id: 'b', day: '2026-07-09', order: 1 }),
    mkTask({ id: 'c', day: '2026-07-09', order: 0 }),
    mkTask({ id: 'a', day: '2026-07-01', order: 5 }),
    mkTask({ id: 'x', day: '2026-07-11', order: 0 }),
  ]
  expect(overdueTasks(tasks, today).map((t) => t.id)).toEqual(['a', 'c', 'b'])
})

test('applyRollForward appends overdue tasks after today existing order', () => {
  const today = '2026-07-10'
  const tasks = [
    mkTask({ id: 'today-1', day: today, order: 3 }),
    mkTask({ id: 'old-late', day: '2026-07-09', order: 1, recurOriginDay: '2026-07-09' }),
    mkTask({ id: 'old-early', day: '2026-07-01', order: 0 }),
    mkTask({ id: 'done-old', day: '2026-07-01', order: 1, status: 'done' }),
  ]
  const { tasks: next, changed } = applyRollForward(tasks, today)
  expect(changed.map((t) => t.id)).toEqual(['old-early', 'old-late'])
  const early = next.find((t) => t.id === 'old-early')!
  const late = next.find((t) => t.id === 'old-late')!
  expect(early.day).toBe(today)
  expect(early.order).toBe(4)
  expect(late.order).toBe(5)
  // Occurrence identity never moves with the card.
  expect(late.recurOriginDay).toBe('2026-07-09')
  expect(next.find((t) => t.id === 'done-old')!.day).toBe('2026-07-01')
})

test('applyRollForward is a referential no-op when nothing is overdue', () => {
  const tasks = [mkTask({ day: '2026-07-10' })]
  const res = applyRollForward(tasks, '2026-07-10')
  expect(res.tasks).toBe(tasks)
  expect(res.changed).toEqual([])
})
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/data/selectors.test.ts` → FAIL (functions not exported).

- [ ] **Step 3: Implement** — append to `src/data/selectors.ts`:

```ts
/** Scheduled in the past and not finished. Derived — never stored. */
export function isOverdue(t: Task, todayStr: string): boolean {
  return isScheduled(t.day) && t.day < todayStr && t.status !== 'done'
}

/** Overdue tasks, oldest day first, ties by manual order. */
export function overdueTasks(tasks: Task[], todayStr: string): Task[] {
  return tasks
    .filter((t) => isOverdue(t, todayStr))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.order - b.order))
}

/**
 * Move every overdue task to today, appended after today's existing max order in
 * overdue-sort sequence. Pure; identity (recurOriginDay) never moves with the card.
 * Returns the same array reference when nothing is overdue.
 */
export function applyRollForward(
  tasks: Task[],
  todayStr: string,
): { tasks: Task[]; changed: Task[] } {
  const overdue = overdueTasks(tasks, todayStr)
  if (overdue.length === 0) return { tasks, changed: [] }
  const base =
    tasks.filter((t) => t.day === todayStr).reduce((m, t) => Math.max(m, t.order), -1) + 1
  const orderById = new Map(overdue.map((t, i) => [t.id, base + i]))
  const changed: Task[] = []
  const next = tasks.map((t) => {
    const order = orderById.get(t.id)
    if (order === undefined) return t
    const moved = { ...t, day: todayStr, order }
    changed.push(moved)
    return moved
  })
  return { tasks: next, changed }
}
```

- [ ] **Step 4: Tests + full gate**, then commit:

```bash
git checkout main && git pull --ff-only && git checkout -b feat/overdue-rollforward   # if not already done in step 1
git add src/data/selectors.ts src/data/selectors.test.ts
git commit -m "Derive overdue tasks and the roll-forward reindex as pure selectors

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Create the branch BEFORE writing any code — moved here only so the checkout command appears once.)

### Task C2: `useTasks.rollForward` (batched, echo-marked, rollback)

**Files:**
- Modify: `src/data/useTasks.ts`
- Test: `src/data/useTasks.test.ts` (extend)

**Interfaces:**
- Consumes: `applyRollForward` (C1); the hook's existing `markWrites` / `setTasks` / `taskToRow` plumbing.
- Produces: `UseTasks.rollForward: (todayStr: string) => Promise<void>` — no-op when nothing is overdue; optimistic apply → `markWrites(changed ids)` → single upsert of the changed rows → rollback + `setError` on failure.

- [ ] **Step 1: Write the failing test** — append to `src/data/useTasks.test.ts` (reuses `h`, `serverRow`; the mock's `upsert` is already `vi.fn`):

```ts
test('rollForward moves overdue tasks to today and upserts only them', async () => {
  h.capture.rows = [
    serverRow({ id: 't1', day: '2020-01-01', order_index: 0 }),
    serverRow({ id: 't2', day: '2026-07-10', order_index: 2 }),
  ]
  const { result } = renderHook(() => useTasks('u1'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => {
    await result.current.rollForward('2026-07-10')
  })
  const moved = result.current.tasks.find((t) => t.id === 't1')!
  expect(moved.day).toBe('2026-07-10')
  expect(moved.order).toBe(3)
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/data/useTasks.test.ts` → FAIL (`rollForward` undefined).

- [ ] **Step 3: Implement** — in `src/data/useTasks.ts`:

1. Import `applyRollForward` from `./selectors` (extend the existing selectors import).
2. Add to the `UseTasks` interface (after `persistReorder`):

```ts
  /** Move every overdue task to today, appended to today's order (batched upsert). */
  rollForward: (todayStr: string) => Promise<void>
```

3. Add the callback (next to `persistReorder`):

```ts
  const rollForward = useCallback(
    async (todayStr: string) => {
      const prev = tasksRef.current
      const { tasks: next, changed } = applyRollForward(prev, todayStr)
      if (changed.length === 0) return
      setTasks(next)
      markWrites(changed.map((t) => t.id))
      const { error: err } = await supabase
        .from('tasks')
        .upsert(
          changed.map((t) => taskToRow(t, userId)),
          { onConflict: 'id' },
        )
      if (err) {
        setTasks(prev)
        setError(err.message)
      }
    },
    [setTasks, markWrites, userId],
  )
```

4. Add `rollForward,` to the returned object.

- [ ] **Step 4: Tests + full gate**, then commit:

```bash
git add src/data/useTasks.ts src/data/useTasks.test.ts
git commit -m "Add a batched roll-forward mutation to useTasks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task C3: UI — card accent, Today badge, Agenda Overdue group (TDD)

**Files:**
- Modify: `src/theme/cardStyles.ts` (overdue opt), `src/components/TaskCard.tsx`, `src/components/Toolbar.tsx`, `src/components/AgendaView.tsx`, `src/components/Board.tsx`, `src/pages/BoardPage.tsx`
- Test: `src/theme/theme.test.ts`, `src/components/Toolbar.test.tsx`, `src/components/AgendaView.test.tsx` (new)

**Interfaces:**
- Consumes: `isOverdue`/`overdueTasks` (C1), `rollForward` (C2).
- Produces: `CardStyleOpts.overdue?: boolean` (red inset accent on `wrap`, tinted day chip); `ToolbarProps.overdueCount?: number` (Today button suffix ` (n)`); `AgendaViewProps.onRollForward?: () => void`; `BoardProps.rollForward?: (todayStr: string) => void` (optional so `Board.test.tsx` needs no changes).

- [ ] **Step 1: Write the failing tests**

Append to `src/theme/theme.test.ts` (inside the `cardStyles` describe):

```ts
  it('overdue cards carry the red inset accent and tinted chip', () => {
    const s = cardStyles('cork', task({ day: '2020-01-01' }), 'kanban', { overdue: true })
    expect(String(s.wrap.boxShadow)).toContain('#e0524a')
    expect(String(s.chipStyle.background)).toContain('rgba(224,82,74')
    const plain = cardStyles('cork', task(), 'kanban')
    expect(String(plain.wrap.boxShadow)).not.toContain('#e0524a')
  })
```

Append to `src/components/Toolbar.test.tsx` (reuse its existing render scaffold — pass `showNav={true}` and `navLabel="July 2026"` for this one):

```tsx
test('the Today button shows the overdue count when nonzero', () => {
  renderToolbar({ showNav: true, navLabel: 'July 2026', overdueCount: 3 })
  expect(screen.getByRole('button', { name: 'Today (3)' })).toBeInTheDocument()
})
```

(If the existing test file inlines its render rather than using a helper, extract a `renderToolbar(overrides)` helper as part of this step — same props as the existing test, spread the overrides.)

Create `src/components/AgendaView.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ThemeProvider } from '../theme/ThemeProvider'
import { AgendaView } from './AgendaView'
import { ymd, addDays } from '../lib/dates'
import { NO_RECUR, type Task } from '../types/task'
import type { BoardHandlers } from './boardHandlers'

// Local factory — do NOT import from TaskCard.test.tsx (importing a test file
// registers and re-runs its tests inside this suite too).
function mkTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'T',
    description: '',
    category: 'work',
    color: 'yellow',
    checklist: [],
    status: 'todo',
    done: false,
    day: '2026-07-10',
    order: 0,
    korder: 0,
    atTime: null,
    pinned: false,
    ...NO_RECUR,
    ...over,
  }
}

const handlers: BoardHandlers = {
  onOpen: vi.fn(),
  onToggleDone: vi.fn(),
  onTogglePin: vi.fn(),
  onAddDay: vi.fn(),
  onAddInbox: vi.fn(),
  onAddStatus: vi.fn(),
}

test('overdue tasks appear once, in a top Overdue group with a roll-forward button', async () => {
  const yesterday = ymd(addDays(new Date(), -1))
  const onRollForward = vi.fn()
  render(
    <ThemeProvider>
      <AgendaView
        tasks={[mkTask({ id: 'late', title: 'Late thing', day: yesterday })]}
        handlers={handlers}
        pop={null}
        onRollForward={onRollForward}
      />
    </ThemeProvider>,
  )
  expect(screen.getByText('Overdue')).toBeInTheDocument()
  expect(screen.getAllByText('Late thing')).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Move all to today' }))
  expect(onRollForward).toHaveBeenCalledTimes(1)
})
```


- [ ] **Step 2: Run to verify they fail** — the three targeted files → new tests FAIL.

- [ ] **Step 3: Implement**

1. `cardStyles.ts`:
   - `CardStyleOpts` gains `overdue?: boolean`; destructure `overdue = false`.
   - After the three theme branches (right before the `if (dragging && !isGhost)` line):

```ts
  if (overdue && !isGhost) {
    // Red inset accent — overdue signal, theme-independent.
    wrap.boxShadow = `${wrap.boxShadow}, inset 3px 0 0 0 #e0524a`
  }
```

   - After the `chipStyle` definition:

```ts
  if (overdue) Object.assign(chipStyle, { background: 'rgba(224,82,74,.22)', fontWeight: 800 })
```

2. `TaskCard.tsx`: import `isOverdue` from `../data/selectors` and `ymd` from `../lib/dates`; compute `const overdue = isOverdue(task, ymd(new Date()))` and pass `{ dragging, pop, overdue }` to `cardStyles`.
3. `Toolbar.tsx`: `ToolbarProps` gains `overdueCount?: number` (destructure). BOTH Today buttons (mobile + desktop branches) change their child to:

```tsx
              Today{overdueCount ? ` (${overdueCount})` : ''}
```

4. `AgendaView.tsx`:
   - Props gain `onRollForward?: () => void`.
   - Imports: add `overdueTasks` to the selectors import, `ymd` to the dates import.
   - Replace the two computation lines at the top with:

```ts
  const today = ymd(new Date())
  const overdue = overdueTasks(tasks, today)
  const overdueIds = new Set(overdue.map((t) => t.id))
  const groups = agendaGroups(tasks.filter((t) => !overdueIds.has(t.id)))
  const inbox = notesForDay(tasks, INBOX)
```

   - Change `const empty = groups.length === 0 && inbox.length === 0` to also require `overdue.length === 0`.
   - Insert the Overdue section immediately before `{groups.map((g) => (`:

```tsx
        {overdue.length > 0 && (
          <div>
            <div
              style={{
                ...header,
                borderBottom: '2px solid #e0524a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>Overdue</span>
              {onRollForward && (
                <button
                  type="button"
                  onClick={onRollForward}
                  style={{
                    border: 'none',
                    borderRadius: 7,
                    padding: '4px 10px',
                    cursor: 'pointer',
                    fontFamily: conf.ui,
                    fontSize: 11.5,
                    fontWeight: 800,
                    background: '#e0524a',
                    color: '#fff',
                  }}
                >
                  Move all to today
                </button>
              )}
            </div>
            <div style={list}>
              {overdue.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  variant="inbox"
                  pop={pop === t.id}
                  onOpen={handlers.onOpen}
                  onToggleDone={handlers.onToggleDone}
                  onTogglePin={handlers.onTogglePin}
                />
              ))}
            </div>
          </div>
        )}
```

5. `Board.tsx`: `BoardProps` gains `rollForward?: (todayStr: string) => void` (destructure). Compute below `visibleTasks`:

```ts
  const overdueCount = useMemo(() => overdueTasks(tasks, ymd(new Date())).length, [tasks])
```

(imports: `overdueTasks` from `../data/selectors`, `ymd` added to the dates import). Pass `overdueCount={overdueCount}` to `<Toolbar>` and `onRollForward={rollForward ? () => rollForward(ymd(new Date())) : undefined}` to `<AgendaView>`.
6. `BoardPage.tsx`: pass `rollForward={t.rollForward}` on `<Board>`.

- [ ] **Step 4: Tests + full gate** — all three targeted files PASS; full `npm test` (Board.test unaffected — new props optional), lint, build, per-file prettier.

- [ ] **Step 5: Commit**

```bash
git add src/theme/cardStyles.ts src/theme/theme.test.ts src/components/TaskCard.tsx src/components/Toolbar.tsx src/components/Toolbar.test.tsx src/components/AgendaView.tsx src/components/AgendaView.test.tsx src/components/Board.tsx src/pages/BoardPage.tsx
git commit -m "Surface overdue tasks with an accent, a Today count, and agenda roll-forward

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task C4: CHANGELOG + PR 3

- [ ] **Step 1: CHANGELOG entry** — first bullet under `### Added`:

```markdown
- **Overdue tasks** — unfinished tasks from past days get a red accent, the Today button shows
  their count, and the Agenda pins an Overdue group to the top with one-click "Move all to
  today" (recurring occurrences keep their identity and never regenerate on the old day).
```

- [ ] **Step 2: Full verification, commit, push, PR**

```bash
git add CHANGELOG.md
git commit -m "Add overdue-handling changelog entry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin feat/overdue-rollforward
gh pr create --title "Overdue handling & roll-forward (roadmap 2.3)" --body "$(cat <<'EOF'
Overdue is derived (no schema): red inset accent on cards, count on the Today button, and an Agenda Overdue group with a batched "Move all to today" (appends to today's manual order; recurring instances move by day only — origin identity untouched, so nothing regenerates). Auto roll-forward on load deliberately deferred to the settings toggle (roadmap 4.1).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# Part D — 2.4 Export / import (PR 4)

**Branch only after Parts B (and in practice C) merge.** Client-only JSON backup from Settings → Data: export `{ version: 1, exportedAt, settings, tasks, templates }` in app-domain shape; import validates with hand-rolled guards, remaps every id (preserving template↔instance links), and batch-inserts additively — templates first (FK), chunks of 200. No merge/overwrite semantics; duplicates on re-import are the user's to clean (say so in the UI copy).

### Task D1: Pure module `src/data/exportImport.ts` (TDD)

**Files:**
- Create: `src/data/exportImport.ts`
- Test: `src/data/exportImport.test.ts`

**Interfaces:**
- Produces:

```ts
export const EXPORT_VERSION = 1
export interface ExportSettings { theme: string; defaultView: string }
export interface BoardExport { version: 1; exportedAt: string; settings: ExportSettings; tasks: Task[]; templates: Task[] }
export function serializeExport(tasks: Task[], templates: Task[], settings: ExportSettings, exportedAt: string): string
export type ParseResult = { ok: true; data: BoardExport } | { ok: false; error: string }
export function parseExport(json: string): ParseResult
export function remapIds(data: Pick<BoardExport, 'tasks' | 'templates'>): { tasks: Task[]; templates: Task[] }
export function chunk<T>(arr: T[], size: number): T[][]
```

- [ ] **Step 1: Branch** — `git checkout main && git pull --ff-only && git checkout -b feat/export-import`

- [ ] **Step 2: Write the failing tests**

Create `src/data/exportImport.test.ts`:

```ts
import { expect, test } from 'vitest'
import { NO_RECUR, type Task } from '../types/task'
import { chunk, parseExport, remapIds, serializeExport } from './exportImport'

function mk(over: Partial<Task> = {}): Task {
  return {
    id: 'id-1',
    title: 'T',
    description: '',
    category: 'work',
    color: 'yellow',
    checklist: [],
    status: 'todo',
    done: false,
    day: '2026-07-10',
    order: 0,
    korder: 0,
    atTime: null,
    pinned: false,
    ...NO_RECUR,
    ...over,
  }
}

const template = mk({
  id: 'tpl-1',
  recurFreq: 'daily',
  recurSkip: ['2026-07-11'],
  checklist: [{ id: 'c1', text: 'sub', done: false }],
})
const instance = mk({
  id: 'inst-1',
  recurParentId: 'tpl-1',
  recurOriginDay: '2026-07-10',
  checklist: [{ id: 'c2', text: 'sub', done: true }],
})
const plain = mk({ id: 'plain-1', atTime: '09:30', pinned: true })
const settings = { theme: 'cork', defaultView: 'calendar' }

test('serialize → parse round-trips', () => {
  const json = serializeExport([plain, instance], [template], settings, '2026-07-10T00:00:00Z')
  const parsed = parseExport(json)
  if (!parsed.ok) throw new Error(parsed.error)
  expect(parsed.data.version).toBe(1)
  expect(parsed.data.tasks).toHaveLength(2)
  expect(parsed.data.templates).toHaveLength(1)
  expect(parsed.data.settings).toEqual(settings)
})

test('remapIds freshens every id but preserves series links, skips, and content', () => {
  const { tasks, templates } = remapIds({ tasks: [plain, instance], templates: [template] })
  const [tpl] = templates
  expect(tpl.id).not.toBe('tpl-1')
  expect(tpl.recurSkip).toEqual(['2026-07-11'])
  expect(tpl.checklist[0].id).not.toBe('c1')
  expect(tpl.checklist[0].text).toBe('sub')
  const inst = tasks.find((t) => t.recurParentId)!
  expect(inst.id).not.toBe('inst-1')
  expect(inst.recurParentId).toBe(tpl.id)
  expect(inst.recurOriginDay).toBe('2026-07-10')
  const kept = tasks.find((t) => !t.recurParentId)!
  expect(kept.atTime).toBe('09:30')
  expect(kept.pinned).toBe(true)
})

test('an instance whose template is missing becomes a plain task', () => {
  const { tasks } = remapIds({ tasks: [instance], templates: [] })
  expect(tasks[0].recurParentId).toBeNull()
  expect(tasks[0].recurOriginDay).toBeNull()
})

test('parseExport rejects garbage, wrong versions, and malformed tasks', () => {
  expect(parseExport('not json').ok).toBe(false)
  expect(parseExport('42').ok).toBe(false)
  expect(parseExport(JSON.stringify({ version: 2, tasks: [], templates: [] })).ok).toBe(false)
  const badTask = JSON.parse(serializeExport([plain], [], settings, 'x'))
  badTask.tasks[0].category = 'nonsense'
  expect(parseExport(JSON.stringify(badTask)).ok).toBe(false)
  const templateInTasksList = JSON.stringify({
    version: 1,
    exportedAt: 'x',
    settings,
    tasks: [],
    templates: [plain],
  })
  expect(parseExport(templateInTasksList).ok).toBe(false)
})

test('chunk splits preserving order', () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  expect(chunk([], 2)).toEqual([])
})
```

- [ ] **Step 3: Run to verify they fail** — `npx vitest run src/data/exportImport.test.ts` → FAIL (module missing).

- [ ] **Step 4: Implement** — create `src/data/exportImport.ts`:

```ts
import { isTemplate, type ChecklistItem, type Task } from '../types/task'
import { newId } from '../lib/id'

export const EXPORT_VERSION = 1 as const

export interface ExportSettings {
  theme: string
  defaultView: string
}

/** The on-disk backup shape — app-domain Task objects, never DB rows. */
export interface BoardExport {
  version: typeof EXPORT_VERSION
  exportedAt: string
  settings: ExportSettings
  tasks: Task[]
  templates: Task[]
}

export function serializeExport(
  tasks: Task[],
  templates: Task[],
  settings: ExportSettings,
  exportedAt: string,
): string {
  return JSON.stringify(
    { version: EXPORT_VERSION, exportedAt, settings, tasks, templates },
    null,
    2,
  )
}

const CATEGORIES = ['work', 'personal', 'errands', 'ideas', 'health'] as const
const COLORS = ['yellow', 'pink', 'blue', 'mint', 'lilac', 'orange'] as const
const STATUSES = ['todo', 'doing', 'done'] as const
const FREQS = ['none', 'daily', 'weekly', 'monthly'] as const

function isChecklist(v: unknown): v is ChecklistItem[] {
  return (
    Array.isArray(v) &&
    v.every(
      (c) =>
        !!c &&
        typeof c === 'object' &&
        typeof (c as ChecklistItem).id === 'string' &&
        typeof (c as ChecklistItem).text === 'string' &&
        typeof (c as ChecklistItem).done === 'boolean',
    )
  )
}

function isTask(v: unknown): v is Task {
  if (!v || typeof v !== 'object') return false
  const t = v as Task
  return (
    typeof t.id === 'string' &&
    typeof t.title === 'string' &&
    typeof t.description === 'string' &&
    (CATEGORIES as readonly string[]).includes(t.category) &&
    (COLORS as readonly string[]).includes(t.color) &&
    (STATUSES as readonly string[]).includes(t.status) &&
    typeof t.day === 'string' &&
    typeof t.order === 'number' &&
    typeof t.korder === 'number' &&
    (t.atTime === null || typeof t.atTime === 'string') &&
    typeof t.pinned === 'boolean' &&
    (FREQS as readonly string[]).includes(t.recurFreq) &&
    typeof t.recurInterval === 'number' &&
    (t.recurUntil === null || typeof t.recurUntil === 'string') &&
    (t.recurParentId === null || typeof t.recurParentId === 'string') &&
    Array.isArray(t.recurSkip) &&
    t.recurSkip.every((s) => typeof s === 'string') &&
    (t.recurOriginDay === null || typeof t.recurOriginDay === 'string') &&
    isChecklist(t.checklist)
  )
}

export type ParseResult = { ok: true; data: BoardExport } | { ok: false; error: string }

/** Hand-rolled validation — no schema dependency. Strict on shape; rejects, never repairs. */
export function parseExport(json: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, error: 'Not a valid JSON file.' }
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Not a Magic Agenda export.' }
  const data = raw as BoardExport
  if (data.version !== EXPORT_VERSION)
    return { ok: false, error: 'Unsupported export version — export again from the current app.' }
  if (!Array.isArray(data.tasks) || !Array.isArray(data.templates))
    return { ok: false, error: 'Not a Magic Agenda export.' }
  if ([...data.tasks, ...data.templates].some((t) => !isTask(t)))
    return { ok: false, error: 'The file contains a malformed task.' }
  if (data.templates.some((t) => !isTemplate(t)) || data.tasks.some(isTemplate))
    return { ok: false, error: 'The file mixes up repeating series and tasks.' }
  return { ok: true, data }
}

/**
 * Fresh ids for everything (safe re-import — the DB unique ids never collide),
 * preserving template↔instance links and checklist content. An instance whose
 * template is missing from the file becomes a plain task.
 */
export function remapIds(data: Pick<BoardExport, 'tasks' | 'templates'>): {
  tasks: Task[]
  templates: Task[]
} {
  const templateIdMap = new Map(data.templates.map((t) => [t.id, newId()]))
  const freshChecklist = (list: ChecklistItem[]) => list.map((c) => ({ ...c, id: newId() }))
  const templates = data.templates.map((t) => ({
    ...t,
    id: templateIdMap.get(t.id)!,
    checklist: freshChecklist(t.checklist),
  }))
  const tasks = data.tasks.map((t) => {
    const parent = t.recurParentId ? (templateIdMap.get(t.recurParentId) ?? null) : null
    return {
      ...t,
      id: newId(),
      checklist: freshChecklist(t.checklist),
      recurParentId: parent,
      recurOriginDay: parent ? t.recurOriginDay : null,
    }
  })
  return { tasks, templates }
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
```

- [ ] **Step 5: Tests + full gate**, then commit:

```bash
git add src/data/exportImport.ts src/data/exportImport.test.ts
git commit -m "Add the pure export/import serializer, validator, and id remapper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task D2: Settings "Data" section — export download + additive import (TDD)

**Files:**
- Create: `src/components/DataSection.tsx`
- Modify: `src/pages/SettingsPage.tsx` (SECTIONS registration)
- Test: `src/components/DataSection.test.tsx`

**Interfaces:**
- Consumes: D1's module; `useAuth()`; `rowToTask`/`taskToRow`; `isTemplate`; `SECTIONS` registry.
- Produces: `export function DataSection()` registered as `{ id: 'data', title: 'Data', render: () => <DataSection /> }` between the appearance and danger sections.

- [ ] **Step 1: Write the failing test**

Create `src/components/DataSection.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { serializeExport } from '../data/exportImport'
import { NO_RECUR, type Task } from '../types/task'

const h = vi.hoisted(() => {
  const inserted: unknown[][] = []
  return {
    inserted,
    selectTasks: vi.fn(() => Promise.resolve({ data: [], error: null })),
    maybeSingle: vi.fn(() =>
      Promise.resolve({ data: { theme: 'cork', default_view: 'calendar' }, error: null }),
    ),
    insert: vi.fn((rows: unknown[]) => {
      inserted.push(rows)
      return Promise.resolve({ error: null })
    }),
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) =>
      table === 'tasks'
        ? { select: h.selectTasks, insert: h.insert }
        : { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: h.maybeSingle })) })) },
    ),
  },
}))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}))

import { DataSection } from './DataSection'

function mk(over: Partial<Task> = {}): Task {
  return {
    id: 'id-1',
    title: 'T',
    description: '',
    category: 'work',
    color: 'yellow',
    checklist: [],
    status: 'todo',
    done: false,
    day: '2026-07-10',
    order: 0,
    korder: 0,
    atTime: null,
    pinned: false,
    ...NO_RECUR,
    ...over,
  }
}

beforeEach(() => {
  h.inserted.length = 0
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:test'),
    revokeObjectURL: vi.fn(),
  })
})
afterEach(() => vi.unstubAllGlobals())

function importFile(json: string) {
  const input = screen.getByLabelText('Import file') as HTMLInputElement
  const file = new File([json], 'export.json', { type: 'application/json' })
  fireEvent.change(input, { target: { files: [file] } })
}

test('a valid file shows a summary; confirming inserts templates before instances', async () => {
  render(<DataSection />)
  const template = mk({ id: 'tpl-1', recurFreq: 'daily' })
  const instance = mk({ id: 'inst-1', recurParentId: 'tpl-1', recurOriginDay: '2026-07-10' })
  importFile(
    serializeExport([instance], [template], { theme: 'cork', defaultView: 'calendar' }, 'x'),
  )

  await screen.findByText(/1 task.*1 repeating series/i)
  await userEvent.click(screen.getByRole('button', { name: 'Import' }))
  await waitFor(() => expect(h.inserted.length).toBe(2))

  const [firstBatch, secondBatch] = h.inserted as {
    recur_freq: string
    recur_parent_id: string | null
    id: string
  }[][]
  expect(firstBatch[0].recur_freq).toBe('daily') // templates first (FK)
  expect(secondBatch[0].recur_parent_id).toBe(firstBatch[0].id) // link preserved
  expect(firstBatch[0].id).not.toBe('tpl-1') // fresh ids
})

test('an invalid file surfaces the validator error and inserts nothing', async () => {
  render(<DataSection />)
  importFile('{"version": 99}')
  await screen.findByText(/Unsupported export version/)
  expect(h.inserted.length).toBe(0)
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/components/DataSection.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Implement**

Create `src/components/DataSection.tsx`:

```tsx
import { useRef, useState, type CSSProperties } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { rowToTask, taskToRow } from '../data/mappers'
import {
  chunk,
  parseExport,
  remapIds,
  serializeExport,
  type BoardExport,
} from '../data/exportImport'
import { isTemplate } from '../types/task'
import { ymd } from '../lib/dates'

const INSERT_CHUNK = 200

/** Settings → Data: JSON export (download) and additive import (fresh ids, FK-safe order). */
export function DataSection() {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<BoardExport | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const btn: CSSProperties = {
    alignSelf: 'flex-start',
    padding: '9px 14px',
    borderRadius: 8,
    border: '1px solid currentColor',
    background: 'transparent',
    color: 'inherit',
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
    opacity: busy ? 0.6 : 1,
  }

  const exportBoard = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    const [tasksRes, settingsRes] = await Promise.all([
      supabase.from('tasks').select('*'),
      supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle(),
    ])
    setBusy(false)
    if (tasksRes.error || settingsRes.error) {
      setError('Could not load your data. Please try again.')
      return
    }
    const all = (tasksRes.data ?? []).map(rowToTask)
    const json = serializeExport(
      all.filter((t) => !isTemplate(t)),
      all.filter(isTemplate),
      {
        theme: settingsRes.data?.theme ?? 'cork',
        defaultView: settingsRes.data?.default_view ?? 'calendar',
      },
      new Date().toISOString(),
    )
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `magic-agenda-export-${ymd(new Date())}.json`
    a.click()
    URL.revokeObjectURL(url)
    setNotice('Export downloaded.')
  }

  const onFile = async (file: File | undefined) => {
    setError(null)
    setNotice(null)
    setPending(null)
    if (!file) return
    const parsed = parseExport(await file.text())
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setPending(parsed.data)
  }

  const confirmImport = async () => {
    if (!pending) return
    setBusy(true)
    setError(null)
    const { tasks, templates } = remapIds(pending)
    // Templates first: instances reference them by foreign key.
    for (const batch of [...chunk(templates, INSERT_CHUNK), ...chunk(tasks, INSERT_CHUNK)]) {
      const { error: err } = await supabase
        .from('tasks')
        .insert(batch.map((t) => taskToRow(t, userId)))
      if (err) {
        setBusy(false)
        setError('Import failed partway — some tasks may have been added; nothing was overwritten.')
        return
      }
    }
    setBusy(false)
    setPending(null)
    setNotice(
      `Imported ${tasks.length} tasks and ${templates.length} repeating series. Open the board to see them.`,
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 460 }}>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
        Download everything (tasks, repeating series, settings) as a JSON file, or import a
        previous export. Import is additive — nothing is overwritten, and importing the same
        file twice creates duplicates.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" disabled={busy} onClick={exportBoard} style={btn}>
          Export my data
        </button>
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} style={btn}>
          Import from file…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          aria-label="Import file"
          style={{ display: 'none' }}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>
      {pending && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5 }}>
          <div>
            This file contains {pending.tasks.length} task
            {pending.tasks.length === 1 ? '' : 's'} and {pending.templates.length} repeating
            series. Import them?
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" disabled={busy} onClick={confirmImport} style={btn}>
              Import
            </button>
            <button type="button" disabled={busy} onClick={() => setPending(null)} style={btn}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {notice && <div style={{ color: '#3f9d63', fontSize: 13 }}>{notice}</div>}
      {error && <div style={{ color: '#b42318', fontSize: 13 }}>{error}</div>}
    </div>
  )
}
```

Register in `src/pages/SettingsPage.tsx`: import `DataSection` and insert into `SECTIONS` between 'appearance' and 'danger':

```tsx
  { id: 'data', title: 'Data', render: () => <DataSection /> },
```

- [ ] **Step 4: Tests + full gate** — DataSection 2/2 + SettingsPage.test still green (its mock never clicks these buttons); full gate + per-file prettier.

- [ ] **Step 5: Commit**

```bash
git add src/components/DataSection.tsx src/components/DataSection.test.tsx src/pages/SettingsPage.tsx
git commit -m "Add JSON export and additive import to settings

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task D3: CHANGELOG + PR 4

- [ ] **Step 1: CHANGELOG entry** — first bullet under `### Added`:

```markdown
- **Export & import** — download the whole board (tasks, repeating series, settings) as JSON
  from Settings → Data, and import a previous export additively: fresh ids, series links
  preserved, nothing overwritten.
```

- [ ] **Step 2: Full verification, commit, push, PR**

```bash
git add CHANGELOG.md
git commit -m "Add export/import changelog entry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin feat/export-import
gh pr create --title "Export / import (roadmap 2.4)" --body "$(cat <<'EOF'
Client-only JSON backup: export from Settings → Data (app-domain shape, version 1), import with hand-rolled validation, full id remapping (template↔instance links preserved; orphan instances become plain tasks), templates-first chunked inserts (FK-safe, 200/batch). Additive only — duplicates on re-import are documented in the UI copy. A board open in another tab picks the imported tasks up live via realtime.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Post-merge wrap

1. **After Part B merges** (both schema changes applied to prod): run
   `npx supabase gen types typescript --linked > src/types/database.types.ts` and `git diff` —
   expect no semantic difference vs the hand-edits. If there is drift, land a tiny follow-up PR
   with the regenerated file.
2. **Manual smoke checks for Jerry** (put in the PR bodies' post-merge notes as they land):
   due time on a recurring series propagates to occurrences; cork pins only on pinned notes
   across a realtime sync; Agenda roll-forward with a recurring instance doesn't resurrect it
   on the old day after reload; export → delete a task → import restores it (as a duplicate id).
3. **Prune ROADMAP.md** (Phase 2 section + table rows) via a docs PR once all four parts merge.

## Self-review checklist (completed by the plan author)

- Spec coverage: 2.1 → Part A (schema, mapper normalization, editor, chip, agenda sort, template→instance copy); 2.2 → Part B (schema, per-theme visuals incl. the cork semantics change, editor + card toggles, quick filter, no-forced-sort decision); 2.3 → Part C (derived selector, accent, badge, agenda group, batched `rollForward` with origin-day safety, auto-roll deferred); 2.4 → Part D (versioned export, hand-rolled validation, id remapping, FK-safe chunked additive import).
- Type consistency: `Task.atTime: string | null` / `Task.pinned: boolean` used identically across A/B/C/D; `CardStyleOpts.overdue` (C) matches TaskCard's call; `BoardHandlers.onTogglePin` (B3) is what C3's AgendaView test constructs; `rollForward(todayStr)` signature identical in useTasks/Board/BoardPage; D's `BoardExport` fields match `serializeExport`'s object literal.
- Known deliberate decisions restated where a reviewer might trip: cork's decorative pin removal (B2), Agenda-only time sorting (A2), pin-never-sorts (B), per-occurrence pinning (B1), instance roll-forward via mutable `day` only (C1), strict validator + additive-only import (D1/D2).
