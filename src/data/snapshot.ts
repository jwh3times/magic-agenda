import type { Task } from '../types/task'
import type { Settings } from './useSettings'

// Last-known board + settings, so the app can render read-only with no network.
// Best-effort like viewStorage.ts: every access is guarded, and losing a snapshot only
// degrades the offline experience. Cleared on sign-out (see AuthProvider) — that clearing
// is what makes storing task text at rest acceptable.
const BOARD_KEY = 'ma-snapshot-board'
const SETTINGS_KEY = 'ma-snapshot-settings'

// Bump on any shape change. A mismatched envelope is dropped, never migrated.
// v2: Settings gained weekStart + timezone (roadmap 4.1). Dropping costs nothing in practice —
// getting this code at all requires a network navigation, and that same load rewrites both.
const V = 2

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

/**
 * Whether a snapshot may be written right now. **One rule, one place** — it used to have two
 * implementations and three prose copies (a docstring on each hook plus `AGENTS.md`), and one of
 * those implementations passed it as a positional boolean argument named `persistSnapshot`.
 *
 * Every clause is load-bearing:
 *
 * - **`userId`** — nothing to key the envelope to.
 * - **`hasSession`** — checked live, not just via `loadedFromServer`. The flag can only ever have
 *   been set by a *past* authenticated load, but a session can end mid-mount without unmounting
 *   the hook, and a write must reflect the current session rather than a historical one.
 * - **`offline`** — the data on screen came from a snapshot, so re-writing it would only move
 *   `savedAt` forward and make stale data claim to be fresh.
 * - **`loading`** — mid-load state is not a board.
 * - **`loadedFromServer`** — the subtle one. A load that *succeeds* under RLS with no session
 *   returns `{ data: [], error: null }`: "RLS answered nothing" is not "the board is confirmed
 *   empty". Without this, either that or a failed load with no prior snapshot would persist an
 *   empty envelope, which reads back on the next boot as valid, freshly-saved offline data —
 *   indistinguishable from a genuinely empty board, and permanently hiding the fact that this
 *   client has never actually reached the server on this user's behalf.
 */
export function canPersistSnapshot(state: {
  userId: string
  hasSession: boolean
  offline: boolean
  loading: boolean
  loadedFromServer: boolean
}): boolean {
  return (
    Boolean(state.userId) &&
    state.hasSession &&
    !state.offline &&
    !state.loading &&
    state.loadedFromServer
  )
}

export function clearSnapshots(): void {
  try {
    localStorage.removeItem(BOARD_KEY)
    localStorage.removeItem(SETTINGS_KEY)
  } catch {
    // ignore
  }
}
