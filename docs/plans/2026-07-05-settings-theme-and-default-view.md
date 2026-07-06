# Settings-only theme + decoupled default view — Implementation Plan

**Goal:** Move the theme switcher to Settings only, and stop the board's view tabs from overwriting the persisted default view — instead remember the current view per browser tab (sessionStorage), cleared on sign-out.

**Architecture:** No schema. A tiny `src/lib/viewStorage.ts` wraps a single sessionStorage key. `Board` seeds its view from it and writes on each switch (no longer calling any settings persister); the Settings picker becomes the sole writer of `default_view`. `AuthProvider` clears the stored view on `SIGNED_OUT` so a re-login lands on the default. `Toolbar` loses its theme switcher (kept in Settings → Appearance, whose live cross-device sync is untouched).

**Tech Stack:** React 19 + TypeScript SPA, Supabase, Vitest 4 + Testing Library (jsdom), inline-style theming.

## Global Constraints

- Single branch + single PR: `feat/settings-only-theme-view`, off freshly-pulled `main`. `main` is PR-only; required checks Format / Test / Build / Functions + CodeQL must pass; self-merge once green. Merge this **before** starting Phase 2.
- **Per-commit gate (every task):** `npm test`, `npm run lint`, `npm run build` (tsc — catches removed-prop ripples), and `npx prettier --check <every touched src/** file>` (`--write` those exact files if it warns, then re-run tests). NEVER run repo-wide `npm run format` (local CRLF noise rewrites ~38 unrelated files; CI is authoritative).
- Commit messages: plain imperative subjects (no `feat:` prefixes), ending with the line `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No schema, no `database.types.ts` change, no realtime change. Live theme sync and live settings sync (Part E) must stay intact — this plan only removes the in-board theme *control*, never the applier (`ThemeProvider` stays in `BoardPage`).
- sessionStorage key is exactly `ma-board-view`. Every storage access is wrapped in `try/catch` (privacy-mode browsers throw).
- Test-first for the pure storage helper; UI/behavior gets Testing Library coverage.

---

## Task 1: `viewStorage.ts` — sessionStorage wrapper (TDD)

**Files:**
- Create: `src/lib/viewStorage.ts`
- Test: `src/lib/viewStorage.test.ts`

**Interfaces:**
- Produces: `readBoardView(): ViewName | null` (null when absent OR when the stored string isn't a known view), `writeBoardView(view: ViewName): void`, `clearBoardView(): void`. Key `ma-board-view`. `ViewName` = `'calendar' | 'week' | 'agenda' | 'kanban'` (from `src/types/task.ts`).

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull --ff-only
git checkout -b feat/settings-only-theme-view
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/viewStorage.test.ts`:

```ts
import { afterEach, expect, test } from 'vitest'
import { clearBoardView, readBoardView, writeBoardView } from './viewStorage'

afterEach(() => sessionStorage.clear())

test('write then read round-trips a valid view', () => {
  writeBoardView('week')
  expect(readBoardView()).toBe('week')
})

test('read returns null when nothing is stored', () => {
  expect(readBoardView()).toBeNull()
})

test('read rejects an unknown stored value', () => {
  sessionStorage.setItem('ma-board-view', 'bogus')
  expect(readBoardView()).toBeNull()
})

test('clear removes the stored view', () => {
  writeBoardView('agenda')
  clearBoardView()
  expect(readBoardView()).toBeNull()
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/lib/viewStorage.test.ts`
Expected: FAIL — cannot resolve `./viewStorage`.

- [ ] **Step 4: Implement**

Create `src/lib/viewStorage.ts`:

```ts
import type { ViewName } from '../types/task'

// Per-tab memory of the board's current view (sessionStorage: survives a refresh,
// resets on a new tab). Distinct from user_settings.default_view, which is the
// synced landing preference changed only in Settings.
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
    // Storage unavailable (privacy mode) — remembering the view is best-effort.
  }
}

export function clearBoardView(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
```

- [ ] **Step 5: Run tests + full gate**

Run: `npx vitest run src/lib/viewStorage.test.ts` → 4/4 PASS.
Run: `npm test && npm run lint && npm run build` → green. `npx prettier --check src/lib/viewStorage.ts src/lib/viewStorage.test.ts` (→ `--write` + re-test if it warns).

- [ ] **Step 6: Commit**

```bash
git add src/lib/viewStorage.ts src/lib/viewStorage.test.ts
git commit -m "Add a per-tab sessionStorage wrapper for the board view

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: Remove the theme switcher from the toolbar

**Files:**
- Modify: `src/components/Toolbar.tsx`

**Interfaces:** none produced/consumed. `ThemeSwitcher` stays exported and is still used by `SettingsPage`.

- [ ] **Step 1: Confirm the current usages**

Run: `grep -n "ThemeSwitcher" src/components/Toolbar.tsx`
Expected: three lines — the import (~line 5), one usage in the mobile branch (~line 93, inside the row-2 `<div style={{ …overflowX: 'auto' }}>` alongside `<ViewSwitcher …/>`), and one usage in the desktop branch (~line 138, first child of the right-hand `<div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>`).

- [ ] **Step 2: Remove all three**

1. Delete the import line `import { ThemeSwitcher } from './ThemeSwitcher'`.
2. In the mobile branch, delete the `<ThemeSwitcher />` line (the row-2 `<div>` keeps only `<ViewSwitcher … />`; leave the `<div>`'s styles as-is — a single left-aligned child is fine).
3. In the desktop branch, delete the `<ThemeSwitcher />` line (the right group becomes gear → `+ New task` → Sign out).

Do not touch any other line. `grep -n "ThemeSwitcher" src/components/Toolbar.tsx` must return nothing afterward.

- [ ] **Step 3: Full gate**

Run: `npm test && npm run lint && npm run build`.
Expected: PASS. `Toolbar.test.tsx` still passes — it targets the settings gear, never the theme switcher. (`lint` would flag a leftover unused import; that's your check that step 2.1 happened.)
Run: `npx prettier --check src/components/Toolbar.tsx` (→ `--write` + re-test if it warns).

- [ ] **Step 4: Commit**

```bash
git add src/components/Toolbar.tsx
git commit -m "Move theme switching out of the toolbar into settings only

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Decouple the default view; remember the session view per tab (TDD)

**Files:**
- Modify: `src/test/setup.ts` (global test isolation), `src/components/Board.tsx`, `src/pages/BoardPage.tsx`
- Test: `src/components/Board.test.tsx` (extend)

**Interfaces:**
- Consumes: `readBoardView` / `writeBoardView` (Task 1).
- Produces: `BoardProps` loses `onViewChange`. `Board` seeds `view` from `readBoardView() ?? initialView ?? 'calendar'` and writes storage on each switch. The Settings default-view `<select>` (unchanged) becomes the sole caller of `saveView`.

- [ ] **Step 1: Add global test isolation for browser storage**

Replace `src/test/setup.ts` with:

```ts
import '@testing-library/jest-dom'
import { afterEach } from 'vitest'

// Isolate tests from persisted browser state (board view, auth recovery flag),
// so a view switch in one test can't change another test's initial view.
afterEach(() => {
  sessionStorage.clear()
})
```

- [ ] **Step 2: Write the failing Board tests**

Append to `src/components/Board.test.tsx` (the file already imports `render, screen`, `userEvent`, and defines `renderBoard`):

```ts
test('mounts on the view stored in sessionStorage', () => {
  sessionStorage.setItem('ma-board-view', 'kanban')
  renderBoard()
  // Kanban shows the status columns; calendar/week show the Inbox instead.
  expect(screen.getByText('To Do', { selector: 'span' })).toBeInTheDocument()
})

test('switching views remembers the choice per tab', async () => {
  const user = userEvent.setup()
  renderBoard()
  await user.click(screen.getByRole('button', { name: 'Week' }))
  expect(sessionStorage.getItem('ma-board-view')).toBe('week')
})
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/components/Board.test.tsx`
Expected: both new tests FAIL — the board ignores stored state (mounts on calendar) and writes nothing on switch.

- [ ] **Step 4: Implement**

In `src/components/Board.tsx`:

1. Add the import (next to the other `../lib` imports):

```ts
import { readBoardView, writeBoardView } from '../lib/viewStorage'
```

2. Remove `onViewChange?: (v: ViewName) => void` from `BoardProps`, and remove `onViewChange` from the destructured parameter list.
3. Change the `view` state initializer:

```ts
  const [view, setView] = useState<ViewName>(() => readBoardView() ?? initialView ?? 'calendar')
```

4. Change `changeView`:

```ts
  const changeView = (v: ViewName) => {
    setView(v)
    writeBoardView(v)
  }
```

In `src/pages/BoardPage.tsx`:

5. Drop `saveView` from the `useSettings` destructure:

```ts
  const { settings, loading: settingsLoading, saveTheme } = useSettings(userId)
```

6. Remove the `onViewChange={saveView}` line from the `<Board … />` element. (`initialView={settings.defaultView}` stays — that's the login landing view.)

- [ ] **Step 5: Run tests + full gate**

Run: `npx vitest run src/components/Board.test.tsx` → all PASS (including the existing view-switching tests, now isolated by the setup.ts clear).
Run: `npm test && npm run lint && npm run build` → green (tsc confirms no stray `onViewChange` reference remains).
Run: `npx prettier --check src/test/setup.ts src/components/Board.tsx src/pages/BoardPage.tsx src/components/Board.test.tsx` (→ `--write` + re-test if it warns).

- [ ] **Step 6: Commit**

```bash
git add src/test/setup.ts src/components/Board.tsx src/pages/BoardPage.tsx src/components/Board.test.tsx
git commit -m "Stop view tabs from overwriting the default; remember view per tab

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: Clear the remembered view on sign-out (TDD)

**Files:**
- Modify: `src/auth/AuthProvider.tsx`
- Test: `src/auth/AuthProvider.test.tsx` (extend)

**Interfaces:**
- Consumes: `clearBoardView` (Task 1).
- Produces: on `SIGNED_OUT`, the stored board view is removed — so a subsequent sign-in reads no stored view and lands on the default.

- [ ] **Step 1: Write the failing test**

Append to `src/auth/AuthProvider.test.tsx` (it already defines the hoisted `h` mock, `wrapper`, and imports `act`, `renderHook`, `waitFor`):

```tsx
test('SIGNED_OUT clears the remembered board view', async () => {
  sessionStorage.setItem('ma-board-view', 'week')
  const { result } = renderHook(() => useAuth(), { wrapper })
  await waitFor(() => expect(result.current.loading).toBe(false))
  act(() => h.capture.handler!('SIGNED_OUT', null))
  expect(sessionStorage.getItem('ma-board-view')).toBeNull()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/auth/AuthProvider.test.tsx`
Expected: the new test FAILS — `ma-board-view` survives `SIGNED_OUT`.

- [ ] **Step 3: Implement**

In `src/auth/AuthProvider.tsx`:

1. Add the import:

```ts
import { clearBoardView } from '../lib/viewStorage'
```

2. In the existing `SIGNED_OUT` branch of the `onAuthStateChange` callback, add `clearBoardView()`:

```ts
      // A recovery flow abandoned before setting a new password must not haunt the next sign-in.
      if (event === 'SIGNED_OUT') {
        sessionStorage.removeItem(RECOVERY_FLAG_KEY)
        setPasswordRecovery(false)
        // Next sign-in should land on the default view, not the signed-out user's last view.
        clearBoardView()
      }
```

- [ ] **Step 4: Run tests + full gate**

Run: `npx vitest run src/auth/AuthProvider.test.tsx` → all PASS.
Run: `npm test && npm run lint && npm run build` → green.
Run: `npx prettier --check src/auth/AuthProvider.tsx src/auth/AuthProvider.test.tsx` (→ `--write` + re-test if it warns).

- [ ] **Step 5: Commit**

```bash
git add src/auth/AuthProvider.tsx src/auth/AuthProvider.test.tsx
git commit -m "Clear the remembered board view on sign-out

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: CHANGELOG + PR

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: CHANGELOG entry**

Under `## [Unreleased]`, add a `### Changed` subsection (create it if absent — place it after `### Added` if that exists, else first) with:

```markdown
- **Theme lives in Settings; the default view is stable** — the cork/brutal/glass switcher moved
  out of the toolbar into Settings → Appearance (theme still syncs live across devices).
  Switching view tabs no longer changes your saved default view — the default is set only in
  Settings and is the view you land on when you open the app; the view you pick during a session
  is remembered for that tab (across refreshes) and resets on a new tab or sign-out.
```

- [ ] **Step 2: Full verification**

Run: `npm test && npm run lint && npm run build` → all green.

- [ ] **Step 3: Commit, push, PR**

```bash
git add CHANGELOG.md
git commit -m "Add settings-only-theme / stable-default-view changelog entry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin feat/settings-only-theme-view
gh pr create --title "Settings-only theme + stable default view" --body "$(cat <<'EOF'
Pre-Phase-2 behavior change (no schema):
- Theme switcher removed from the toolbar; it lives only in Settings → Appearance. Live cross-device theme sync is unchanged (only the in-board control moved, not the applier).
- View tabs no longer overwrite user_settings.default_view. The Settings picker is now the sole writer of the default view.
- The board seeds its view from the Settings default at login, remembers the current view per tab via sessionStorage (survives a refresh, resets on a new tab), and clears it on sign-out so a re-login lands on the default.

Spec: docs/specs/2026-07-05-settings-theme-and-default-view-design.md.

## Manual check
- [ ] Switch views, refresh → stays put; open a new tab → default view; change the default in Settings → next new tab reflects it; sign out and back in → default view.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Merge when green.

---

## Self-review checklist (completed by the plan author)

- **Spec coverage:** Part 1 (theme → Settings only) → Task 2 + BoardPage's `ThemeProvider` left intact (Task 3 confirms only `saveView` is dropped, `saveTheme`/`ThemeProvider` untouched). Part 2 (stop persisting on switch, remember per tab, clear on sign-out) → Tasks 1/3/4. `viewStorage.ts` + all five files-touched from the spec are covered. The spec's test list maps: `viewStorage.test.ts` (T1), Board mount/switch tests (T3), `Toolbar.test.tsx` still-green check (T2), `SettingsPage.test.tsx` unchanged (noted, no task needed — it's already the sole persister after T3), `AuthProvider.test.tsx` SIGNED_OUT clear (T4).
- **Placeholder scan:** none — every code step shows complete code; every command has an expected result.
- **Type consistency:** `readBoardView`/`writeBoardView`/`clearBoardView` signatures identical across T1 (definition), T3 (read+write), T4 (clear); key string `'ma-board-view'` identical in `viewStorage.ts`, the Board tests, and the AuthProvider test; `ViewName` union matches `isViewName`'s guard.
- **Deliberate decisions restated for reviewers:** `ThemeProvider.onThemeChange={saveTheme}` intentionally kept in BoardPage (harmless, avoids touching the realtime-tested theme path); `initialView={settings.defaultView}` kept as the login landing; global `setup.ts` sessionStorage clear added to prevent cross-test view pollution (a real risk once view switches write storage).
