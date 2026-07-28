# Settings: week-start & timezone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pick which weekday their week starts on and store an IANA timezone that defines "today" for their board, completing the settings page and unblocking roadmap item 3.2 (reminders).

**Architecture:** Pure functions first (`src/lib/dates.ts`, `src/data/selectors.ts`) gain optional parameters that default to today's behavior, so nothing breaks while they land. Two new `user_settings` columns flow through `useSettings`. Then "today" is distributed by a React context (`useToday()`) because `TaskCard` is four levels deep, while `weekStart` is passed as a prop because it only travels two — that split is deliberate and is documented in the spec.

**Tech Stack:** React 19 + TypeScript (strict), Vite, Vitest + Testing Library, Supabase (Postgres + RLS), inline style objects (no CSS-in-JS, no CSS modules).

**Spec:** `docs/superpowers/specs/2026-07-28-settings-week-start-timezone-design.md`

## Global Constraints

- **Branch:** `feat/settings-week-start-timezone` (already created off `main`). `main` is PR-only; never push to it directly.
- **Target release version: `1.2.36`** — confirmed via `node scripts/next-version.mjs`. `CHANGELOG.md` must gain a `## [1.2.36]` section or the required `Changelog` CI job fails.
- **App↔DB boundary:** `'inbox'` ↔ `NULL`, `order` ↔ `order_index`, `done` derived — all conversions stay in `src/data/mappers.ts`. This feature touches `user_settings` only, so `mappers.ts` is not modified.
- **RLS is the only authorization boundary.** New columns inherit the existing owner-only policies on `user_settings`; no policy changes.
- **Realtime:** `user_settings` is in the `supabase_realtime` publication. Neither new column may be a primary key (they aren't). The `postgres_changes` handler must carry both new fields.
- **Test-first** for everything in `src/lib` and `src/data`.
- **Inline style objects only.** Do not add CSS files or CSS variables for this feature.
- **Mobile:** any new form control uses `fontSize: 16` or larger (smaller triggers iOS Safari's focus zoom).
- **`noUnusedLocals` is on** — a leftover unused import fails `npm run build`.
- Verification commands: `npx vitest run <file>` (single file), `npm test`, `npm run lint`, `npm run format:check`, `npx tsc -b`.

---

## File Structure

**Created**

| File                                                                  | Responsibility                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `supabase/migrations/20260728120000_settings_week_start_timezone.sql` | Adds `week_start` + `timezone` to `user_settings`.                        |
| `src/data/todayContext.ts`                                            | The `TodayContext` + `useToday()` hook. Hook-only module (no component).  |
| `src/data/TodayProvider.tsx`                                          | Reads settings, computes today in the stored zone, ticks across midnight. |
| `src/data/TodayProvider.test.tsx`                                     | Provider tests.                                                           |
| `src/components/DatesSection.tsx`                                     | The `/settings` "Dates" section: two selects.                             |
| `src/components/DatesSection.test.tsx`                                | Section tests.                                                            |

**Modified**

| File                                        | Change                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/lib/dates.ts`                          | `todayYmd`, `weekdayLabels`, `browserTimezone`, `supportedTimezones`; `startOfWeek` gains `weekStart`. |
| `src/lib/dates.test.ts`                     | Tests for all of the above.                                                                            |
| `src/data/selectors.ts`                     | `buildMonthGrid` gains `weekStart`; `CellMeta` gains `dow`.                                            |
| `src/data/selectors.test.ts`                | Monday-start padding, rotated headers, `dow`.                                                          |
| `src/types/database.types.ts`               | Regenerated.                                                                                           |
| `src/data/useSettings.ts`                   | `Settings` gains two fields; read / write / realtime / two new savers.                                 |
| `src/data/useSettings.test.ts`              | Round-trip + realtime coverage.                                                                        |
| `src/data/snapshot.ts`                      | `V` 1 → 2.                                                                                             |
| `src/App.tsx`                               | Mount `<TodayProvider>` inside `<SettingsProvider>`.                                                   |
| `src/components/TaskCard.tsx`               | `useToday()`.                                                                                          |
| `src/components/AgendaView.tsx`             | `useToday()`.                                                                                          |
| `src/components/CalendarView.tsx`           | `useToday()`; new `weekStart` prop.                                                                    |
| `src/components/WeekView.tsx`               | Headers read `meta.dow`, not the positional index.                                                     |
| `src/components/Board.tsx`                  | `useToday()`; anchors use `parseDay(today)`; new `weekStart` prop.                                     |
| `src/components/Board.test.tsx`             | Anchor test.                                                                                           |
| `src/pages/BoardPage.tsx`                   | Passes `weekStart={settings.weekStart}`.                                                               |
| `src/pages/SettingsPage.tsx`                | Registers the Dates section.                                                                           |
| `AGENTS.md` / `ROADMAP.md` / `CHANGELOG.md` | Docs.                                                                                                  |

---

### Task 1: Pure date & timezone core

No consumer changes — every new parameter defaults to today's behavior, so the suite stays green.

**Files:**

- Modify: `src/lib/dates.ts`
- Test: `src/lib/dates.test.ts`

**Interfaces:**

- Consumes: existing `ymd(d: Date): string`, `addDays(base: Date, n: number): Date`, `WEEKDAYS_SHORT: string[]` from this same file.
- Produces:
  - `todayYmd(tz?: string | null): string`
  - `startOfWeek(base: Date, weekStart?: number): Date` — signature widened, default `0`
  - `weekdayLabels(weekStart?: number): string[]`
  - `browserTimezone(): string`
  - `supportedTimezones(): string[]`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/dates.test.ts`. Note the import line at the top of that file currently reads
`import { formatTime } from './dates'` — replace it with the one below.

```ts
import { expect, test, vi } from 'vitest'
import {
  formatTime,
  todayYmd,
  ymd,
  startOfWeek,
  weekdayLabels,
  browserTimezone,
  supportedTimezones,
} from './dates'

test('todayYmd resolves the calendar date in the given zone', () => {
  vi.useFakeTimers()
  // One instant that is two different calendar dates: UTC+14 has already rolled over, UTC-11
  // has not. This is the whole point of storing a zone, so it is the case worth pinning.
  vi.setSystemTime(new Date('2026-07-28T11:30:00Z'))
  expect(todayYmd('Pacific/Kiritimati')).toBe('2026-07-29')
  expect(todayYmd('Pacific/Niue')).toBe('2026-07-28')
  vi.useRealTimers()
})

test('todayYmd falls back to browser-local for a nullish or unknown zone', () => {
  const local = ymd(new Date())
  expect(todayYmd()).toBe(local)
  expect(todayYmd(null)).toBe(local)
  // A stale zone from another device, or a hand-edited row, must not throw and blank the board.
  expect(todayYmd('Not/AZone')).toBe(local)
})

test('todayYmd is unaffected by a non-Gregorian ambient locale', () => {
  // Guards the explicit 'en-US-u-ca-gregory' locale: under a Thai ambient locale a
  // locale-less formatter would yield a Buddhist-era year (2569), silently breaking
  // every string comparison against a 'YYYY-MM-DD' day.
  const spy = vi.spyOn(Intl, 'DateTimeFormat')
  expect(todayYmd('UTC')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(spy.mock.calls[0][0]).toBe('en-US-u-ca-gregory')
  spy.mockRestore()
})

test('startOfWeek honours the configured first day', () => {
  const tue = new Date(2026, 6, 28) // Tuesday 2026-07-28
  expect(ymd(startOfWeek(tue))).toBe('2026-07-26') // default: Sunday
  expect(ymd(startOfWeek(tue, 0))).toBe('2026-07-26')
  expect(ymd(startOfWeek(tue, 1))).toBe('2026-07-27') // Monday
  expect(ymd(startOfWeek(tue, 6))).toBe('2026-07-25') // Saturday
})

test('startOfWeek crosses a month boundary', () => {
  const sun = new Date(2026, 7, 2) // Sunday 2026-08-02
  expect(ymd(startOfWeek(sun, 1))).toBe('2026-07-27')
})

test('weekdayLabels rotate to the configured first day', () => {
  expect(weekdayLabels()).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
  expect(weekdayLabels(1)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
  expect(weekdayLabels(6)).toEqual(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
})

test('browserTimezone returns a usable IANA id', () => {
  expect(todayYmd(browserTimezone())).toBe(ymd(new Date()))
})

test('supportedTimezones falls back when the engine lacks Intl.supportedValuesOf', () => {
  const full = supportedTimezones()
  expect(full).toContain('UTC')
  expect(full.length).toBeGreaterThan(20)

  const intl = Intl as { supportedValuesOf?: unknown }
  const original = intl.supportedValuesOf
  delete intl.supportedValuesOf
  try {
    const fallback = supportedTimezones()
    expect(fallback).toContain('America/Chicago')
    expect(fallback.length).toBeGreaterThan(20)
  } finally {
    if (original !== undefined) intl.supportedValuesOf = original
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: FAIL — `todayYmd is not a function` (and the same for `weekdayLabels`, `browserTimezone`, `supportedTimezones`).

- [ ] **Step 3: Implement**

In `src/lib/dates.ts`, **replace** the existing `startOfWeek`:

```ts
/** The first day of the week containing `base`. `weekStart` is 0=Sunday … 6=Saturday. */
export function startOfWeek(base: Date, weekStart = 0): Date {
  return addDays(base, -((base.getDay() - weekStart + 7) % 7))
}
```

Then append:

```ts
/** `WEEKDAYS_SHORT` rotated so index 0 is the configured first day of the week. */
export function weekdayLabels(weekStart = 0): string[] {
  return Array.from({ length: 7 }, (_, i) => WEEKDAYS_SHORT[(weekStart + i) % 7])
}

/**
 * Today as 'YYYY-MM-DD' in `tz` (an IANA id); a nullish `tz` means the browser's own zone.
 *
 * The locale is pinned to 'en-US-u-ca-gregory' rather than left to the ambient one: a
 * locale-less formatter under, say, a Thai locale yields a Buddhist-era year, which would
 * silently break every comparison against a stored `day`. `formatToParts` rather than the
 * 'en-CA' → 'YYYY-MM-DD' trick, which is a locale-data coincidence, not a guarantee.
 */
export function todayYmd(tz?: string | null): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
      ...(tz ? { timeZone: tz } : {}),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
    const y = get('year')
    const m = get('month')
    const d = get('day')
    if (!y || !m || !d) return ymd(new Date())
    return `${y}-${m}-${d}`
  } catch {
    // An unknown zone (a stale value synced from another device, a hand-edited row) throws
    // RangeError. Browser-local is the honest fallback, and never throwing keeps the board up.
    return ymd(new Date())
  }
}

/** The browser's own IANA zone, for the settings picker's "Automatic (…)" label. */
export function browserTimezone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

// Only for engines without `Intl.supportedValuesOf` (pre-2022). Deliberately not exhaustive:
// it just has to keep the picker usable, and `todayYmd` accepts any zone the engine knows.
const FALLBACK_TIMEZONES = [
  'UTC',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
  'America/Anchorage',
  'America/Argentina/Buenos_Aires',
  'America/Bogota',
  'America/Chicago',
  'America/Denver',
  'America/Halifax',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/New_York',
  'America/Phoenix',
  'America/Sao_Paulo',
  'America/Toronto',
  'Asia/Dubai',
  'Asia/Hong_Kong',
  'Asia/Jakarta',
  'Asia/Jerusalem',
  'Asia/Kolkata',
  'Asia/Manila',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Melbourne',
  'Australia/Perth',
  'Australia/Sydney',
  'Europe/Amsterdam',
  'Europe/Berlin',
  'Europe/Dublin',
  'Europe/Istanbul',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Moscow',
  'Europe/Paris',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Zurich',
  'Pacific/Auckland',
  'Pacific/Honolulu',
]

/**
 * Every IANA zone the engine knows, else a curated fallback.
 *
 * `Intl.supportedValuesOf` is only *typed* from `lib.es2022.intl` and `tsconfig.app.json` sets
 * `lib: ["ES2020", …]`. The cast is not a workaround for that — the runtime feature-detect is
 * needed for the fallback regardless, so do not "fix" this by widening `lib`.
 */
export function supportedTimezones(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: 'timeZone') => string[] })
    .supportedValuesOf
  if (typeof supported !== 'function') return FALLBACK_TIMEZONES
  try {
    const zones = supported.call(Intl, 'timeZone')
    const result = zones.length > 0 ? zones : FALLBACK_TIMEZONES
    // `supportedValuesOf` returns canonical IANA zones, which include 'Etc/UTC' but not bare
    // 'UTC' — yet 'UTC' is what a user scans the picker for, and `todayYmd('UTC')` accepts it.
    if (!result.includes('UTC')) return ['UTC', ...result]
    return result
  } catch {
    return FALLBACK_TIMEZONES
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Verify nothing else regressed**

Run: `npm test`
Expected: PASS. `startOfWeek`'s default argument means every existing caller is unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dates.ts src/lib/dates.test.ts
git commit -m "feat(dates): timezone-aware todayYmd and configurable week start"
```

---

### Task 2: `buildMonthGrid` week start + `CellMeta.dow`

**Files:**

- Modify: `src/data/selectors.ts`, `src/components/WeekView.tsx:42`, `src/components/WeekView.tsx:64`
- Test: `src/data/selectors.test.ts`

**Interfaces:**

- Consumes: `weekdayLabels(weekStart?: number): string[]` from Task 1.
- Produces:
  - `CellMeta` gains `dow: number` (0=Sunday … 6=Saturday, the cell's real weekday).
  - `buildMonthGrid(viewY: number, viewM: number, todayStr: string, weekStart?: number): MonthGrid`
  - `buildWeekCells(weekStart: Date, todayStr: string): CellMeta[]` — signature **unchanged**, cells now carry `dow`.

- [ ] **Step 1: Write the failing tests**

Append to `src/data/selectors.test.ts`:

```ts
describe('buildMonthGrid week start', () => {
  // March 2026 begins on a Sunday — the sharp case. Sunday-start needs zero leading padding;
  // Monday-start needs a full six days of it. An off-by-one here silently shifts every task.
  it('pads from the configured first day', () => {
    const sun = buildMonthGrid(2026, 2, '2026-03-15')
    expect(sun.cells[0].dateStr).toBe('2026-03-01')

    const mon = buildMonthGrid(2026, 2, '2026-03-15', 1)
    expect(mon.cells[0].dateStr).toBe('2026-02-23')
    expect(mon.cells[6].dateStr).toBe('2026-03-01')

    const sat = buildMonthGrid(2026, 2, '2026-03-15', 6)
    expect(sat.cells[0].dateStr).toBe('2026-02-28')
  })

  it('rotates the weekday headers and always returns 42 cells', () => {
    expect(buildMonthGrid(2026, 2, '2026-03-15').weekdays[0]).toBe('Sun')
    expect(buildMonthGrid(2026, 2, '2026-03-15', 1).weekdays).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ])
    expect(buildMonthGrid(2026, 2, '2026-03-15', 1).cells).toHaveLength(42)
    expect(buildMonthGrid(2026, 2, '2026-03-15', 6).cells).toHaveLength(42)
  })

  it('keeps weekend shading on the real Sat/Sun regardless of week start', () => {
    const mon = buildMonthGrid(2026, 2, '2026-03-15', 1)
    // Monday-start: positions 5 and 6 of each row are Sat and Sun.
    expect(mon.cells[5].isWeekend).toBe(true)
    expect(mon.cells[6].isWeekend).toBe(true)
    expect(mon.cells[0].isWeekend).toBe(false)
  })
})

describe('CellMeta.dow', () => {
  it('carries the real weekday so views can label a rotated week', () => {
    const mon = buildMonthGrid(2026, 2, '2026-03-15', 1)
    expect(mon.cells[0].dow).toBe(1) // 2026-02-23 is a Monday
    expect(mon.cells[6].dow).toBe(0) // 2026-03-01 is a Sunday

    const week = buildWeekCells(new Date(2026, 6, 27), '2026-07-28') // Monday 2026-07-27
    expect(week.map((c) => c.dow)).toEqual([1, 2, 3, 4, 5, 6, 0])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/data/selectors.test.ts`
Expected: FAIL — `buildMonthGrid` ignores the 4th argument (`cells[0].dateStr` is `'2026-03-01'`, not `'2026-02-23'`), and `dow` is `undefined`.

- [ ] **Step 3: Implement**

In `src/data/selectors.ts`, update the import on line 2:

```ts
import { addDays, isScheduled, ymd, weekdayLabels } from '../lib/dates'
```

(`WEEKDAYS_SHORT` is no longer referenced here — leaving it imported fails `noUnusedLocals`.)

Add `dow` to the interface:

```ts
export interface CellMeta {
  dateStr: string
  dayNum: number
  /** The cell's real weekday, 0=Sunday. Lets a view label a rotated week without knowing weekStart. */
  dow: number
  inMonth: boolean
  isToday: boolean
  isWeekend: boolean
}
```

Replace `buildMonthGrid` and `buildWeekCells`:

```ts
/**
 * The 42-cell (7×6) month grid metadata, starting on the `weekStart` weekday of the week
 * containing the 1st. Ported from the prototype's `buildCells` (data half only).
 */
export function buildMonthGrid(
  viewY: number,
  viewM: number,
  todayStr: string,
  weekStart = 0,
): MonthGrid {
  const first = new Date(viewY, viewM, 1)
  const start = addDays(first, -((first.getDay() - weekStart + 7) % 7))
  const cells: CellMeta[] = []
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i)
    const ds = ymd(d)
    const dow = d.getDay()
    cells.push({
      dateStr: ds,
      dayNum: d.getDate(),
      dow,
      inMonth: d.getMonth() === viewM,
      isToday: ds === todayStr,
      // Weekend is absolute Sat/Sun — it does not rotate with the configured week start.
      isWeekend: dow === 0 || dow === 6,
    })
  }
  return { weekdays: weekdayLabels(weekStart), cells }
}

/** The 7 cells of the week starting at `weekStart` (a date — the caller already applied the offset). */
export function buildWeekCells(weekStart: Date, todayStr: string): CellMeta[] {
  const cells: CellMeta[] = []
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i)
    const ds = ymd(d)
    const dow = d.getDay()
    cells.push({
      dateStr: ds,
      dayNum: d.getDate(),
      dow,
      inMonth: true,
      isToday: ds === todayStr,
      isWeekend: dow === 0 || dow === 6,
    })
  }
  return cells
}
```

- [ ] **Step 4: Fix `WeekView`'s positional headers**

`WeekView` indexes `WEEKDAYS_SHORT[i]` by grid **position**, which is only correct for a Sunday-start
week. With `dow` on the cell it reads the real weekday and never needs to know `weekStart`.

In `src/components/WeekView.tsx` line 42 (the mobile branch):

```tsx
<div style={wd}>
  {WEEKDAYS_SHORT[meta.dow]} {meta.dayNum}
</div>
```

and line 64 (the desktop branch):

```tsx
<div key={meta.dateStr} style={wd}>
  {WEEKDAYS_SHORT[meta.dow]} {meta.dayNum}
</div>
```

Both `.map()` callbacks now ignore their index parameter, so change `(meta, i) =>` to `(meta) =>` in
both — `noUnusedParameters` is on.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/data/selectors.test.ts && npm test`
Expected: PASS. Existing Sunday-start assertions stay green via the default argument.

- [ ] **Step 6: Commit**

```bash
git add src/data/selectors.ts src/data/selectors.test.ts src/components/WeekView.tsx
git commit -m "feat(selectors): week-start aware month grid, real weekday on each cell"
```

---

### Task 3: Schema migration + regenerated types

> **This task writes to the production database.** `npx supabase db push` applies to the linked
> project, which is production. The change is purely additive (a defaulted column and a nullable
> one), so the currently-deployed app keeps working untouched — but **get Jerry's explicit
> go-ahead before running Step 2.** Never run `supabase config push` here; that is a different
> command and is forbidden outside CI.

**Files:**

- Create: `supabase/migrations/20260728120000_settings_week_start_timezone.sql`
- Modify: `src/types/database.types.ts` (regenerated, never hand-edited)

**Interfaces:**

- Produces: `Database['public']['Tables']['user_settings']['Row']` gains `week_start: number` and `timezone: string | null`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260728120000_settings_week_start_timezone.sql`:

```sql
-- Week start + timezone for the settings page (roadmap 4.1).
--
-- `timezone` is an IANA id; NULL means "follow whatever browser the user is on", which is the
-- behavior every existing row already has. Item 3.2's server-side reminder sender cannot read
-- NULL as "browser" — it has no browser — so that flow will have to prompt for a concrete zone.
--
-- No CHECK on `timezone`: a CHECK constraint cannot reference `pg_timezone_names`, and a bad
-- value only ever affects its own owner, where the client falls back to browser-local.
--
-- `user_settings` is in the `supabase_realtime` publication. Neither column is part of the
-- primary key, so the standing "no secrets in a replicated PK" rule is unaffected.
alter table public.user_settings
  add column if not exists week_start int not null default 0,
  add column if not exists timezone text;

alter table public.user_settings
  drop constraint if exists user_settings_week_start_range;

alter table public.user_settings
  add constraint user_settings_week_start_range check (week_start between 0 and 6);
```

- [ ] **Step 2: Apply it (production — confirm first)**

Run: `npx supabase db push`
Expected: the CLI lists `20260728120000_settings_week_start_timezone.sql` as pending and applies it.

- [ ] **Step 3: Regenerate the types**

Run: `npx supabase gen types typescript --linked > src/types/database.types.ts`
Expected: the `user_settings` `Row` / `Insert` / `Update` blocks now include `week_start` and `timezone`.

- [ ] **Step 4: Verify the types compile and nothing drifted**

Run: `npx tsc -b && git diff --stat src/types/database.types.ts`
Expected: clean typecheck; the diff touches only the `user_settings` blocks.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260728120000_settings_week_start_timezone.sql src/types/database.types.ts
git commit -m "feat(db): add user_settings.week_start and .timezone"
```

---

### Task 4: Settings shape, persistence, realtime, snapshot

**Files:**

- Modify: `src/data/useSettings.ts`, `src/data/snapshot.ts:12`
- Test: `src/data/useSettings.test.ts`

**Interfaces:**

- Consumes: the regenerated `user_settings` row type from Task 3.
- Produces:
  - `Settings` = `{ theme: ThemeName; defaultView: ViewName; weekStart: number; timezone: string | null }`
  - `UseSettings` gains `saveWeekStart: (weekStart: number) => void` and `saveTimezone: (timezone: string | null) => void`
  - Snapshot envelope version `V = 2`

- [ ] **Step 1: Write the failing tests**

Append to `src/data/useSettings.test.ts`. It needs `act` and `waitFor`, both already imported there.

```ts
test('saveWeekStart and saveTimezone persist to the new columns', async () => {
  const { result } = renderHook(() => useSettings('user-1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    result.current.saveWeekStart(1)
  })
  expect(h.upsert).toHaveBeenLastCalledWith(
    expect.objectContaining({ user_id: 'user-1', week_start: 1 }),
    { onConflict: 'user_id' },
  )

  act(() => {
    result.current.saveTimezone('Europe/London')
  })
  // The second save must carry the first one forward — both come off the same `ref.current`.
  expect(h.upsert).toHaveBeenLastCalledWith(
    expect.objectContaining({ user_id: 'user-1', week_start: 1, timezone: 'Europe/London' }),
    { onConflict: 'user_id' },
  )
  expect(result.current.settings).toMatchObject({ weekStart: 1, timezone: 'Europe/London' })
})

test('a row missing the new columns loads as the defaults', async () => {
  // The deploy window: the Pages build can be live for a moment before the migration lands.
  h.capture.result = { data: { theme: 'brutal', default_view: 'week' }, error: null }
  const { result } = renderHook(() => useSettings('user-1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.settings).toEqual({
    theme: 'brutal',
    defaultView: 'week',
    weekStart: 0,
    timezone: null,
  })
})

test('a realtime change carries week start and timezone to other devices', async () => {
  const { result } = renderHook(() => useSettings('user-1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    h.capture.handler?.({
      new: {
        theme: 'cork',
        default_view: 'calendar',
        week_start: 6,
        timezone: 'Asia/Tokyo',
      },
    })
  })
  expect(result.current.settings).toMatchObject({ weekStart: 6, timezone: 'Asia/Tokyo' })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/data/useSettings.test.ts`
Expected: FAIL — `result.current.saveWeekStart is not a function`.

- [ ] **Step 3: Implement in `src/data/useSettings.ts`**

Widen the interfaces and defaults:

```ts
export interface Settings {
  theme: ThemeName
  defaultView: ViewName
  /** 0=Sunday … 6=Saturday. */
  weekStart: number
  /** IANA id; null means "follow the browser". */
  timezone: string | null
}

const DEFAULTS: Settings = {
  theme: 'cork',
  defaultView: 'calendar',
  weekStart: 0,
  timezone: null,
}

export interface UseSettings {
  settings: Settings | null
  loading: boolean
  saveTheme: (theme: ThemeName) => void
  saveView: (view: ViewName) => void
  saveWeekStart: (weekStart: number) => void
  saveTimezone: (timezone: string | null) => void
}
```

In the load effect, replace the `apply(data ? … : DEFAULTS, hasSession)` call:

```ts
apply(
  data
    ? {
        theme: data.theme as ThemeName,
        defaultView: data.default_view as ViewName,
        // `??` rather than a plain read: during the deploy window between the migration
        // and the Pages build, a row can come back without these columns at all.
        weekStart: data.week_start ?? 0,
        timezone: data.timezone ?? null,
      }
    : DEFAULTS,
  hasSession,
)
```

In the realtime handler, replace the body from `const row =` through `apply(next)`:

```ts
const row = payload.new as {
  theme?: string
  default_view?: string
  week_start?: number
  timezone?: string | null
} | null
if (!row?.theme || !row.default_view) return
const next: Settings = {
  theme: row.theme as ThemeName,
  defaultView: row.default_view as ViewName,
  weekStart: row.week_start ?? 0,
  timezone: row.timezone ?? null,
}
if (
  next.theme === ref.current.theme &&
  next.defaultView === ref.current.defaultView &&
  next.weekStart === ref.current.weekStart &&
  next.timezone === ref.current.timezone
)
  return
apply(next)
```

In `persist`, extend the upsert payload:

```ts
        .upsert(
          {
            user_id: userId,
            theme: next.theme,
            default_view: next.defaultView,
            week_start: next.weekStart,
            timezone: next.timezone,
          },
          { onConflict: 'user_id' },
        )
```

Add the two savers next to `saveTheme` / `saveView`, and return them:

```ts
const saveWeekStart = useCallback(
  (weekStart: number) => persist({ ...ref.current, weekStart }),
  [persist],
)
const saveTimezone = useCallback(
  (timezone: string | null) => persist({ ...ref.current, timezone }),
  [persist],
)

return { settings, loading, saveTheme, saveView, saveWeekStart, saveTimezone }
```

- [ ] **Step 4: Bump the snapshot envelope**

`Settings` changed shape, so old envelopes must be dropped, not read. In `src/data/snapshot.ts`
replace line 11-12:

```ts
// Bump on any shape change. A mismatched envelope is dropped, never migrated.
// v2: Settings gained weekStart + timezone (roadmap 4.1). Dropping costs nothing in practice —
// getting this code at all requires a network navigation, and that same load rewrites both.
const V = 2
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/data/useSettings.test.ts src/data/snapshot.test.ts && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/useSettings.ts src/data/useSettings.test.ts src/data/snapshot.ts
git commit -m "feat(settings): persist week start and timezone"
```

---

### Task 5: `TodayProvider` + `useToday()`

**Files:**

- Create: `src/data/todayContext.ts`, `src/data/TodayProvider.tsx`, `src/data/TodayProvider.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**

- Consumes: `todayYmd(tz?: string | null): string` (Task 1); `useSettingsContext(): UseSettings` with `settings.timezone` (Task 4).
- Produces:
  - `TodayContext: React.Context<string>` — exported so tests can pin a date without a settings stack.
  - `useToday(): string`
  - `<TodayProvider>{children}</TodayProvider>`

- [ ] **Step 1: Write the failing test**

Create `src/data/TodayProvider.test.tsx`:

```tsx
import { render, screen, act } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ timezone: null as string | null }))

// Mocked so this tests the provider, not the whole auth + supabase settings stack.
vi.mock('./SettingsProvider', () => ({
  useSettingsContext: () => ({
    settings: {
      theme: 'cork',
      defaultView: 'calendar',
      weekStart: 0,
      timezone: h.timezone,
    },
    loading: false,
    saveTheme: vi.fn(),
    saveView: vi.fn(),
    saveWeekStart: vi.fn(),
    saveTimezone: vi.fn(),
  }),
}))

import { TodayProvider } from './TodayProvider'
import { useToday } from './todayContext'

function Show() {
  return <span data-testid="today">{useToday()}</span>
}

beforeEach(() => {
  h.timezone = null
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-28T11:30:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

test('publishes today in the configured zone', () => {
  h.timezone = 'Pacific/Kiritimati' // UTC+14 — already the 29th at this instant
  render(
    <TodayProvider>
      <Show />
    </TodayProvider>,
  )
  expect(screen.getByTestId('today')).toHaveTextContent('2026-07-29')
})

test('rolls over without a reload when the day changes', () => {
  h.timezone = 'UTC'
  render(
    <TodayProvider>
      <Show />
    </TodayProvider>,
  )
  expect(screen.getByTestId('today')).toHaveTextContent('2026-07-28')

  // A board left open overnight used to keep highlighting yesterday.
  act(() => {
    vi.setSystemTime(new Date('2026-07-29T11:30:00Z'))
    vi.advanceTimersByTime(60_000)
  })
  expect(screen.getByTestId('today')).toHaveTextContent('2026-07-29')
})

test('useToday works with no provider, so components render unwrapped', () => {
  render(<Show />)
  expect(screen.getByTestId('today')).toHaveTextContent(/^\d{4}-\d{2}-\d{2}$/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/TodayProvider.test.tsx`
Expected: FAIL — cannot resolve `./TodayProvider`.

- [ ] **Step 3: Create the context module**

Create `src/data/todayContext.ts`:

```ts
import { createContext, useContext } from 'react'
import { todayYmd } from '../lib/dates'

/**
 * Today's 'YYYY-MM-DD' in the user's configured timezone.
 *
 * The default is the browser's own today, so every consumer renders correctly unwrapped —
 * component tests need no new wrapper, and the signed-out landing page has no settings to read.
 *
 * Split out of `TodayProvider.tsx` so this stays a hook-only module: exporting a hook from a
 * file that also exports a component trips `react-refresh/only-export-components`.
 */
export const TodayContext = createContext<string>(todayYmd())

/** Today, in the user's timezone. Prefer this over `ymd(new Date())` in components. */
export function useToday(): string {
  return useContext(TodayContext)
}
```

- [ ] **Step 4: Create the provider**

Create `src/data/TodayProvider.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from 'react'
import { useSettingsContext } from './SettingsProvider'
import { todayYmd } from '../lib/dates'
import { TodayContext } from './todayContext'

const TICK_MS = 60_000

/**
 * Publishes today's date in the user's configured timezone.
 *
 * It re-evaluates on a timer and on `visibilitychange` rather than computing once at mount: a
 * board left open across midnight otherwise keeps highlighting yesterday, and a phone that was
 * asleep for a day would come back stale. `setState` only fires when the string actually
 * changes, so the overwhelmingly common case — same day, every tick — never re-renders anything.
 *
 * Must be mounted inside `<SettingsProvider>`; `useSettingsContext` throws otherwise.
 */
export function TodayProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettingsContext()
  const tz = settings?.timezone ?? null
  const [today, setToday] = useState(() => todayYmd(tz))

  useEffect(() => {
    const sync = () =>
      setToday((prev) => {
        const next = todayYmd(tz)
        return next === prev ? prev : next
      })
    // Runs immediately too: the useState initializer only ever saw the first `tz`, so this is
    // what picks up a timezone the user just changed (or one that arrived over realtime).
    sync()
    const id = window.setInterval(sync, TICK_MS)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [tz])

  return <TodayContext.Provider value={today}>{children}</TodayContext.Provider>
}
```

- [ ] **Step 5: Mount it in `src/App.tsx`**

Add the import beside the `SettingsProvider` one:

```tsx
import { TodayProvider } from './data/TodayProvider'
```

Then wrap, inside `SettingsProvider` (it reads settings) and outside `BrowserRouter` (every route
wants it):

```tsx
      <SettingsProvider>
        <TodayProvider>
          <BrowserRouter>
```

and close it after `</BrowserRouter>`:

```tsx
          </BrowserRouter>
        </TodayProvider>
      </SettingsProvider>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/data/TodayProvider.test.tsx && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data/todayContext.ts src/data/TodayProvider.tsx src/data/TodayProvider.test.tsx src/App.tsx
git commit -m "feat(dates): TodayProvider publishes timezone-aware today"
```

---

### Task 6: Route the board's "today" through `useToday()`

Six of the seven `ymd(new Date())` call sites, plus the two bare `new Date()` anchor sites.

> **Correction (found during execution):** this task's original text listed only six call sites and
> omitted `src/components/WeekView.tsx:22`, which highlights "today" exactly as `CalendarView` does.
> The omission was an authoring miscount, not an intentional exclusion. Left unconverted it ships two
> different "today"s on one board — Week view on browser time, Calendar view on the configured zone.
> `WeekView.tsx` is converted here too.
> `useTasks.ts` is deliberately **left alone** — see Step 5.

**Files:**

- Modify: `src/components/TaskCard.tsx:37`, `src/components/AgendaView.tsx:19`, `src/components/CalendarView.tsx:23`, `src/components/Board.tsx` (lines 108, 116, 205, 260)
- Test: `src/components/Board.test.tsx`

**Interfaces:**

- Consumes: `useToday(): string` and `TodayContext` from Task 5; existing `parseDay(day: string): Date` from `src/lib/dates.ts`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `src/components/Board.test.tsx`. That file's `Harness` takes no props and its `<Board>`
passes no `initialView`, so `Board` resolves its view as `readBoardView() ?? initialView ?? 'calendar'`
— and `readBoardView()` reads `localStorage`, which **persists across tests in the same file**. Any
earlier test that switched views would otherwise leak into this one, so clear it explicitly.

```tsx
test('opens on the month of the configured today, not the browser clock', () => {
  localStorage.clear() // readBoardView() wins over initialView; force the calendar view.
  // `shouldAdvanceTime` so dnd-kit's and Board's own timers still fire normally under fake time.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-07-28T12:00:00Z'))
  try {
    render(
      <TodayContext.Provider value="2026-03-15">
        <Harness />
      </TodayContext.Provider>,
    )
    // The browser clock says July; the user's timezone-resolved today is in March. Asserting the
    // absence of July is the half that actually proves `new Date()` is no longer the source.
    expect(screen.getByText('March 2026')).toBeInTheDocument()
    expect(screen.queryByText('July 2026')).not.toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})
```

Add the import at the top of the file (`render`, `screen`, `vi` and `afterEach` are already
imported there):

```tsx
import { TodayContext } from '../data/todayContext'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Board.test.tsx -t 'opens on the month'`
Expected: FAIL — the heading reads `July 2026`, because `anchor` initialises from `new Date()`.

- [ ] **Step 3: Rewire the three leaf components**

`src/components/TaskCard.tsx` — replace line 37:

```tsx
const { theme } = useTheme()
const overdue = isOverdue(task, useToday())
```

Line 7 currently reads `import { chipLabel, formatTime, ymd } from '../lib/dates'`. Drop only `ymd`
— the other two are still used:

```tsx
import { chipLabel, formatTime } from '../lib/dates'
```

and add `import { useToday } from '../data/todayContext'`.

`src/components/AgendaView.tsx` — replace line 19:

```tsx
const today = useToday()
```

Update the import on line 4 to `import { formatAgendaDate } from '../lib/dates'` and add
`import { useToday } from '../data/todayContext'`.

`src/components/CalendarView.tsx` — replace line 23:

```tsx
const { weekdays, cells } = buildMonthGrid(viewY, viewM, useToday())
```

Delete the now-unused `import { ymd } from '../lib/dates'` (line 4) and add
`import { useToday } from '../data/todayContext'`.

- [ ] **Step 4: Rewire `Board.tsx`**

Add `import { useToday } from '../data/todayContext'`, and change the `../lib/dates` import on
line 16 to drop `ymd` and add `parseDay`:

```tsx
import {
  MONTHS_LONG,
  addDays,
  addMonths,
  formatWeekRange,
  parseDay,
  startOfWeek,
} from '../lib/dates'
```

Line 108 — the anchor must start from the user's today, not the browser's calendar day, or the
board opens on one month while highlighting a "today" cell in another. `useToday()` must be called
before the `useState` that reads it:

```tsx
const today = useToday()
const [anchor, setAnchor] = useState(() => parseDay(today))
```

Line 116 — `today` is now a dependency of the memo:

```tsx
const visibleOverdue = useMemo(() => overdueTasks(visibleTasks, today), [visibleTasks, today])
```

Line 205:

```tsx
const onToday = () => setAnchor(parseDay(today))
```

Line 260:

```tsx
rollForward ? () => rollForward(today, new Set(visibleOverdue.map((t) => t.id))) : undefined
```

- [ ] **Step 5: Leave `useTasks.ts:143` on browser-local time**

Do **not** change it. Add this comment above `const today = ymd(new Date())` in `materialize` so the
next reader does not "fix" it:

```ts
// Browser-local on purpose, not the user's configured zone: this only anchors a 90-day
// rolling materialization horizon, where a ±1-day shift at the far end is immaterial.
// Threading the timezone in would re-run materialization whenever settings change, for
// no behavioral gain — and a spurious re-run risks duplicate instance rows (23505).
const today = ymd(new Date())
```

Two more `ymd(new Date())` sites are also **out of scope** — do not convert them while sweeping for
the pattern:

- `src/components/landing/BoardPreview.tsx` (lines 29, 51) and `src/data/mockTasks.ts` (line 42).
  Both render the signed-out marketing page or fixture data, where there is no user and no settings
  row to read a timezone from.
- `src/components/DataSection.tsx:81` uses `ymd(new Date())` to name an export file. That is a
  filename, not board state.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/components/Board.test.tsx && npm test`
Expected: PASS. The other component tests render with no provider and get the context default,
which is browser-local today — exactly what they asserted before.

- [ ] **Step 7: Typecheck for stray unused imports**

Run: `npx tsc -b && npm run lint`
Expected: clean. `noUnusedLocals` catches any `ymd` import left behind in Step 3 or 4.

- [ ] **Step 8: Commit**

```bash
git add src/components/TaskCard.tsx src/components/AgendaView.tsx src/components/CalendarView.tsx src/components/Board.tsx src/components/Board.test.tsx src/data/useTasks.ts
git commit -m "feat(board): resolve today through the configured timezone"
```

---

### Task 7: Thread `weekStart` to the calendar views

**Files:**

- Modify: `src/pages/BoardPage.tsx:49`, `src/components/Board.tsx`, `src/components/CalendarView.tsx`
- Test: `src/components/Board.test.tsx`

**Interfaces:**

- Consumes: `settings.weekStart` (Task 4); `buildMonthGrid(…, weekStart?)` and `startOfWeek(base, weekStart?)` (Tasks 1–2).
- Produces: `BoardProps` gains `weekStart?: number`; `CalendarViewProps` gains `weekStart?: number`. Both default to `0`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/Board.test.tsx`:

```tsx
test('renders a Monday-start month grid when configured', () => {
  localStorage.clear() // same reason as the anchor test: force the calendar view.
  render(<Harness weekStart={1} />)
  const headers = screen.getAllByText(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/)
  expect(headers).toHaveLength(7)
  expect(headers[0]).toHaveTextContent('Mon')
  expect(headers[6]).toHaveTextContent('Sun')
})
```

The `Harness` in that file is currently declared `function Harness() {` and takes no props. Give it
an optional one:

```tsx
function Harness({ weekStart }: { weekStart?: number }) {
```

and add `weekStart={weekStart}` to the `<Board … />` it renders. The existing
`const renderBoard = () => render(<Harness />)` on line 39 and the `renderOffline` helper below it
keep working unchanged — the prop is optional and `Board` defaults it to `0`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Board.test.tsx -t 'Monday-start'`
Expected: FAIL — `Board` has no `weekStart` prop, so headers still start at `Sun`.

- [ ] **Step 3: Add the prop to `Board`**

In `src/components/Board.tsx`, add to `BoardProps` (after `initialView`):

```tsx
  /** 0=Sunday … 6=Saturday. Passed rather than contexted: it only travels two levels. */
  weekStart?: number
```

Add `weekStart = 0,` to the destructured parameter list.

**Naming collision — read carefully.** Line 199 already declares a local `weekStart` holding a
`Date`. Rename that local to `weekStartDate` so it does not shadow the new prop:

```tsx
const weekStartDate = startOfWeek(anchor, weekStart)
```

Then update its two consumers. Line 200:

```tsx
const navLabel = view === 'week' ? formatWeekRange(weekStartDate) : `${MONTHS_LONG[month]} ${year}`
```

and the `<WeekView>` usage around line 276:

```tsx
                  <WeekView
                    weekStart={weekStartDate}
```

(`WeekView`'s own `weekStart` prop is a `Date` and keeps that name and meaning — it receives the
already-offset first day of the week and needs no other change.)

Finally pass the number down to `CalendarView` around line 283:

```tsx
                  <CalendarView
                    viewY={year}
                    viewM={month}
                    weekStart={weekStart}
```

- [ ] **Step 4: Accept it in `CalendarView`**

In `src/components/CalendarView.tsx`, add to `CalendarViewProps`:

```tsx
  /** 0=Sunday … 6=Saturday. */
  weekStart?: number
```

Destructure it with a default and forward it:

```tsx
export function CalendarView({ viewY, viewM, weekStart = 0, tasks, handlers, pop }: CalendarViewProps) {
```

```tsx
const { weekdays, cells } = buildMonthGrid(viewY, viewM, useToday(), weekStart)
```

- [ ] **Step 5: Pass it from `BoardPage`**

In `src/pages/BoardPage.tsx`, beside `initialView={settings.defaultView}`:

```tsx
              weekStart={settings.weekStart}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/components/Board.test.tsx && npm test && npx tsc -b`
Expected: PASS, clean typecheck.

- [ ] **Step 7: Commit**

```bash
git add src/components/Board.tsx src/components/Board.test.tsx src/components/CalendarView.tsx src/pages/BoardPage.tsx
git commit -m "feat(board): honour the configured week start in the calendar views"
```

---

### Task 8: The `/settings` Dates section

**Files:**

- Create: `src/components/DatesSection.tsx`, `src/components/DatesSection.test.tsx`
- Modify: `src/pages/SettingsPage.tsx:25-30`

**Interfaces:**

- Consumes: `useSettingsContext()` with `saveWeekStart` / `saveTimezone` (Task 4); `browserTimezone()` and `supportedTimezones()` (Task 1); `WEEKDAYS_LONG` from `src/lib/dates.ts`.
- Produces: `<DatesSection />` (no props — it reads the settings context directly, as `DataSection` and `DangerZone` already do, so `SectionContext` is untouched).

- [ ] **Step 1: Write the failing test**

Create `src/components/DatesSection.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  saveWeekStart: vi.fn(),
  saveTimezone: vi.fn(),
}))

vi.mock('../data/SettingsProvider', () => ({
  useSettingsContext: () => ({
    settings: { theme: 'cork', defaultView: 'calendar', weekStart: 1, timezone: 'Europe/London' },
    loading: false,
    saveTheme: vi.fn(),
    saveView: vi.fn(),
    saveWeekStart: h.saveWeekStart,
    saveTimezone: h.saveTimezone,
  }),
}))

import { DatesSection } from './DatesSection'

test('shows the current week start and timezone', () => {
  render(<DatesSection />)
  expect(screen.getByLabelText('Week starts on')).toHaveValue('1')
  expect(screen.getByLabelText('Timezone')).toHaveValue('Europe/London')
})

test('saves a new week start', () => {
  render(<DatesSection />)
  fireEvent.change(screen.getByLabelText('Week starts on'), { target: { value: '6' } })
  expect(h.saveWeekStart).toHaveBeenCalledWith(6)
})

test('saves a new timezone, and "Automatic" stores null', () => {
  render(<DatesSection />)
  const tz = screen.getByLabelText('Timezone')
  fireEvent.change(tz, { target: { value: 'Asia/Tokyo' } })
  expect(h.saveTimezone).toHaveBeenCalledWith('Asia/Tokyo')

  // The empty option means "follow the browser" — it must persist as NULL, not as ''.
  fireEvent.change(tz, { target: { value: '' } })
  expect(h.saveTimezone).toHaveBeenLastCalledWith(null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/DatesSection.test.tsx`
Expected: FAIL — cannot resolve `./DatesSection`.

- [ ] **Step 3: Implement the section**

Create `src/components/DatesSection.tsx`:

```tsx
import { useMemo, type CSSProperties } from 'react'
import { useSettingsContext } from '../data/SettingsProvider'
import { browserTimezone, supportedTimezones, WEEKDAYS_LONG } from '../lib/dates'

// The three week starts that exist in practice: Sunday (US/Canada/Japan), Monday (ISO 8601),
// Saturday (much of the Middle East). The column accepts 0–6; this is only what we offer.
const WEEK_START_OPTIONS = [0, 1, 6]

/**
 * Region `<optgroup>`s from the IANA prefix. Single-segment ids (UTC, GMT, the legacy aliases)
 * would each become a one-entry group, so they collect into a trailing "Other" instead.
 *
 * Module-private on purpose: exporting a non-component from a `.tsx` file trips
 * `react-refresh/only-export-components`.
 */
function groupZones(zones: string[]): { region: string; zones: string[] }[] {
  const byRegion = new Map<string, string[]>()
  for (const z of zones) {
    const slash = z.indexOf('/')
    const region = slash === -1 ? 'Other' : z.slice(0, slash)
    const arr = byRegion.get(region) ?? []
    arr.push(z)
    byRegion.set(region, arr)
  }
  const regions = [...byRegion.keys()].filter((r) => r !== 'Other').sort()
  if (byRegion.has('Other')) regions.push('Other')
  return regions.map((region) => ({ region, zones: [...(byRegion.get(region) ?? [])].sort() }))
}

// ≥16px so iOS Safari doesn't zoom the page on focus.
const select: CSSProperties = { fontSize: 16, padding: '8px 10px', maxWidth: 280 }
const label: CSSProperties = { fontSize: 13, opacity: 0.7 }
const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 }

/** Week start + timezone. Reads the settings context directly, like DataSection and DangerZone. */
export function DatesSection() {
  const { settings, saveWeekStart, saveTimezone } = useSettingsContext()
  const groups = useMemo(() => groupZones(supportedTimezones()), [])
  const auto = browserTimezone()

  if (!settings) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={field}>
        <label htmlFor="settings-week-start" style={label}>
          Week starts on
        </label>
        <select
          id="settings-week-start"
          value={String(settings.weekStart)}
          onChange={(e) => saveWeekStart(Number(e.target.value))}
          style={select}
        >
          {WEEK_START_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {WEEKDAYS_LONG[d]}
            </option>
          ))}
        </select>
      </div>

      <div style={field}>
        <label htmlFor="settings-timezone" style={label}>
          Timezone
        </label>
        <select
          id="settings-timezone"
          value={settings.timezone ?? ''}
          onChange={(e) => saveTimezone(e.target.value === '' ? null : e.target.value)}
          style={select}
        >
          <option value="">Automatic ({auto})</option>
          {groups.map((g) => (
            <optgroup key={g.region} label={g.region}>
              {g.zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <div style={{ fontSize: 12, opacity: 0.6 }}>
          Sets which day counts as “today” for the board and for overdue tasks.
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Register it on the settings page**

In `src/pages/SettingsPage.tsx`, add the import:

```tsx
import { DatesSection } from '../components/DatesSection'
```

and replace the `SECTIONS` block (lines 25-30) — note the stale comment loses its now-shipped item:

```tsx
// Later features append here (labels…).
const SECTIONS: SettingsSection[] = [
  { id: 'appearance', title: 'Appearance', render: (ctx) => <AppearanceSection {...ctx} /> },
  { id: 'dates', title: 'Dates', render: () => <DatesSection /> },
  { id: 'data', title: 'Data', render: () => <DataSection /> },
  { id: 'danger', title: 'Danger zone', render: () => <DangerZone /> },
]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/DatesSection.test.tsx src/pages/SettingsPage.test.tsx && npm test`
Expected: PASS. `SettingsPage.test.tsx` asserts individual section headings rather than an exhaustive
list, so adding a section does not break it — no edit needed there.

- [ ] **Step 6: Full verification**

Run: `npm run format:check && npm run lint && npx tsc -b && npm test`
Expected: all clean. Run `npm run format` first if `format:check` complains.

- [ ] **Step 7: Commit**

```bash
git add src/components/DatesSection.tsx src/components/DatesSection.test.tsx src/pages/SettingsPage.tsx
git commit -m "feat(settings): week start and timezone pickers"
```

---

### Task 9: Documentation

**Files:**

- Modify: `AGENTS.md`, `ROADMAP.md`, `CHANGELOG.md`

- [ ] **Step 1: Document the subsystem in `AGENTS.md`**

Add a subsection under "Architecture", after the "Responsive layout branches on `useIsMobile()`"
block:

```markdown
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
```

- [ ] **Step 2: Update `ROADMAP.md`**

1. Delete the `**Settings: week-start & timezone**` bullet from the Phase 4 list.
2. Delete the `| 4.1 | Settings: week-start & timezone | P3 | M | — |` row from the build-order table.
3. In the same table, change item 3.2's dependency cell from `4.1` to `—`.
4. In the Phase 3 reminders bullet, replace the trailing `Do **after** 4.1's timezone setting or reminders fire in UTC. Depends on 4.1.` with: `4.1 shipped the stored timezone; note that NULL means "follow the browser", which a server-side sender cannot resolve — prompt for a concrete zone when enabling reminders.`
5. Add `4.1` to the shipped list in "Build order at a glance", alongside the 5.7 / 5.1 / 5.2 / 5.3 / 3.1 entries, dated 2026-07-28.
6. Re-check the "Total rough effort" line — it drops by one M item.

- [ ] **Step 3: Add the changelog entry**

Confirm the target version first: `node scripts/next-version.mjs` → expected `1.2.36`. Add a new
section at the top of the released list in `CHANGELOG.md`, matching the existing format:

```markdown
## [1.2.36]

### Added

- Settings → Dates: choose which day your week starts on (Sunday, Monday, or Saturday) and set your
  timezone. The timezone decides which day counts as “today” for the board's today highlight,
  overdue badges, and roll-forward; “Automatic” follows whatever browser you are on.

### Fixed

- A board left open across midnight now rolls over to the new day on its own instead of keeping
  yesterday highlighted until a reload.
- The week view's weekday labels are derived from each cell's real date, so they stay correct when
  the week does not start on Sunday.
```

- [ ] **Step 4: Verify the changelog guard passes**

Run: `node scripts/check-changelog.mjs`
Expected: passes — the PR names its target version and every released tag has a section. If it
reports missing backfill for earlier Dependabot builds, add those sections too.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md ROADMAP.md CHANGELOG.md
git commit -m "docs: week start and timezone settings (v1.2.36)"
```

- [ ] **Step 6: Sync the generated Codex trees**

Nothing under `.claude/` changed, but run the check so a stale tree cannot fail CI:

Run: `npm run codex:check`
Expected: passes. If it fails, run `npm run codex:sync` and commit the result.

---

## Final Verification

- [ ] `npm run format:check && npm run lint && npx tsc -b && npm test` — all clean
- [ ] `npm run build` — succeeds
- [ ] `npm run codex:check` — passes
- [ ] `node scripts/check-changelog.mjs` — passes
- [ ] Manual smoke on `npm run dev`: set week start to Monday and confirm the month grid re-pads and
      the headers rotate; set the timezone to `Pacific/Kiritimati` and confirm the today highlight
      moves a day; set it back to Automatic and confirm it returns.
- [ ] Open the PR with the `ship` skill ("ship it").
