# UI: responsive layout, dates, and theming

The three things that decide how the board looks and when it re-lays-out. Read before changing a
view module, a theme token, or anything that asks what day it is.

## Responsive layout branches on `useIsMobile()`, not CSS media queries

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

## Dates are timezone-aware through one context, week start through one prop

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
time, because re-running materialization on a settings change risks duplicate instance rows (23505).
This paragraph used to add "it only anchors a 90-day rolling horizon, where a ±1-day shift at the
far end is immaterial" — true until #210, which made the same clock set the window's **lower** bound
too. A ±1-day shift there is not immaterial: a board whose zone is behind the browser's would drop
its current Occurrence below the floor and never create it, permanently, since the floor only moves
forward. `MATERIALIZE_GRACE_DAYS` in `recurrence.ts` is one day of slack below today that absorbs
exactly that skew, and it is what keeps this call site on the cheap clock instead of forcing the
timezone through. `CellMeta.dow` carries each cell's real weekday so
`WeekView` can label a rotated week without knowing `weekStart`; weekend shading stays absolute
Sat/Sun and never rotates.

## Theming is an inline-style-object model, not CSS

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

**`focusRing` (#281) is a per-theme token, not a reuse of `accent`, and the reason is the same as
`numTodayFg` not being `accent`: the ring sits on a card, so the six paper colours are the only
backgrounds it ever has to beat.** Cork and brutal papers are light, so their rings are near-black
(`#2f1d0c`, `#111111`); glass cards are dark translucent with light ink, so its ring is near-white
(`#eaf0ff`). `accent` would put glass's `#7452ff` on a dark card — the one combination that
disappears. axe does not evaluate focus indicators, so a new theme's value is a deliberate judgement
call, not a number a check hands you.

**Where the ring is drawn is part of the design, and it was wrong until #361.** It used to be an
outline 2px _outside_ the card on `SortableCard`'s wrapper, which put it on the board background
rather than the paper its colours were chosen for — and the calendar cell's card container is
`overflow: auto` with no padding, so that ring was clipped out of sight in every theme. It was
rendered, its computed style was right, and nobody could see it. The ring is now an outline on the
card element itself (passed through `TaskCard`'s `wrapStyle`), drawn **inside** the edge by a
negative `outline-offset` taken from a per-theme `focusRingInset` token: flush on cork's borderless
paper, 5–8px in on brutal so a strip of paper separates it from the 2.5px black border it would
otherwise merge with, and just inside glass's 1px edge. On the card element it also rotates with the
paper and follows each theme's radius. Two rules follow: **do not move the ring back outside the
card**, and **do not put it back on the unrotated wrapper**, where a straight rectangle slides off a
tilted card's corners.

The ring itself is the sharpest example yet of the inline-style-object / pseudo-class tension this
section already warns about: `:focus-visible` cannot be expressed as an inline style, so
`SortableCard` tracks focus in React state instead, set from `onFocus` by reading
`e.currentTarget.matches(':focus-visible')` — that match, not raw focus, is what keeps a mouse click
from lighting the ring. **Measured, not assumed: jsdom implements the `:focus-visible` selector well
enough not to throw, but always returns `false`,** so this state can never become `true` under
`vitest` and a unit test asserting the ring would pass for the wrong reason. Verifying it needs a
real browser, and the visual canaries (#280, `tests/e2e/visual.spec.ts`) do **not** cover it yet: none of
them screenshots a keyboard-focused card, so a focused-card canary there is where that check belongs. Do not add a jsdom test for
this ring — the code comment at the call site exists specifically so nobody writes one later
believing it proves something.

## `design/Task Board.dc.html` is the source of truth, reference-only

The original 821-line vanilla-JS prototype. The visual layer and the reorder/recurrence logic were
ported from it. It is **not built**, is in `.prettierignore`, and should not be edited.
