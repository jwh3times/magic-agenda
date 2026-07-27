# Installable PWA + Offline Read — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Magic Agenda installable to a home screen and able to show your board with no
network, read-only.

**Architecture:** A service worker we author (`src/sw.ts`) with `vite-plugin-pwa` supplying only the
revisioned precache list; navigations are network-first so a bad deploy stays fixable by merging.
Board and settings snapshots live in `localStorage` behind a versioned module, written after state
settles and read when a load fails. Offline puts the board in read-only mode through a context that
reuses the existing `DragDisabledContext`.

**Tech Stack:** React 19 + TypeScript, Vite, Vitest + Testing Library (jsdom), Supabase JS,
`vite-plugin-pwa` (devDependency only), Cloudflare Pages.

**Spec:** `docs/specs/2026-07-27-installable-pwa-offline-design.md`. Read it first.

## Global Constraints

- **No new runtime dependencies.** `vite-plugin-pwa` goes in `devDependencies`. The shipped worker
  imports no workbox runtime helpers — only `self.__WB_MANIFEST`.
- **Never cache `*.supabase.co` in the worker**, over `https:` or `wss:`. This is enforced by a test,
  not a comment.
- **Navigations are network-first**, cache fallback. Hashed assets are cache-first.
- **Manifest `name` must be exactly `Magic Agenda`** — it has to match the OAuth consent screen and
  the `index.html` noscript block, per the comment there. Google's branding review is why.
- **Every storage access is `try`/`catch`-wrapped and best-effort.** Losing a snapshot degrades
  offline; it never breaks the app. Follow `src/lib/viewStorage.ts`.
- **Prettier:** no semicolons, single quotes, `printWidth` 100, trailing commas. Run
  `npx prettier --write` on touched files before each commit; `npm run format:check` covers
  `src/**` only, so markdown must be formatted by hand-run.
- **Test-first** for `src/data`, `src/lib`, `src/sw`. Mobile-layout branches stub `matchMedia`.
- **`main` is PR-only.** Work on `feat/pwa-offline`. The final task adds the `CHANGELOG.md` section;
  get the version from `node scripts/next-version.mjs` at that point, not now.
- **One deliberate deviation from the spec:** the spec calls the read-only context
  `ReadOnlyContext`. This plan names it `OfflineContext` and gives it `{ readOnly, savedAt }`,
  because the banner needs `savedAt` and a second context for one number is worse. Everything else
  matches the spec.

---

### Task 1: Snapshot module

**Files:**

- Create: `src/data/snapshot.ts`
- Create: `src/data/snapshot.test.ts`
- Modify: `src/test/setup.ts`

**Interfaces:**

- Consumes: `Task` from `src/types/task.ts`, `Settings` from `src/data/useSettings.ts`
- Produces:
  - `readBoardSnapshot(userId: string): BoardSnapshot | null`
  - `writeBoardSnapshot(userId: string, tasks: Task[], templates: Task[]): void`
  - `hasBoardSnapshot(userId: string): boolean`
  - `readSettingsSnapshot(userId: string): SettingsSnapshot | null`
  - `writeSettingsSnapshot(userId: string, settings: Settings): void`
  - `clearSnapshots(): void`
  - `interface BoardSnapshot { v: 1; userId: string; savedAt: number; tasks: Task[]; templates: Task[] }`
  - `interface SettingsSnapshot { v: 1; userId: string; settings: Settings }`

- [ ] **Step 1: Make tests isolated from `localStorage`**

`src/test/setup.ts` clears `sessionStorage` only. Snapshots live in `localStorage`, so without this
one test's snapshot leaks into the next. Replace the `afterEach` body:

```ts
afterEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})
```

- [ ] **Step 2: Write the failing tests**

Create `src/data/snapshot.test.ts`:

```ts
import { afterEach, expect, test, vi } from 'vitest'
import { NO_RECUR, type Task } from '../types/task'
import {
  clearSnapshots,
  hasBoardSnapshot,
  readBoardSnapshot,
  readSettingsSnapshot,
  writeBoardSnapshot,
  writeSettingsSnapshot,
} from './snapshot'

const task = (id: string): Task => ({
  id,
  title: id,
  description: '',
  category: 'work',
  color: 'yellow',
  checklist: [],
  status: 'todo',
  done: false,
  day: '2026-07-27',
  atTime: null,
  pinned: false,
  order: 0,
  korder: 0,
  ...NO_RECUR,
})

afterEach(() => vi.restoreAllMocks())

test('round-trips the board for the same user', () => {
  writeBoardSnapshot('u1', [task('a')], [task('t')])
  const snap = readBoardSnapshot('u1')
  expect(snap?.tasks.map((t) => t.id)).toEqual(['a'])
  expect(snap?.templates.map((t) => t.id)).toEqual(['t'])
  expect(snap?.savedAt).toBeGreaterThan(0)
})

test('templates are stored separately from board tasks', () => {
  writeBoardSnapshot('u1', [task('a')], [task('t')])
  expect(readBoardSnapshot('u1')?.tasks.some((t) => t.id === 't')).toBe(false)
})

test('refuses a snapshot belonging to another user', () => {
  writeBoardSnapshot('u1', [task('a')], [])
  expect(readBoardSnapshot('u2')).toBeNull()
  expect(hasBoardSnapshot('u2')).toBe(false)
})

test('refuses an envelope from an older version', () => {
  localStorage.setItem('ma-snapshot-board', JSON.stringify({ v: 0, userId: 'u1', tasks: [] }))
  expect(readBoardSnapshot('u1')).toBeNull()
})

test('refuses a payload whose shape is wrong', () => {
  localStorage.setItem('ma-snapshot-board', JSON.stringify({ v: 1, userId: 'u1', tasks: 'nope' }))
  expect(readBoardSnapshot('u1')).toBeNull()
})

test('survives unparseable JSON', () => {
  localStorage.setItem('ma-snapshot-board', '{{{')
  expect(readBoardSnapshot('u1')).toBeNull()
})

test('an empty user id never reads or writes', () => {
  writeBoardSnapshot('', [task('a')], [])
  expect(localStorage.getItem('ma-snapshot-board')).toBeNull()
  expect(readBoardSnapshot('')).toBeNull()
})

test('a failed write is swallowed', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError')
  })
  expect(() => writeBoardSnapshot('u1', [task('a')], [])).not.toThrow()
})

test('settings round-trip and clear together with the board', () => {
  writeBoardSnapshot('u1', [task('a')], [])
  writeSettingsSnapshot('u1', { theme: 'glass', defaultView: 'kanban' })
  expect(readSettingsSnapshot('u1')?.settings.theme).toBe('glass')
  clearSnapshots()
  expect(readBoardSnapshot('u1')).toBeNull()
  expect(readSettingsSnapshot('u1')).toBeNull()
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/data/snapshot.test.ts`
Expected: FAIL — `Failed to resolve import "./snapshot"`.

- [ ] **Step 4: Write the implementation**

Create `src/data/snapshot.ts`:

```ts
import type { Task } from '../types/task'
import type { Settings } from './useSettings'

// Last-known board + settings, so the app can render read-only with no network.
// Best-effort like viewStorage.ts: every access is guarded, and losing a snapshot only
// degrades the offline experience. Cleared on sign-out (see AuthProvider) — that clearing
// is what makes storing task text at rest acceptable.
const BOARD_KEY = 'ma-snapshot-board'
const SETTINGS_KEY = 'ma-snapshot-settings'

// Bump on any shape change. A mismatched envelope is dropped, never migrated.
const V = 1

export interface BoardSnapshot {
  v: typeof V
  userId: string
  savedAt: number
  tasks: Task[]
  templates: Task[]
}

export interface SettingsSnapshot {
  v: typeof V
  userId: string
  settings: Settings
}

function readEnvelope(key: string, userId: string): Record<string, unknown> | null {
  if (!userId) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const env = parsed as Record<string, unknown>
    if (env.v !== V || env.userId !== userId) return null
    return env
  } catch {
    return null
  }
}

function write(key: string, userId: string, value: object): void {
  if (!userId) return
  try {
    localStorage.setItem(key, JSON.stringify({ v: V, userId, ...value }))
  } catch {
    // Quota exceeded or storage unavailable (privacy mode) — the snapshot is best-effort.
  }
}

export function readBoardSnapshot(userId: string): BoardSnapshot | null {
  const env = readEnvelope(BOARD_KEY, userId)
  if (!env || !Array.isArray(env.tasks) || !Array.isArray(env.templates)) return null
  if (typeof env.savedAt !== 'number') return null
  return env as unknown as BoardSnapshot
}

export function hasBoardSnapshot(userId: string): boolean {
  return readBoardSnapshot(userId) !== null
}

export function writeBoardSnapshot(userId: string, tasks: Task[], templates: Task[]): void {
  write(BOARD_KEY, userId, { savedAt: Date.now(), tasks, templates })
}

export function readSettingsSnapshot(userId: string): SettingsSnapshot | null {
  const env = readEnvelope(SETTINGS_KEY, userId)
  if (!env || !env.settings || typeof env.settings !== 'object') return null
  return env as unknown as SettingsSnapshot
}

export function writeSettingsSnapshot(userId: string, settings: Settings): void {
  write(SETTINGS_KEY, userId, { settings })
}

export function clearSnapshots(): void {
  try {
    localStorage.removeItem(BOARD_KEY)
    localStorage.removeItem(SETTINGS_KEY)
  } catch {
    // ignore
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/data/snapshot.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/data/snapshot.ts src/data/snapshot.test.ts src/test/setup.ts
git add src/data/snapshot.ts src/data/snapshot.test.ts src/test/setup.ts
git commit -m "feat: versioned localStorage snapshot of the board and settings"
```

---

### Task 2: `useOnline` hook

**Files:**

- Create: `src/lib/useOnline.ts`
- Create: `src/lib/useOnline.test.ts`

**Interfaces:**

- Consumes: nothing
- Produces: `useOnline(): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/lib/useOnline.test.ts`:

```ts
import { renderHook, act } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { useOnline } from './useOnline'

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true })
}

afterEach(() => setOnLine(true))

test('reports online by default', () => {
  const { result } = renderHook(() => useOnline())
  expect(result.current).toBe(true)
})

test('reacts to the offline and online events', () => {
  const { result } = renderHook(() => useOnline())
  act(() => {
    setOnLine(false)
    window.dispatchEvent(new Event('offline'))
  })
  expect(result.current).toBe(false)
  act(() => {
    setOnLine(true)
    window.dispatchEvent(new Event('online'))
  })
  expect(result.current).toBe(true)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/useOnline.test.ts`
Expected: FAIL — `Failed to resolve import "./useOnline"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/useOnline.ts`:

```ts
import { useCallback, useSyncExternalStore } from 'react'

// Same shape as useMediaQuery: an external store React can subscribe to, so components
// branch on connectivity in JSX rather than through an effect + state pair.

function canDetect(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
}

/**
 * Reactive connectivity. Returns **true** where `navigator.onLine` is unavailable, so an
 * environment that cannot report it behaves exactly as the app does today.
 *
 * `navigator.onLine` is a hint, not a guarantee — a captive portal reports "online". That is
 * acceptable here: it drives read-only mode and a banner, and a failed request re-enters the
 * offline path anyway.
 */
export function useOnline(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener('online', onChange)
    window.addEventListener('offline', onChange)
    return () => {
      window.removeEventListener('online', onChange)
      window.removeEventListener('offline', onChange)
    }
  }, [])
  return useSyncExternalStore(subscribe, () => (canDetect() ? navigator.onLine : true))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/useOnline.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/useOnline.ts src/lib/useOnline.test.ts
git add src/lib/useOnline.ts src/lib/useOnline.test.ts
git commit -m "feat: reactive useOnline hook"
```

---

### Task 3: Settings survive a failed load

Fixes the defect in the spec's "The prerequisite defect": `useSettings` reads only `data`, so a
failed request and "no row yet" take the same branch and silently reset the user's theme.

**Files:**

- Modify: `src/data/useSettings.ts:38-55` (load), `:87-108` (persist), `:60-85` (realtime)
- Modify: `src/data/useSettings.test.ts`

**Interfaces:**

- Consumes: `readSettingsSnapshot`, `writeSettingsSnapshot` from Task 1
- Produces: no signature change — `UseSettings` is unchanged

- [ ] **Step 1: Make the existing mock's query result settable per test**

`src/data/useSettings.test.ts:16` hard-codes the resolved row inside `vi.hoisted`. Move it onto the
existing `capture` object so a test can vary it. In the `vi.hoisted` block, replace the
`maybeSingle` and `capture` declarations with:

```ts
const capture: {
  handler: ((p: unknown) => void) | null
  result: { data: unknown; error: unknown }
} = {
  handler: null,
  result: { data: { theme: 'cork', default_view: 'calendar' }, error: null },
}
const maybeSingle = vi.fn(() => Promise.resolve(capture.result))
```

and extend the existing `beforeEach` so one test's error cannot leak into the next:

```ts
beforeEach(() => {
  h.upsertThen.mockClear()
  h.upsert.mockClear()
  h.capture.result = { data: { theme: 'cork', default_view: 'calendar' }, error: null }
})
```

- [ ] **Step 2: Write the failing tests**

Append to `src/data/useSettings.test.ts`:

```ts
test('a failed load falls back to the snapshot, not to DEFAULTS', async () => {
  localStorage.setItem(
    'ma-snapshot-settings',
    JSON.stringify({ v: 1, userId: 'u1', settings: { theme: 'glass', defaultView: 'kanban' } }),
  )
  h.capture.result = { data: null, error: { message: 'FetchError: Failed to fetch' } }
  const { result } = renderHook(() => useSettings('u1'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.settings).toEqual({ theme: 'glass', defaultView: 'kanban' })
})

test('a failed load with no snapshot falls back to DEFAULTS', async () => {
  h.capture.result = { data: null, error: { message: 'FetchError: Failed to fetch' } }
  const { result } = renderHook(() => useSettings('u1'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.settings).toEqual({ theme: 'cork', defaultView: 'calendar' })
})

test('a genuinely empty row still means DEFAULTS, and is snapshotted', async () => {
  h.capture.result = { data: null, error: null }
  const { result } = renderHook(() => useSettings('u1'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.settings).toEqual({ theme: 'cork', defaultView: 'calendar' })
  expect(JSON.parse(localStorage.getItem('ma-snapshot-settings')!).settings.theme).toBe('cork')
})

test('saving a theme updates the snapshot', async () => {
  const { result } = renderHook(() => useSettings('u1'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  act(() => result.current.saveTheme('brutal'))
  expect(JSON.parse(localStorage.getItem('ma-snapshot-settings')!).settings.theme).toBe('brutal')
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/data/useSettings.test.ts`
Expected: FAIL — the snapshot test gets `cork`/`calendar` because the error branch does not exist.

- [ ] **Step 4: Write the implementation**

In `src/data/useSettings.ts`, add the import and a single `apply` helper, then route all three
places that set settings through it.

```ts
import { readSettingsSnapshot, writeSettingsSnapshot } from './snapshot'
```

Inside the hook, above the load effect:

```ts
// The one place settings become current: keeps the ref, React state, and the offline
// snapshot in step, so no caller can update two of the three and forget the last.
const apply = useCallback(
  (next: Settings, persistSnapshot = true) => {
    ref.current = next
    setSettings(next)
    if (persistSnapshot) writeSettingsSnapshot(userId, next)
  },
  [userId],
)
```

Replace the load's `.then` body:

```ts
.then(({ data, error }) => {
  if (!active) return
  if (error) {
    // A failed request is NOT "no row yet" — postgrest resolves with { data: null, error }
    // rather than rejecting, so treating them alike would silently reset the user's theme
    // to DEFAULTS on every offline boot. Fall back to the last known settings instead, and
    // do not re-snapshot: nothing new was learned.
    apply(readSettingsSnapshot(userId)?.settings ?? DEFAULTS, false)
    setLoading(false)
    return
  }
  apply(
    data
      ? { theme: data.theme as ThemeName, defaultView: data.default_view as ViewName }
      : DEFAULTS,
  )
  setLoading(false)
})
```

In the realtime handler, replace `ref.current = next; setSettings(next)` with `apply(next)`. In
`persist`, replace `ref.current = next; setSettings(next)` with `apply(next)`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/data/useSettings.test.ts`
Expected: PASS, including the pre-existing tests.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/data/useSettings.ts src/data/useSettings.test.ts
git add src/data/useSettings.ts src/data/useSettings.test.ts
git commit -m "fix: a failed settings load no longer silently resets the user's theme"
```

---

### Task 4: Board snapshot write + offline hydration

**Files:**

- Modify: `src/data/useTasks.ts:17-44` (interface), `:74-80` (state), `:150-177` (reload + effect)
- Modify: `src/data/useTasks.test.ts`

**Interfaces:**

- Consumes: `readBoardSnapshot`, `writeBoardSnapshot` from Task 1
- Produces: `UseTasks` gains `offline: boolean` and `savedAt: number | null`

- [ ] **Step 1: Write the failing tests**

Append to `src/data/useTasks.test.ts`. The existing mock resolves `select` with
`{ data: h.capture.rows, error: null }`; add a mutable error so a test can force the offline path.
Extend the `vi.hoisted` block with `capture.selectError = null` and change the mock's `select` to
`Promise.resolve({ data: h.capture.rows, error: h.capture.selectError })`.

```ts
test('a failed load hydrates from the snapshot and materializes nothing', async () => {
  localStorage.setItem(
    'ma-snapshot-board',
    JSON.stringify({
      v: 1,
      userId: 'u1',
      savedAt: 1_770_000_000_000,
      tasks: [{ ...serverTask(), id: 'cached' }],
      templates: [{ ...serverTask(), id: 'tmpl', recurFreq: 'daily', recurParentId: null }],
    }),
  )
  h.capture.selectError = { message: 'FetchError: Failed to fetch' }

  const { result } = renderHook(() => useTasks('u1'))

  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.tasks.map((t) => t.id)).toEqual(['cached'])
  expect(result.current.offline).toBe(true)
  expect(result.current.savedAt).toBe(1_770_000_000_000)
  expect(result.current.error).toBeNull()
  // The dangerous one: materialize() inserts rows, and running it over snapshot state
  // risks duplicate instances against tasks_recur_instance_uniq (23505).
  expect(h.insert).not.toHaveBeenCalled()
})

test('a failed load with no snapshot still surfaces the error', async () => {
  h.capture.selectError = { message: 'FetchError: Failed to fetch' }
  const { result } = renderHook(() => useTasks('u1'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.offline).toBe(false)
  expect(result.current.error).toContain('Failed to fetch')
})

test('a successful load writes a snapshot', async () => {
  h.capture.rows = [serverRow()]
  const { result } = renderHook(() => useTasks('u1'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  await waitFor(() => expect(localStorage.getItem('ma-snapshot-board')).not.toBeNull())
  const snap = JSON.parse(localStorage.getItem('ma-snapshot-board')!)
  expect(snap.userId).toBe('u1')
  expect(snap.tasks).toHaveLength(1)
})

test('reconnecting clears offline mode', async () => {
  localStorage.setItem(
    'ma-snapshot-board',
    JSON.stringify({ v: 1, userId: 'u1', savedAt: 1, tasks: [], templates: [] }),
  )
  h.capture.selectError = { message: 'FetchError: Failed to fetch' }
  const { result } = renderHook(() => useTasks('u1'))
  await waitFor(() => expect(result.current.offline).toBe(true))

  h.capture.selectError = null
  h.capture.rows = [serverRow()]
  act(() => {
    window.dispatchEvent(new Event('online'))
  })
  await waitFor(() => expect(result.current.offline).toBe(false))
  expect(result.current.tasks).toHaveLength(1)
})
```

The file has `serverRow()` (a DB row) but no app-domain equivalent, so add one beside it — the
snapshot stores `Task` objects, not rows:

```ts
import { rowToTask } from './mappers'

const serverTask = (over: Record<string, unknown> = {}) => rowToTask(serverRow(over))
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/useTasks.test.ts`
Expected: FAIL — `result.current.offline` is `undefined`.

- [ ] **Step 3: Write the implementation**

In `src/data/useTasks.ts`, add to the imports:

```ts
import { readBoardSnapshot, writeBoardSnapshot } from './snapshot'
```

Add to the `UseTasks` interface:

```ts
/** True when the board is hydrated from the offline snapshot: reads work, writes are blocked. */
offline: boolean
/** When that snapshot was taken (epoch ms), for the offline banner. Null when online. */
savedAt: number | null
```

Add state beside the existing `useState` calls:

```ts
const [offline, setOffline] = useState(false)
const [savedAt, setSavedAt] = useState<number | null>(null)
```

Add the hydration helper above `reload`:

```ts
/**
 * Fall back to the last-known board. Deliberately does NOT materialize: materialize()
 * inserts rows, and running it against snapshot-hydrated state on a flaky connection can
 * duplicate instances and hit tasks_recur_instance_uniq (23505). Offline is read-only, so
 * there is nothing to materialize for anyway.
 */
const hydrateFromSnapshot = useCallback(() => {
  const snap = readBoardSnapshot(userId)
  if (!snap) return false
  templatesRef.current = snap.templates
  setTasks(snap.tasks)
  setSavedAt(snap.savedAt)
  setOffline(true)
  setError(null)
  return true
}, [userId, setTasks])
```

Rewrite the body of `reload` (keep the `inFlight` guard and `finally` exactly as they are):

```ts
try {
  const { data, error: err } = await supabase.from('tasks').select('*')
  if (err) {
    if (hydrateFromSnapshot()) return
    setError(err.message)
    return
  }
  const all = (data ?? []).map(rowToTask)
  templatesRef.current = all.filter(isTemplate)
  const instances = all.filter((t) => !isTemplate(t))
  setOffline(false)
  setSavedAt(null)
  setTasks(instances)
  // Pass the freshly-loaded instances directly: tasksRef.current is not yet updated here.
  await materialize(templatesRef.current, instances)
} catch (e) {
  // postgrest resolves fetch failures rather than throwing, so this is defensive: a future
  // .throwOnError() must not turn an offline boot into an unhandled rejection.
  if (hydrateFromSnapshot()) return
  setError(errorMessage(e))
} finally {
  setLoading(false)
  inFlight.current = false
}
```

Add `hydrateFromSnapshot` to `reload`'s dependency array.

Add the debounced snapshot writer after the load effect:

```ts
// Persist the board for offline reads. Debounced because optimistic CRUD churns `tasks`;
// a rolled-back write re-renders the restored state and the next tick writes that, so this
// is self-correcting and needs no "confirmed" bookkeeping. Suppressed while offline so
// savedAt never claims to be fresher than the data.
useEffect(() => {
  if (!userId || offline || loading) return
  const id = window.setTimeout(() => {
    writeBoardSnapshot(userId, tasksRef.current, templatesRef.current)
  }, 1000)
  return () => window.clearTimeout(id)
}, [userId, offline, loading, tasks])
```

Add `offline` and `savedAt` to the returned object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/useTasks.test.ts`
Expected: PASS. If the snapshot-write test times out, the debounce is the cause — use
`vi.useFakeTimers()` and advance 1000ms, or raise the `waitFor` timeout to 2000.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/data/useTasks.ts src/data/useTasks.test.ts
git add src/data/useTasks.ts src/data/useTasks.test.ts
git commit -m "feat: hydrate the board from a snapshot when the load fails"
```

---

### Task 5: Offline auth

Offline past the 1-hour token lifetime, supabase-js may drop the session and `ProtectedRoute` sends
the user to a login form that cannot submit. Also wires snapshot clearing to sign-out.

**Files:**

- Create: `src/lib/lastUser.ts`
- Create: `src/lib/lastUser.test.ts`
- Modify: `src/auth/AuthProvider.tsx:30-59`
- Modify: `src/auth/ProtectedRoute.tsx`
- Create: `src/auth/ProtectedRoute.test.tsx`
- Modify: `src/pages/BoardPage.tsx:15`, `src/data/SettingsProvider.tsx:25`

**Interfaces:**

- Consumes: `hasBoardSnapshot`, `clearSnapshots` (Task 1); `useOnline` (Task 2)
- Produces: `readLastUserId(): string`, `writeLastUserId(id: string): void`,
  `clearLastUserId(): void`

- [ ] **Step 1: Write the failing test for `lastUser`**

Create `src/lib/lastUser.test.ts`:

```ts
import { expect, test } from 'vitest'
import { clearLastUserId, readLastUserId, writeLastUserId } from './lastUser'

test('round-trips the id and clears it', () => {
  expect(readLastUserId()).toBe('')
  writeLastUserId('u1')
  expect(readLastUserId()).toBe('u1')
  clearLastUserId()
  expect(readLastUserId()).toBe('')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/lastUser.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lastUser`**

Create `src/lib/lastUser.ts`:

```ts
// The last signed-in user id, mirrored out of the session so an offline boot knows whose
// snapshot to read. Not a credential and not trusted for authorization — RLS is still the
// only authorization boundary, and every request offline fails anyway.
const KEY = 'ma-last-user'

export function readLastUserId(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function writeLastUserId(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // ignore
  }
}

export function clearLastUserId(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/lastUser.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `ProtectedRoute` test**

Create `src/auth/ProtectedRoute.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { ProtectedRoute } from './ProtectedRoute'

const auth = { session: null as unknown, loading: false, passwordRecovery: false }
vi.mock('./AuthProvider', () => ({ useAuth: () => auth }))

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true })
}

afterEach(() => {
  setOnLine(true)
  auth.session = null
})

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<ProtectedRoute>board</ProtectedRoute>} />
        <Route path="/login" element={<div>login</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('redirects to login when signed out and online', () => {
  renderAt()
  expect(screen.getByText('login')).toBeInTheDocument()
})

test('renders the board offline when a snapshot exists for the last user', () => {
  localStorage.setItem('ma-last-user', 'u1')
  localStorage.setItem(
    'ma-snapshot-board',
    JSON.stringify({ v: 1, userId: 'u1', savedAt: 1, tasks: [], templates: [] }),
  )
  setOnLine(false)
  renderAt()
  expect(screen.getByText('board')).toBeInTheDocument()
})

test('still redirects offline when there is no snapshot', () => {
  setOnLine(false)
  renderAt()
  expect(screen.getByText('login')).toBeInTheDocument()
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/auth/ProtectedRoute.test.tsx`
Expected: FAIL — the offline case redirects to login.

- [ ] **Step 7: Implement the auth changes**

`src/auth/ProtectedRoute.tsx` becomes:

```tsx
import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from './AuthProvider'
import { Spinner } from '../components/Spinner'
import { useOnline } from '../lib/useOnline'
import { hasBoardSnapshot } from '../data/snapshot'
import { readLastUserId } from '../lib/lastUser'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading, passwordRecovery } = useAuth()
  const online = useOnline()
  if (loading) return <Spinner />
  if (!session) {
    // supabase-js normally keeps a persisted session when a refresh fails on the network, but
    // it is free to drop one, and a login form that cannot reach the network is a dead end.
    // Render the last-known board read-only instead. Not an authorization decision: the data
    // is already on this device, and every write offline fails regardless.
    if (!online && hasBoardSnapshot(readLastUserId())) return <>{children}</>
    return <Navigate to="/login" replace />
  }
  // A recovery-link session must set a new password before reaching the board.
  if (passwordRecovery) return <Navigate to="/auth/reset" replace />
  return <>{children}</>
}
```

In `src/auth/AuthProvider.tsx`, import `clearSnapshots` and the `lastUser` helpers, mirror the id
wherever the session is set, and clear on sign-out:

```ts
import { clearSnapshots } from '../data/snapshot'
import { clearLastUserId, writeLastUserId } from '../lib/lastUser'
```

In the `getSession().then` callback, after `setSession(data.session)`:

```ts
if (data.session?.user.id) writeLastUserId(data.session.user.id)
```

In `onAuthStateChange`, after `setSession(next)`:

```ts
if (next?.user.id) writeLastUserId(next.user.id)
```

And inside the existing `if (event === 'SIGNED_OUT')` block, alongside `clearBoardView()`:

```ts
// Task text at rest is acceptable only because it does not outlive the session on this
// device. Account deletion signs out too, so it lands here as well.
clearSnapshots()
clearLastUserId()
```

In `src/pages/BoardPage.tsx`, the offline fallback needs a user id when there is no session:

```ts
const userId = user?.id ?? readLastUserId()
```

Make the same change in `src/data/SettingsProvider.tsx`:

```tsx
const value = useSettings(user?.id ?? readLastUserId())
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/auth src/lib/lastUser.test.ts`
Expected: PASS. Then `npm test` — `SettingsProvider.test.tsx` pins that a signed-out visitor fires
no query; confirm it still passes, since `readLastUserId()` is `''` for a visitor who never signed
in.

- [ ] **Step 9: Commit**

```bash
npx prettier --write src/lib/lastUser.ts src/lib/lastUser.test.ts src/auth/ProtectedRoute.tsx src/auth/ProtectedRoute.test.tsx src/auth/AuthProvider.tsx src/pages/BoardPage.tsx src/data/SettingsProvider.tsx
git add src/lib/lastUser.ts src/lib/lastUser.test.ts src/auth src/pages/BoardPage.tsx src/data/SettingsProvider.tsx
git commit -m "feat: an offline boot renders the last-known board instead of a dead login form"
```

---

### Task 6: Read-only mode and the offline banner

**Files:**

- Create: `src/data/offlineContext.ts`
- Create: `src/components/OfflineBanner.tsx`
- Modify: `src/pages/BoardPage.tsx`
- Modify: `src/components/Board.tsx:223` (provider value), and the `Toolbar` call at `:198-211`
- Modify: `src/components/Toolbar.tsx` (accept `addDisabled`)
- Modify: `src/components/TaskEditor.tsx` (accept `readOnly`)
- Modify: `src/components/Board.test.tsx`

**Interfaces:**

- Consumes: `UseTasks.offline` / `UseTasks.savedAt` (Task 4)
- Produces:
  - `interface OfflineState { readOnly: boolean; savedAt: number | null }`
  - `OfflineContext` with default `{ readOnly: false, savedAt: null }`

- [ ] **Step 1: Write the failing tests**

Add to `src/components/Board.test.tsx`, wrapping the existing harness in the provider:

The file already has `function Harness()` at `:15` and `const renderBoard = () => render(<Harness />)`
at `:38`. Add an offline variant beside it and two tests. Import `OfflineContext` from
`../data/offlineContext`. The add button's accessible name is `+ New task` (`Toolbar.tsx:73` mobile,
`:163` desktop).

```tsx
const renderOffline = () =>
  render(
    <OfflineContext.Provider
      value={{ readOnly: true, savedAt: Date.parse('2026-07-27T12:41:00Z') }}
    >
      <Harness />
    </OfflineContext.Provider>,
  )

test('offline shows a banner naming when the board was saved', () => {
  renderOffline()
  expect(screen.getByRole('status')).toHaveTextContent(/offline/i)
})

test('offline disables the add-task affordance', () => {
  renderOffline()
  expect(screen.getByRole('button', { name: '+ New task' })).toBeDisabled()
})

test('online leaves the board fully interactive', () => {
  renderBoard()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '+ New task' })).toBeEnabled()
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/components/Board.test.tsx`
Expected: FAIL — no `OfflineContext` export.

- [ ] **Step 3: Implement the context and banner**

Create `src/data/offlineContext.ts`:

```ts
import { createContext } from 'react'

export interface OfflineState {
  /** Writes are blocked: the board is hydrated from the snapshot, not from Supabase. */
  readOnly: boolean
  /** When that snapshot was taken (epoch ms). Null when online. */
  savedAt: number | null
}

// Board UI reads this instead of a prop chain, because read-only touches components at
// several depths (toolbar, cards, editor) that otherwise share no props.
export const OfflineContext = createContext<OfflineState>({ readOnly: false, savedAt: null })
```

Create `src/components/OfflineBanner.tsx`:

```tsx
export function OfflineBanner({ savedAt }: { savedAt: number | null }) {
  const when = savedAt
    ? new Date(savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null
  return (
    <div
      role="status"
      style={{
        margin: '0 12px 8px',
        padding: '8px 12px',
        borderRadius: 10,
        background: '#2a2414',
        color: '#ffe9b8',
        border: '1px solid #5a4a2a',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13.5,
        lineHeight: 1.4,
      }}
    >
      <strong style={{ fontWeight: 700 }}>Offline.</strong>{' '}
      {when ? `Showing your board as of ${when}.` : 'Showing your last synced board.'} Changes are
      disabled until you reconnect.
    </div>
  )
}
```

- [ ] **Step 4: Wire it through**

In `src/pages/BoardPage.tsx`, wrap the `<Board .../>` element:

```tsx
<OfflineContext.Provider value={{ readOnly: t.offline, savedAt: t.savedAt }}>
  <Board {...} />
</OfflineContext.Provider>
```

In `src/components/Board.tsx`:

```ts
const { readOnly, savedAt } = useContext(OfflineContext)
```

- Render `{readOnly && <OfflineBanner savedAt={savedAt} />}` immediately after `<Toolbar ... />`.
- Change the drag provider to `<DragDisabledContext.Provider value={filterActive || readOnly}>`.
- Pass `addDisabled={readOnly}` to `<Toolbar />`.
- Pass `readOnly={readOnly}` to `<TaskEditor />`.

In `src/components/Toolbar.tsx`, accept `addDisabled?: boolean` and set `disabled={addDisabled}` on
the add button, with `title={addDisabled ? 'Offline — changes are disabled' : undefined}`.

In `src/components/TaskEditor.tsx`, accept `readOnly?: boolean`; when true, set `disabled` on every
input/select/textarea and render neither the save nor the delete button. Keep the close button.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/Board.test.tsx`
Expected: PASS. Then `npm test` for the full suite.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/data/offlineContext.ts src/components/OfflineBanner.tsx src/components/Board.tsx src/components/Toolbar.tsx src/components/TaskEditor.tsx src/pages/BoardPage.tsx src/components/Board.test.tsx
git add src/data/offlineContext.ts src/components/OfflineBanner.tsx src/components src/pages/BoardPage.tsx
git commit -m "feat: read-only board and offline banner while hydrated from a snapshot"
```

---

### Task 7: Toast gains a tone and an action

**Files:**

- Modify: `src/components/Toast.tsx`
- Create: `src/components/Toast.test.tsx`
- Modify: `src/pages/BoardPage.tsx` (existing call site keeps today's behavior)

**Interfaces:**

- Produces: `Toast` props become
  `{ message: string; onDismiss: () => void; duration?: number; tone?: 'error' | 'info'; action?: { label: string; onClick: () => void } }`

- [ ] **Step 1: Write the failing test**

Create `src/components/Toast.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Toast } from './Toast'

test('error tone keeps the sync prefix', () => {
  render(<Toast message="boom" onDismiss={() => {}} />)
  expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t sync. boom')
})

test('info tone drops the prefix and can carry an action', async () => {
  const onClick = vi.fn()
  render(
    <Toast
      message="New version available."
      tone="info"
      action={{ label: 'Refresh', onClick }}
      onDismiss={() => {}}
    />,
  )
  expect(screen.getByRole('status')).not.toHaveTextContent('sync')
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  expect(onClick).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/Toast.test.tsx`
Expected: FAIL — `tone` is not a prop.

- [ ] **Step 3: Implement**

In `src/components/Toast.tsx`: add the two optional props; default `tone = 'error'`. Use
`role={tone === 'error' ? 'alert' : 'status'}`. Render the `Couldn’t sync.` prefix only for
`tone === 'error'`. Swap the palette for `info` (`background: '#14202a'`, `color: '#d9ecff'`,
`border: '1px solid #2a4a5a'`). Render the action button before the dismiss button when `action` is
present. Leave `duration` and the auto-dismiss effect untouched.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/components/Toast.test.tsx`
Expected: PASS, 2 tests. `npm test` to confirm the existing `BoardPage` call site is unaffected.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/components/Toast.tsx src/components/Toast.test.tsx
git add src/components/Toast.tsx src/components/Toast.test.tsx
git commit -m "feat: Toast supports an info tone and an action button"
```

---

### Task 8: Service worker caching policy

**Files:**

- Create: `src/sw/policy.ts`
- Create: `src/sw/policy.test.ts`

**Interfaces:**

- Produces:
  - `isNeverCached(url: URL): boolean`
  - `isCacheFirst(url: URL, origin: string): boolean`
  - `isNavigation(request: { mode: string; destination: string }): boolean`

- [ ] **Step 1: Write the failing tests**

Create `src/sw/policy.test.ts`:

```ts
import { expect, test } from 'vitest'
import { isCacheFirst, isNavigation, isNeverCached } from './policy'

const APP = 'https://magicagenda.app'

test('Supabase is never cached, over https or wss', () => {
  expect(isNeverCached(new URL('https://abc.supabase.co/rest/v1/tasks?select=*'))).toBe(true)
  expect(isNeverCached(new URL('wss://abc.supabase.co/realtime/v1/websocket'))).toBe(true)
  expect(isNeverCached(new URL('https://supabase.co/anything'))).toBe(true)
})

test('a lookalike host is not treated as Supabase, and is not cached either', () => {
  expect(isNeverCached(new URL('https://notsupabase.co/x'))).toBe(false)
  expect(isCacheFirst(new URL('https://notsupabase.co/x'), APP)).toBe(false)
})

test('Supabase is never cache-first even though it is same-scheme', () => {
  expect(isCacheFirst(new URL('https://abc.supabase.co/rest/v1/tasks'), APP)).toBe(false)
})

test('hashed build assets are cache-first', () => {
  expect(isCacheFirst(new URL(`${APP}/assets/index-B7xK2p.js`), APP)).toBe(true)
  expect(isCacheFirst(new URL(`${APP}/assets/index-9fA1.css`), APP)).toBe(true)
})

test('the HTML shell is not cache-first', () => {
  expect(isCacheFirst(new URL(`${APP}/index.html`), APP)).toBe(false)
  expect(isCacheFirst(new URL(`${APP}/`), APP)).toBe(false)
})

test('Google Fonts are cache-first', () => {
  expect(isCacheFirst(new URL('https://fonts.googleapis.com/css2?family=Caveat'), APP)).toBe(true)
  expect(isCacheFirst(new URL('https://fonts.gstatic.com/s/caveat/x.woff2'), APP)).toBe(true)
})

test('a cross-origin asset that is not a font is not cache-first', () => {
  expect(isCacheFirst(new URL('https://evil.example/assets/x.js'), APP)).toBe(false)
})

test('navigations are detected by mode or destination', () => {
  expect(isNavigation({ mode: 'navigate', destination: '' })).toBe(true)
  expect(isNavigation({ mode: 'cors', destination: 'document' })).toBe(true)
  expect(isNavigation({ mode: 'cors', destination: 'script' })).toBe(false)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/sw/policy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/sw/policy.ts`:

```ts
// Caching policy as pure predicates. It lives apart from sw.ts because a service worker
// cannot run in jsdom, and this is the part that must not be wrong: a Supabase response in
// a cache shared by every profile on the device would leak one user's board to another.

const SUPABASE_HOST = /(^|\.)supabase\.co$/i
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com'])

/** Auth-scoped data. Never written to any cache, over any scheme. */
export function isNeverCached(url: URL): boolean {
  return SUPABASE_HOST.test(url.hostname)
}

/**
 * Immutable by construction (content-hashed build assets) or safe to serve stale (fonts).
 * Everything else — including the HTML shell — goes to the network first.
 */
export function isCacheFirst(url: URL, origin: string): boolean {
  if (isNeverCached(url)) return false
  if (FONT_HOSTS.has(url.hostname)) return true
  return url.origin === origin && url.pathname.startsWith('/assets/')
}

export function isNavigation(request: { mode: string; destination: string }): boolean {
  return request.mode === 'navigate' || request.destination === 'document'
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/sw/policy.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/sw/policy.ts src/sw/policy.test.ts
git add src/sw
git commit -m "feat: service-worker caching policy as tested predicates"
```

---

### Task 9: Maskable icon and PNG assets

**Files:**

- Create: `public/icon-maskable.svg`
- Create: `scripts/gen-icons.mjs`
- Create: `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png`

**Interfaces:**

- Produces: the three PNG paths the manifest in Task 10 references.

- [ ] **Step 1: Author the maskable SVG**

`public/favicon.svg` insets its tile by 16px with a 116px radius, so an Android mask would show
transparent corners. Create `public/icon-maskable.svg` as a copy with two changes: the tile becomes
full-bleed, and the artwork is scaled to sit inside the 80% safe circle.

```xml
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Magic Agenda app icon">
  <!-- Maskable variant of favicon.svg: full-bleed background (a mask clips the shape, so any
       transparent margin shows through), artwork scaled to 78% about the centre so it stays
       inside the 80% safe circle every mask shape is guaranteed to keep. -->
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7A4FE0"/>
      <stop offset="1" stop-color="#4A2A86"/>
    </linearGradient>
    <linearGradient id="spark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFD46B"/>
      <stop offset="1" stop-color="#FFA920"/>
    </linearGradient>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="9"/>
    </filter>
  </defs>

  <rect x="0" y="0" width="512" height="512" fill="url(#tile)"/>

  <g transform="translate(256 256) scale(0.78) translate(-256 -256)">
    <g transform="rotate(-8 256 268) translate(0 16)">
      <rect x="150" y="156" width="212" height="224" rx="26" fill="#1E0F45" fill-opacity="0.38" filter="url(#soft)"/>
    </g>
    <g transform="rotate(-8 256 268)">
      <rect x="150" y="156" width="212" height="224" rx="26" fill="#FFFDF6"/>
      <rect x="180" y="206" width="120" height="18" rx="9" fill="#FFB020"/>
      <rect x="180" y="248" width="152" height="16" rx="8" fill="#D9D2EA"/>
      <rect x="180" y="286" width="120" height="16" rx="8" fill="#D9D2EA"/>
      <rect x="180" y="322" width="30" height="30" rx="8" fill="#EFE9FA"/>
      <path d="M187 337 l7 7 l11 -14" fill="none" stroke="#7A4FE0" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="222" y="330" width="96" height="15" rx="7.5" fill="#D9D2EA"/>
    </g>
    <path d="M372 120 Q372 168 420 168 Q372 168 372 216 Q372 168 324 168 Q372 168 372 120 Z" fill="url(#spark)"/>
    <path d="M330 92 Q330 110 348 110 Q330 110 330 128 Q330 110 312 110 Q330 110 330 92 Z" fill="#FFE39A"/>
  </g>
</svg>
```

- [ ] **Step 2: Write the generator script**

Create `scripts/gen-icons.mjs`. It is committed for reproducibility but adds no dependency to
`package.json` — it is run through `npx -p sharp`.

```js
// Renders the PWA icon PNGs from the two committed SVGs.
// Run:  npx -y -p sharp@0.34 node scripts/gen-icons.mjs
// Not a build step and not a devDependency: the PNGs are committed, and this exists so the
// next person can regenerate them after editing the SVGs.
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const jobs = [
  ['public/favicon.svg', 'public/icon-192.png', 192],
  ['public/favicon.svg', 'public/icon-512.png', 512],
  ['public/icon-maskable.svg', 'public/icon-maskable-512.png', 512],
]

for (const [src, out, size] of jobs) {
  const png = await sharp(readFileSync(src), { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
  writeFileSync(out, png)
  console.log(`${out} ${size}x${size} ${png.length} bytes`)
}
```

- [ ] **Step 3: Generate the PNGs**

Run: `npx -y -p sharp@0.34 node scripts/gen-icons.mjs`

If sharp cannot rasterize the SVG on this machine (its librsvg support is a build-time option), fall
back to `npx -y @resvg/resvg-js-cli` or a headless-Chrome screenshot at the same sizes. What matters
is the output, not the tool — but record whichever command worked in the script's header comment.

- [ ] **Step 4: Verify the output**

Run:

```bash
node -e "const fs=require('fs');for(const f of ['icon-192.png','icon-512.png','icon-maskable-512.png']){const b=fs.readFileSync('public/'+f);console.log(f,b.readUInt32BE(16)+'x'+b.readUInt32BE(20))}"
```

Expected: `icon-192.png 192x192`, `icon-512.png 512x512`, `icon-maskable-512.png 512x512`.

Then open `public/icon-maskable-512.png` and confirm by eye: the gradient reaches all four edges,
and no part of the sticky note or sparkles falls outside a circle inscribed at 80% of the canvas.

- [ ] **Step 5: Commit**

```bash
git add public/icon-maskable.svg public/icon-192.png public/icon-512.png public/icon-maskable-512.png scripts/gen-icons.mjs
git commit -m "feat: PWA icon set including a full-bleed maskable variant"
```

---

### Task 10: The service worker, the manifest, and the CSP

**Files:**

- Modify: `package.json` (devDependency), `vite.config.ts`
- Create: `src/sw.ts`
- Modify: `public/_headers`
- Modify: `.gitignore` (generated `dist/sw.js` is already covered by `dist/`; confirm only)

**Interfaces:**

- Consumes: `isCacheFirst`, `isNavigation`, `isNeverCached` (Task 8); the icon PNGs (Task 9)
- Produces: a built `dist/sw.js` and `dist/manifest.webmanifest`

- [ ] **Step 1: Add the dev dependency**

Run: `npm install --save-dev vite-plugin-pwa`

Confirm it landed in `devDependencies`, not `dependencies`:
`node -e "console.log(Object.keys(require('./package.json').dependencies))"` — the list must still be
exactly the five runtime packages.

- [ ] **Step 2: Write the worker**

Create `src/sw.ts`:

```ts
/**
 * Magic Agenda's service worker. Authored here rather than generated: vite-plugin-pwa runs in
 * injectManifest mode and only supplies `self.__WB_MANIFEST`, so nothing workbox ships ends up
 * in the deployed worker.
 *
 * The load-bearing decision is that navigations are NETWORK-FIRST. A service worker is the one
 * artifact a merge to `main` cannot reach — it lives on the user's device — so an online user
 * must always receive the newest index.html. Cache-first is used only for content-hashed assets,
 * which are immutable by construction. See docs/runbooks/service-worker-rollback.md.
 */
import { isCacheFirst, isNavigation, isNeverCached } from './sw/policy'

// Cast rather than `/// <reference lib="webworker" />`: the app tsconfig includes the DOM lib,
// and the two conflict on shared globals.
const sw = self as unknown as ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[]
}

// Bump to invalidate every cache at once.
const VERSION = 'v1'
const PRECACHE = `ma-precache-${VERSION}`
const RUNTIME = `ma-runtime-${VERSION}`
const SHELL = '/index.html'

sw.addEventListener('install', (event) => {
  const urls = sw.__WB_MANIFEST.map((e) => e.url)
  event.waitUntil(
    caches.open(PRECACHE).then((cache) => cache.addAll([...new Set([...urls, SHELL])])),
  )
})

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => k !== PRECACHE && k !== RUNTIME).map((k) => caches.delete(k)),
      )
      await sw.clients.claim()
    })(),
  )
})

sw.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void sw.skipWaiting()
})

async function networkFirst(request: Request): Promise<Response> {
  try {
    const res = await fetch(request)
    if (res.ok) {
      const cache = await caches.open(PRECACHE)
      await cache.put(SHELL, res.clone())
    }
    return res
  } catch {
    const cached = (await caches.match(SHELL)) ?? (await caches.match(request))
    if (cached) return cached
    throw new Error('offline and no cached shell')
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request)
  if (cached) return cached
  const res = await fetch(request)
  if (res.ok || res.type === 'opaque') {
    const cache = await caches.open(RUNTIME)
    await cache.put(request, res.clone())
  }
  return res
}

sw.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (isNeverCached(url)) return // straight to the network, never observed
  if (isNavigation(request)) {
    event.respondWith(networkFirst(request))
    return
  }
  if (isCacheFirst(url, sw.location.origin)) event.respondWith(cacheFirst(request))
})
```

- [ ] **Step 3: Wire the plugin and the manifest**

In `vite.config.ts`, add the import and the plugin:

```ts
import { VitePWA } from 'vite-plugin-pwa'
```

```ts
plugins: [
  react(),
  VitePWA({
    strategies: 'injectManifest',
    srcDir: 'src',
    filename: 'sw.ts',
    // The plugin's auto-registration injects an INLINE script, which our
    // script-src 'self' CSP blocks. main.tsx registers explicitly instead.
    injectRegister: false,
    registerType: 'prompt',
    injectManifest: {
      globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
    },
    manifest: {
      // Must stay "Magic Agenda": it has to match the OAuth consent screen and the
      // index.html noscript block. Google's branding review is why that rule exists.
      name: 'Magic Agenda',
      short_name: 'Agenda',
      description:
        'A tactile, multi-user task board — a draggable sticky-note calendar that syncs across your devices.',
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#0b0f1f',
      theme_color: '#0b0f1f',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    devOptions: { enabled: false },
  }),
],
```

- [ ] **Step 4: Scope the CSP so the worker can fetch fonts**

`public/_headers` applies `/*` to `/sw.js` too, so a font fetch from inside the worker is governed
by the worker's own `connect-src` and is blocked today. Append a path-scoped block **after** the
existing `/*` block:

```
# The service worker runs under this file's CSP, and workbox-style runtime caching means the
# worker itself fetch()es Google Fonts — governed by connect-src, not font-src. Widening the
# site-wide directive for that would be wrong, so scope it to the worker. Both hosts are already
# trusted for style-src/font-src above, so nothing new enters the trust set.
# Confirmed on a Cloudflare preview deploy: <date>, <preview URL>
/sw.js
  Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://fonts.googleapis.com https://fonts.gstatic.com; img-src 'self' data:; object-src 'none'; base-uri 'self'
```

- [ ] **Step 5: Build and inspect the output**

Run: `npm run build`

Then verify:

```bash
ls dist/sw.js dist/manifest.webmanifest
node -e "console.log(require('fs').readFileSync('dist/sw.js','utf8').includes('workbox') ? 'WORKBOX PRESENT — investigate' : 'no workbox runtime in the worker')"
node -e "console.log(JSON.parse(require('fs').readFileSync('dist/manifest.webmanifest','utf8')).name)"
```

Expected: both files exist, no workbox runtime in the worker, manifest name `Magic Agenda`.

- [ ] **Step 6: Commit**

```bash
npx prettier --write vite.config.ts src/sw.ts
git add package.json package-lock.json vite.config.ts src/sw.ts public/_headers
git commit -m "feat: service worker and web app manifest via injectManifest"
```

---

### Task 11: Registration and the update prompt

**Files:**

- Create: `src/lib/registerSW.ts`
- Create: `src/lib/registerSW.test.ts`
- Create: `src/components/UpdatePrompt.tsx`
- Modify: `src/main.tsx`, `src/App.tsx`

**Interfaces:**

- Consumes: `Toast` with `tone`/`action` (Task 7); the built worker (Task 10)
- Produces:
  - `registerServiceWorker(): void`
  - `onUpdateReady(cb: () => void): () => void`
  - `applyUpdate(): void`

- [ ] **Step 1: Write the failing test**

Create `src/lib/registerSW.test.ts`:

```ts
import { afterEach, expect, test, vi } from 'vitest'
import { onUpdateReady, registerServiceWorker } from './registerSW'

function stubServiceWorker(waiting: unknown = null) {
  const registration = { waiting, addEventListener: vi.fn(), installing: null }
  const register = vi.fn(() => Promise.resolve(registration))
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { register, addEventListener: vi.fn(), controller: null },
    configurable: true,
  })
  return { register, registration }
}

afterEach(() => vi.restoreAllMocks())

test('registers once even when called twice (StrictMode double-invokes effects)', async () => {
  const { register } = stubServiceWorker()
  registerServiceWorker()
  registerServiceWorker()
  await Promise.resolve()
  expect(register).toHaveBeenCalledOnce()
})

test('fires onUpdateReady when a worker is already waiting', async () => {
  stubServiceWorker({ postMessage: vi.fn() })
  const cb = vi.fn()
  onUpdateReady(cb)
  registerServiceWorker()
  await vi.waitFor(() => expect(cb).toHaveBeenCalled())
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/registerSW.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/registerSW.ts`:

```ts
// Registration lives here rather than in vite-plugin-pwa's injected snippet, which is an
// INLINE script that our script-src 'self' CSP blocks — and keeping it explicit means the
// update handshake is readable code rather than plugin configuration.

let registered = false
let waitingWorker: ServiceWorker | null = null
const listeners = new Set<() => void>()

function announce(worker: ServiceWorker) {
  waitingWorker = worker
  for (const cb of listeners) cb()
}

/** Subscribe to "a new version is installed and waiting". Returns an unsubscribe. */
export function onUpdateReady(cb: () => void): () => void {
  listeners.add(cb)
  if (waitingWorker) cb()
  return () => listeners.delete(cb)
}

/** Activate the waiting worker and reload once it takes control. */
export function applyUpdate(): void {
  const worker = waitingWorker
  if (!worker) return
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
    once: true,
  })
  worker.postMessage({ type: 'SKIP_WAITING' })
}

export function registerServiceWorker(): void {
  // React StrictMode double-invokes effects in development; registering twice is harmless
  // but noisy, and the guard also makes the behaviour testable.
  if (registered) return
  if (!('serviceWorker' in navigator)) return
  registered = true
  void navigator.serviceWorker.register('/sw.js').then((registration) => {
    if (registration.waiting) announce(registration.waiting)
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing
      if (!installing) return
      installing.addEventListener('statechange', () => {
        // `controller` is null on the very first install — that is not an update, it is the
        // worker taking over for the first time, and prompting for it would be nonsense.
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          announce(installing)
        }
      })
    })
  })
}
```

Create `src/components/UpdatePrompt.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { applyUpdate, onUpdateReady } from '../lib/registerSW'
import { Toast } from './Toast'

/** Offers the newly-installed version. Never reloads on its own — a board that refreshes
 *  itself mid-drag is worse than a stale one. */
export function UpdatePrompt() {
  const [ready, setReady] = useState(false)
  useEffect(() => onUpdateReady(() => setReady(true)), [])
  if (!ready) return null
  return (
    <Toast
      tone="info"
      message="A new version of Magic Agenda is available."
      action={{ label: 'Refresh', onClick: applyUpdate }}
      duration={20000}
      onDismiss={() => setReady(false)}
    />
  )
}
```

In `src/main.tsx`, register after the render call:

```ts
import { registerServiceWorker } from './lib/registerSW'
```

```ts
registerServiceWorker()
```

In `src/App.tsx`, render `<UpdatePrompt />` inside `<SettingsProvider>`, as a sibling of
`<BrowserRouter>`, so it shows on every route.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/registerSW.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck and build**

Run: `npm run build`
Expected: clean `tsc -b` and a successful bundle.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/registerSW.ts src/lib/registerSW.test.ts src/components/UpdatePrompt.tsx src/main.tsx src/App.tsx
git add src/lib/registerSW.ts src/lib/registerSW.test.ts src/components/UpdatePrompt.tsx src/main.tsx src/App.tsx
git commit -m "feat: register the worker explicitly and prompt before applying an update"
```

---

### Task 12: Manual verification, runbook, and docs

**Files:**

- Create: `docs/runbooks/service-worker-rollback.md`
- Modify: `AGENTS.md`, `README.md`, `CHANGELOG.md`, `public/_headers` (fill in the dated
  confirmation line from Task 10 Step 4)

- [ ] **Step 1: Verify on a preview deploy**

Push the branch and open the PR so Cloudflare Pages builds a preview. On that preview URL, confirm
each of these and record the results in the PR description:

1. DevTools → Application → Manifest: name `Magic Agenda`, three icons, no errors.
2. DevTools → Application → Service Workers: `sw.js` is activated and running.
3. Network tab: no CSP violation in the console for `fonts.googleapis.com` or `fonts.gstatic.com`
   (this is the `/sw.js` header override from Task 10 Step 4 — if it fails, the fix is to widen the
   site-wide `connect-src` instead, and to say so in the file).
4. Application → Cache Storage: `ma-precache-v1` exists and contains **no** `*.supabase.co` entries.
5. Airplane mode → reload: the board renders with the offline banner, drag does nothing, and the
   add button is disabled.
6. Reconnect: the banner clears and the board reloads without a manual refresh.
7. Install to Home Screen on a real iPhone and a real Android device; launch from the icon and
   confirm standalone display and the maskable icon shape.
8. Deploy twice: with the first build open, merge a trivial change, wait, and confirm the "new
   version" toast appears and Refresh loads the new build.

- [ ] **Step 2: Fill in the CSP confirmation line**

Replace `<date>, <preview URL>` in `public/_headers` with the real values from Step 1.3.

- [ ] **Step 3: Write the rollback runbook**

Create `docs/runbooks/service-worker-rollback.md` covering: how to tell a stuck worker is the cause
(hard-reload works, normal reload does not; Application → Service Workers shows an old version); the
kill-switch worker (an `install`/`activate` pair that calls `caches.keys()` → `caches.delete()` for
every key, then `self.registration.unregister()` and reloads every client); how to ship it (replace
`src/sw.ts`, merge, and Pages deploys it — the browser byte-compares `/sw.js` on the next
navigation, which is why network-first navigation matters); how to confirm recovery; and the note
that anyone who never revisits keeps the old worker forever, so this is mitigation and not a cure.
Follow the tone of `docs/runbooks/restore-from-backup.md`: numbered steps, exact commands, and what
to verify after each.

- [ ] **Step 4: Update the living docs**

- `AGENTS.md`: a new subsection under "Architecture" — the worker is authored not generated,
  navigations are network-first and why, the Supabase never-cache rule and where its test lives, the
  `/sw.js` CSP scope, and that snapshots are cleared on sign-out.
- `README.md`: mention installability and offline read in the feature list.
- `ROADMAP.md`: item 3.1 has shipped — remove it from the Phase 3 list **and** from the
  "Build order at a glance" table, and add it to the header paragraph that records what was pruned
  and when, exactly as 5.1/5.2/5.3 and 5.7 are recorded. 3.2's dependency line then reads `4.1` only.
- `CHANGELOG.md`: add the section for the version this merge will mint. Get it from
  `node scripts/next-version.mjs` — do not guess.
- The `private/` security reviews are git-ignored and local to the maintainer, so they are **not** a
  step here. Flag in the PR description that storing task text at rest in `localStorage` is a new
  position and belongs in the next dated review, per the spec's follow-up list.

- [ ] **Step 5: Run the full gate**

Run: `npm run format:check && npm run lint && npm run build && npm test && npm run codex:check`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
npx prettier --write docs/runbooks/service-worker-rollback.md AGENTS.md README.md CHANGELOG.md
git add docs/runbooks/service-worker-rollback.md AGENTS.md README.md CHANGELOG.md public/_headers
git commit -m "docs: service-worker rollback runbook and PWA architecture notes"
```

---

## Notes for the implementer

- **The single most important test** is Task 4's "materializes nothing". If it is ever deleted or
  weakened, an offline boot can insert duplicate recurrence instances and hit
  `tasks_recur_instance_uniq` (Postgres 23505).
- **The single most important behavior** is network-first navigation (Task 10). Do not "optimize" it
  to cache-first for speed; it is the reason a bad deploy stays fixable.
- **Do not add offline writes.** No queue, no reconciler, no "just this one mutation". The spec
  scopes it out; it is its own XL item.
- If a task's tests pass but `npm test` fails elsewhere, the usual cause is snapshot state leaking
  between tests — check that Task 1 Step 1's `localStorage.clear()` is present in
  `src/test/setup.ts`.
