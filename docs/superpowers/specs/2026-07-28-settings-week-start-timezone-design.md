# Settings: week-start & timezone — design

**Date:** 2026-07-28
**Roadmap item:** 4.1 (Phase 4, P3, size M)
**Status:** approved, ready for implementation planning

## Goal

Let a user choose which weekday their week starts on, and store an IANA timezone that defines
"today" for their board. This completes the settings page and unblocks item 3.2 (reminders), whose
server-side sender has no browser to ask for a timezone.

## Background: what is true today

Dates are already **browser-local**, not UTC. `lib/dates.ts` builds every `YYYY-MM-DD` from
`getFullYear`/`getMonth`/`getDate`, and `parseDay` returns a local `Date`, so a single-device user
in one timezone is already correct. Two things are missing:

1. A **stored** timezone. Without one, a server-side sender fires in UTC, and a traveling user's
   board silently re-dates itself to wherever they happen to be.
2. A **week start**. `startOfWeek` hardcodes Sunday and `buildMonthGrid` pads from
   `first.getDay()`.

"Today" is derived ad-hoc in two forms:

- **Seven `ymd(new Date())` call sites** — `Board.tsx` ×2 (the `visibleOverdue` memo, the
  roll-forward handler), `CalendarView.tsx`, `WeekView.tsx`, `AgendaView.tsx`, `TaskCard.tsx`,
  `useTasks.ts`.
- **Two bare `new Date()` anchor sites in `Board.tsx`** — the initial `anchor` state and `onToday`.
  These are a distinct case: with a stored timezone, `new Date()` can be a different calendar day
  than the user's "today", so the Today button would land on the wrong week or month.

## Decisions

| Decision                                                    | Rationale                                                                                                                                       |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Store the timezone **and apply it** to "today" in this PR   | Shipping a setting that visibly does nothing reads as broken. `NULL` = browser, so single-device users see no change.                           |
| Full IANA list in a native `<select>`, region `<optgroup>`s | No dependency, native wheel picker on iOS, keyboard typeahead on desktop. Curated fallback list only when `Intl.supportedValuesOf` is missing.  |
| Week-start picker offers Sunday / Monday / Saturday         | The three week starts that exist in practice. The column is `int 0–6`; the pure functions accept all seven, this is only what the UI lists.     |
| `today` reaches components via a **context**                | `TaskCard` is four levels deep (`CalendarView → DayCell → SortableCard → TaskCard`). Matches ThemeProvider / SettingsProvider / offlineContext. |
| `weekStart` reaches components via a **prop**               | Travels two levels only, and is a parameter of a pure function. Keeping it out of context preserves `Board`'s prop-driven testability.          |

The two different mechanisms are deliberate, not an oversight — see "Wiring" below.

## 1. Schema

New migration `supabase/migrations/20260728120000_settings_week_start_timezone.sql`:

```sql
alter table public.user_settings
  add column if not exists week_start int not null default 0,
  add column if not exists timezone text;                    -- IANA; NULL = follow browser

alter table public.user_settings
  add constraint user_settings_week_start_range check (week_start between 0 and 6);
```

Then regenerate `src/types/database.types.ts` with `supabase gen types --linked`.

No RLS change: the existing owner-only policies on `user_settings` cover new columns. No CHECK on
`timezone` — Postgres cannot reference `pg_timezone_names` from a CHECK constraint, and a bad value
only affects its own owner, where `todayYmd` falls back to browser-local.

`user_settings` is in the `supabase_realtime` publication. The `postgres_changes` handler in
`useSettings` must carry the two new fields, or a change made on device A will not reach device B.
Neither new column is a primary key, so the standing realtime rules are unaffected.

## 2. Pure core — `src/lib/dates.ts` (test-first)

| Function                                 | Behavior                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `todayYmd(tz?: string \| null): string`  | `Intl.DateTimeFormat(undefined, { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })` read through `formatToParts`, assembled as `YYYY-MM-DD`. Wrapped in try/catch that falls back to `ymd(new Date())` on an unknown zone or a missing `Intl`. A nullish `tz` skips the `timeZone` option entirely, yielding the browser zone. |
| `startOfWeek(base: Date, weekStart = 0)` | `addDays(base, -((base.getDay() - weekStart + 7) % 7))`. The default keeps every existing caller and its tests unchanged.                                                                                                                                                                                                                        |
| `weekdayLabels(weekStart = 0): string[]` | `WEEKDAYS_SHORT` rotated so index 0 is the configured start.                                                                                                                                                                                                                                                                                     |
| `browserTimezone(): string`              | `Intl.DateTimeFormat().resolvedOptions().timeZone`, for the "Automatic (America/Chicago)" label.                                                                                                                                                                                                                                                 |
| `supportedTimezones(): string[]`         | Feature-detected `Intl.supportedValuesOf('timeZone')`; otherwise a curated ~30-zone fallback constant.                                                                                                                                                                                                                                           |

`tsconfig.app.json` sets `lib: ["ES2020", "DOM", "DOM.Iterable"]`, and `Intl.supportedValuesOf` is
only typed from `lib.es2022.intl`. Reach it through a narrow local cast rather than bumping `lib` —
the runtime feature-detect is needed for the fallback regardless, so the cast is the honest shape,
not a workaround.

`formatToParts` rather than the `en-CA` locale trick: `en-CA` happens to emit `YYYY-MM-DD` today,
but that is a locale-data coincidence, not a guarantee.

## 3. Selectors — `src/data/selectors.ts` (test-first)

Smaller ripple than the roadmap sketch assumed.

- **`buildWeekCells` needs no signature change.** It already receives the start `Date`, and weekend
  detection (`d.getDay() === 0 || === 6`) is absolute, not positional.
- **`buildMonthGrid` gains `weekStart = 0`**: padding becomes `(first.getDay() - weekStart + 7) % 7`,
  and the returned `weekdays` becomes `weekdayLabels(weekStart)`. Still 42 cells (7×6) in all cases.
- **`CellMeta` gains `dow: number`** (the cell's real `getDay()`). This is what fixes `WeekView`,
  which today indexes `WEEKDAYS_SHORT[i]` by _position_ — correct only for a Sunday-start week. With
  `dow` on the cell, `WeekView` reads `WEEKDAYS_SHORT[meta.dow]` and never needs `weekStart` at all.

## 4. Wiring

### Settings shape

`Settings` gains `weekStart: number` and `timezone: string | null`.
`DEFAULTS` becomes `{ theme: 'cork', defaultView: 'calendar', weekStart: 0, timezone: null }`.
`useSettings` gains `saveWeekStart` / `saveTimezone`, maps `week_start` / `timezone` in the initial
select, includes them in the `upsert`, and carries them through the realtime handler (including its
"unchanged, skip" comparison).

### Snapshot

`src/data/snapshot.ts` bumps `V` from 1 to 2 — the documented drop-don't-migrate rule. The cost is
near zero: obtaining the new JS requires being online (navigations are network-first), and that same
load rewrites both envelopes.

### `today`

New `src/data/TodayProvider.tsx`, mounted inside `<SettingsProvider>` in `App.tsx`. It reads
`useSettingsContext()` and computes `todayYmd(settings?.timezone)`.

Six of the seven `ymd(new Date())` call sites become `useToday()` — `Board.tsx` ×2,
`CalendarView.tsx`, `WeekView.tsx`, `AgendaView.tsx`, `TaskCard.tsx`. The seventh, `useTasks.ts`,
deliberately stays
browser-local (see below).

The two anchor sites in `Board.tsx` become `parseDay(today)`: the initial `anchor` state and
`onToday`. Without this the board still opens on the browser's calendar month while highlighting a
"today" cell from a different one.

The context default is `todayYmd()`, so components render correctly with no provider — `Board.test.tsx`
and the other component tests need no new wrapper.

The provider re-evaluates on a 60-second interval and on `visibilitychange`, calling `setState` only
when the string actually changes. This also fixes an existing latent bug: a board left open overnight
currently keeps highlighting yesterday.

### `weekStart`

Passed `BoardPage → Board → CalendarView` as a prop, defaulting to `0`. `Board` computes
`startOfWeek(anchor, weekStart)`; `CalendarView` forwards it to `buildMonthGrid`. `WeekView` needs
nothing (see `dow` above).

### Deliberately unchanged

- **`useTasks.materialize()`** keeps browser-local `ymd(new Date())`. It anchors a 90-day rolling
  horizon; a ±1-day shift at the far end is immaterial, and threading a timezone in there would
  re-run materialization on a settings change for no behavioral gain.
- **`Landing`'s `BoardPreview` and `mockTasks`** stay browser-local — signed-out surfaces with no
  settings to read.
- **`at_time`** stays a timezone-free `HH:MM` wall-clock string.

## 5. Settings UI

New `src/components/DatesSection.tsx`, registered in `SettingsPage`'s `SECTIONS` as
`{ id: 'dates', title: 'Dates' }`, placed after Appearance. It calls `useSettingsContext()` directly
(as `DataSection` and `DangerZone` already do), so `SectionContext` does not change.

Two labeled `<select>`s at ≥16px font (the iOS focus-zoom rule):

- **Week starts on** — Sunday / Monday / Saturday.
- **Timezone** — `Automatic (America/Chicago)` first (value `''` → `NULL`), then all zones grouped
  into region `<optgroup>`s (Africa, America, Asia, …) derived from the IANA prefix — the segment
  before the first `/`. Zones with no `/` (`UTC`, `GMT`, the legacy single-segment ids) fall into a
  trailing `Other` group rather than each becoming a one-entry group of their own.

A one-line hint under the timezone select states that it controls "today" and overdue.

## 6. Testing

Pure logic first, per the repo convention.

**`src/lib/dates.test.ts`**

- `todayYmd` at a fixed fake system time either side of the date line — the same instant is one
  calendar date in `Pacific/Kiritimati` and the previous one in `Pacific/Niue`.
- `todayYmd('Not/AZone')` falls back to browser-local rather than throwing.
- `startOfWeek` for weekStart 0 / 1 / 6, including a week that crosses a month boundary, and the
  default-argument case (still Sunday).
- `weekdayLabels` rotation for each start.
- `supportedTimezones` returns the fallback list when `Intl.supportedValuesOf` is absent.

**`src/data/selectors.test.ts`**

- `buildMonthGrid` with `weekStart: 1` on a month that _starts_ on a Sunday — the sharp case, where
  correct padding is 6 leading cells, not 0.
- Rotated weekday headers; still 42 cells; `dow` correct on every cell.
- Existing Sunday-start assertions stay green untouched (default argument).

**Component / hook**

- `useSettings.test.ts`: round-trips both new fields; a realtime payload carrying them updates state.
- `DatesSection.test.tsx`: both selects render current values; changing each calls the right save fn.
- A Monday-start render assertion for the month grid headers.
- `Board.test.tsx`: with a `TodayProvider` pinned to a date in a different month than the browser's
  fake clock, the board opens on the pinned month and `Today` returns to it — the anchor fix.

## 7. Accepted risk: the deploy window

Migrations and the Cloudflare Pages build land at slightly different moments on a merge. Reads
tolerate the old schema (`data.week_start ?? 0`, `data.timezone ?? null`), but the `upsert` writes
the new columns. `Deploy Migrations` (~30s) reliably completes before the Pages build (~2 min), and
a failed save is already logged and superseded by the next change. Same shape as the previous schema
PRs (`task_at_time`, `task_pinned`); accepted.

## 8. Forward pointer to 3.2

Item 3.2's sender cannot read `NULL` as "browser" — there is no browser. When reminders are built,
that flow should prompt the user to pick a concrete zone before enabling them. Auto-capturing the
browser timezone at signup now is rejected: it would make "Automatic" a lie and freeze a value the
user never chose.

## Out of scope

- Reminders / notifications (3.2).
- Per-task timezones. A task is a wall-clock `day` + `at_time`; that stays true.
- Localized weekday and month names. `WEEKDAYS_SHORT` / `MONTHS_LONG` remain English constants.
- 12- vs 24-hour time preference.

## Documentation to update

`AGENTS.md` (the date/timezone boundary and the two-mechanism wiring rule), `ROADMAP.md` (remove 4.1,
update the build-order table and 3.2's dependency note), `CHANGELOG.md` (the target version this
merge mints, per `scripts/next-version.mjs`).
