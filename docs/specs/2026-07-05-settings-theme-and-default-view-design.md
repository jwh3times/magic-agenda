# Settings-only theme + decoupled default view — Design

**Date:** 2026-07-05
**Status:** Approved (pre-Phase-2 behavior change)

## Problem

Two settings behaviors are tangled with the live board today:

1. The theme switcher (cork / brutal / glass) appears in **both** the toolbar and Settings →
   Appearance. It should live in Settings only.
2. The persisted **default view** (`user_settings.default_view`) is overwritten every time the
   user switches view tabs during a session (`Board` calls `saveView` on each `changeView`). So
   "default view" doesn't mean "the view I want to land on" — it just tracks the last view used.

The desired model separates three concepts:

- **Default view** — `user_settings.default_view` (synced across devices). Changed **only** in
  Settings → Appearance. It is the "landing" view shown on login.
- **Session view** — what the board currently shows; changed by the view tabs; local to the
  browser tab; **never** writes back to `default_view`. Remembered across a refresh.
- **Theme** — still applied on the board and still synced live across devices; only its
  *control* moves to Settings.

## Non-goals

- No schema change. `default_view` already exists and keeps its meaning (now only mutated via
  the Settings picker).
- No change to live theme sync or live settings sync (Part E realtime work stays intact).
- No new "reset view" affordance — the model is implicit (see behavior table).

## Design

### Part 1 — Theme control moves to Settings only

Remove `<ThemeSwitcher />` from `src/components/Toolbar.tsx` (both the mobile and desktop
branches) and drop its now-unused import. The switcher stays in Settings → Appearance
(`AppearanceSection` in `src/pages/SettingsPage.tsx`), which is already wired to `saveTheme`.

`ThemeProvider` remains in `BoardPage` as the **applier** of `settings.theme`; only the in-board
*control* is removed. Live cross-device theme sync is therefore unaffected: a theme change on
device A still flows A → `saveTheme` → `user_settings` upsert → device B's `useSettings`
subscription → `settings.theme` → `BoardPage` re-render with a new `initial` prop →
`ThemeProvider`'s `initial`-effect re-syncs → board restyles.

`BoardPage`'s `<ThemeProvider initial={settings.theme} onThemeChange={saveTheme}>` is left as-is
(the `onThemeChange` hook is harmless with no in-board control and avoids touching the
realtime-tested theme path).

### Part 2 — Default view decoupled; session view remembered per tab

**Stop persisting on session switch.** `Board.changeView` no longer calls `onViewChange`. The
`onViewChange` prop is removed from `BoardProps`, and `BoardPage` stops passing `saveView` to
`Board` (and stops destructuring `saveView` from `useSettings`). The **only** remaining caller of
`saveView` is the Settings default-view `<select>` — so `default_view` changes only in Settings.

**Remember the current view per tab (sessionStorage).** A tiny wrapper module
`src/lib/viewStorage.ts` reads/writes/clears a single `sessionStorage` key `ma-board-view`, each
call wrapped in `try/catch` (privacy-mode browsers can throw on storage access — same hardening
the Part C recovery-flag review called for).

```ts
// src/lib/viewStorage.ts
import type { ViewName } from '../types/task'

const KEY = 'ma-board-view'
const isViewName = (v: string): v is ViewName =>
  v === 'calendar' || v === 'week' || v === 'agenda' || v === 'kanban'

export function readBoardView(): ViewName | null {
  try {
    const v = sessionStorage.getItem(KEY)
    return v && isViewName(v) ? v : null
  } catch {
    return null
  }
}
export function writeBoardView(view: ViewName): void {
  try {
    sessionStorage.setItem(KEY, view)
  } catch {
    /* storage unavailable — remembering the view is best-effort */
  }
}
export function clearBoardView(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
```

`Board` seeds its view state from the stored value, falling back to the default view, then writes
on every switch:

```ts
const [view, setView] = useState<ViewName>(
  () => readBoardView() ?? initialView ?? 'calendar',
)
// changeView:
const changeView = (v: ViewName) => {
  setView(v)
  writeBoardView(v)
}
```

**Clear on sign-out so a re-login lands on the default.** `AuthProvider`'s existing
`SIGNED_OUT` branch (added in Part C for the recovery flag) also calls `clearBoardView()`. This
is what makes "sign out → sign back in" show the default view even within the same tab.

### Resulting observable behavior

| Action | Result |
| --- | --- |
| Switch view mid-session | shows the new view (not saved as default) |
| Refresh the tab | stays on the current view (sessionStorage) |
| Open a **new tab** | default view (fresh tab has no sessionStorage) |
| Close tab, reopen later | default view |
| Sign out → sign back in | default view (`clearBoardView` on `SIGNED_OUT`) |
| Change the default in Settings | next new tab / next login lands on it |

A live `default_view` change from another device does **not** move the current session's view
(the board reads the default only at mount) — deliberate: default view is a landing preference,
not a live restyle like theme.

## Files touched

- `src/components/Toolbar.tsx` — remove `ThemeSwitcher` (both branches) + import.
- `src/lib/viewStorage.ts` — **new**: `readBoardView` / `writeBoardView` / `clearBoardView`.
- `src/components/Board.tsx` — seed `view` from `readBoardView()`; `changeView` writes storage
  instead of calling `onViewChange`; remove `onViewChange` from `BoardProps` + usage.
- `src/pages/BoardPage.tsx` — drop `onViewChange={saveView}` on `<Board>`; drop `saveView` from
  the `useSettings` destructure.
- `src/auth/AuthProvider.tsx` — `clearBoardView()` in the `SIGNED_OUT` branch.

## Testing

- `src/lib/viewStorage.test.ts` (**new**): round-trip write→read; `read` returns `null` for a
  missing key and for an invalid stored value; `clear` removes it.
- `src/components/Board.test.tsx` (extend): switching views does **not** call the settings
  persister (the Harness supplies no `onViewChange` and none is invoked), and a value seeded in
  `sessionStorage` before mount is the initial view.
- `src/components/Toolbar.test.tsx`: still passes with the switcher removed (verify no assertion
  depends on `ThemeSwitcher`; the existing test targets the settings gear).
- `src/pages/SettingsPage.test.tsx`: unchanged — already asserts the picker persists the default
  view; that path is now the *only* writer.
- `src/auth/AuthProvider.test.tsx` (extend): `SIGNED_OUT` clears the stored board view (stub
  `sessionStorage`).

## Rollout

Single PR (`feat/settings-only-theme-view`), no schema, merged before starting Phase 2. Standard
gate: `npm test` + `npm run lint` + `npm run build` + per-file `prettier --check`.
