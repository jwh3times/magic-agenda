import type { SeriesDefinition, Task } from '../types/task'
import type { Label } from '../types/label'
import type { Settings } from './useSettings'

// Last-known board + settings, so the app can render read-only with no network.
// Best-effort like viewStorage.ts: every access is guarded, and losing a snapshot only
// degrades the offline experience. Cleared on sign-out (see AuthProvider) — that clearing
// is what makes storing task text at rest acceptable.
// The board snapshot key is now per Board: `ma-snapshot-board.<boardId>`. One account can hold
// several, and each must be droppable on its own — a purge that could only clear "the" snapshot
// would have to clear all of them to remove one.
const BOARD_KEY_PREFIX = 'ma-snapshot-board.'
const LABEL_KEY_PREFIX = 'ma-snapshot-labels.'
const SETTINGS_KEY = 'ma-snapshot-settings'
const DIRECTORY_KEY = 'ma-snapshot-directory'

// Bump on any shape change. A mismatched envelope is dropped, never migrated.
// v2: Settings gained weekStart + timezone (roadmap 4.1). Dropping costs nothing in practice —
// getting this code at all requires a network navigation, and that same load rewrites both.
// v3: board snapshots are keyed per Board and carry `boardId`; the directory envelope is new. The
// old single `ma-snapshot-board` key is not migrated — it is left to be swept by clearSnapshots()
// and by the first successful load, which rewrites everything anyway.
// v4: Task classification is nullable `labelId`, so category-shaped task snapshots are dropped;
// per-Board Label snapshots are introduced alongside the task envelope.
// v5: the two recurrence fields were renamed to the domain vocabulary (#204) — `recurOriginDay` ->
// `occurrenceDate`, `recurSkip` -> `excludedDates`. A v4 envelope hydrates with both undefined,
// which is not a cosmetic gap: `excludedDates` is spread when an Occurrence is deleted, so an
// un-dropped v4 snapshot throws there. Unlike the export format, which is frozen at the old names
// because other people hold those files, a snapshot is this device's own cache and the next
// successful load rewrites it.
//
// v6: `templates` narrowed from `Task[]` to `SeriesDefinition[]` (#220). This is a shape change
// like any other, and it is not hypothetical: the bug that fix closed *wrote* a `recurFreq: 'none'`
// row into the templates half, so a v5 envelope written by a pre-fix build can hold exactly the
// shape the type now forbids — and the envelope is asserted, not validated. Bumping drops those
// rather than hydrating a lie.
//
// v7: Workflow Status uses the canonical `completed` token, the redundant Task `done` member is
// gone, and Completion/Archive persistence joins the Task shape. A v6 snapshot can carry neither
// those fields nor the new token, so it is dropped instead of asserted into an impossible Task.
const V = 7

const boardKey = (boardId: string) => `${BOARD_KEY_PREFIX}${boardId}`
const labelKey = (boardId: string) => `${LABEL_KEY_PREFIX}${boardId}`

export interface BoardSnapshot {
  v: typeof V
  userId: string
  boardId: string
  savedAt: number
  tasks: Task[]
  templates: SeriesDefinition[]
}

/**
 * The per-Account envelope: which Boards this device last saw, and which one was open.
 *
 * Separate from the board snapshots because it answers a different question. A board snapshot says
 * "here is what was on board X"; this says "these are the boards that existed" — which is what lets
 * an offline boot render a Board switcher at all, and what gives the purge a list of ids to compare
 * against when the server's answer comes back shorter than expected.
 */
export interface DirectorySnapshot {
  v: typeof V
  userId: string
  boards: unknown[]
  selectedBoardId: string | null
}

export interface LabelSnapshot {
  v: typeof V
  userId: string
  boardId: string
  savedAt: number
  labels: Label[]
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

export function readBoardSnapshot(userId: string, boardId: string): BoardSnapshot | null {
  if (!boardId) return null
  const env = readEnvelope(boardKey(boardId), userId)
  if (!env || !Array.isArray(env.tasks) || !Array.isArray(env.templates)) return null
  if (typeof env.savedAt !== 'number') return null
  // The key already encodes the Board, so a mismatch here means a hand-edited or collided
  // envelope. Drop it rather than rendering one Board's tasks under another Board's name.
  if (env.boardId !== boardId) return null
  return env as unknown as BoardSnapshot
}

export function hasBoardSnapshot(userId: string, boardId: string): boolean {
  return readBoardSnapshot(userId, boardId) !== null
}

export function writeBoardSnapshot(
  userId: string,
  boardId: string,
  tasks: Task[],
  templates: readonly SeriesDefinition[],
): void {
  if (!boardId) return
  write(boardKey(boardId), userId, { boardId, savedAt: Date.now(), tasks, templates })
}

export function readLabelSnapshot(userId: string, boardId: string): LabelSnapshot | null {
  if (!boardId) return null
  const env = readEnvelope(labelKey(boardId), userId)
  if (!env || env.boardId !== boardId || !Array.isArray(env.labels)) return null
  if (typeof env.savedAt !== 'number') return null
  return env as unknown as LabelSnapshot
}

export function writeLabelSnapshot(userId: string, boardId: string, labels: Label[]): void {
  if (!boardId) return
  write(labelKey(boardId), userId, { boardId, savedAt: Date.now(), labels })
}

/**
 * Whether this Account has *any* Board snapshot — the offline-boot gate.
 *
 * `App` and `ProtectedRoute` ask this before a Board is selected or even known, to decide whether a
 * signed-out-looking, offline visitor should be shown the app instead of the login page. They
 * cannot name a Board id at that point, which is exactly why this is a separate function rather
 * than a default argument on `readBoardSnapshot`.
 */
export function hasAnyBoardSnapshot(userId: string): boolean {
  if (!userId) return false
  return cachedBoardIds().some((id) => readBoardSnapshot(userId, id) !== null)
}

/** Board ids this device currently holds a snapshot for, whoever they belong to. */
export function cachedBoardIds(): string[] {
  try {
    const ids: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(BOARD_KEY_PREFIX)) ids.push(key.slice(BOARD_KEY_PREFIX.length))
    }
    return ids
  } catch {
    return []
  }
}

/**
 * Drop the cached tasks for Boards this Account can no longer reach.
 *
 * The client-side half of revocation. Nothing announces that access ended — the server just stops
 * returning the Board — so a device that keeps rendering its last snapshot is showing content the
 * Account is no longer entitled to. This is what makes "a removed member may briefly see a stale
 * read-only copy, purged on the next successful server contact" true rather than aspirational.
 *
 * Note it takes ids to REMOVE, not ids to keep. The caller computes that set from the server's
 * response via `purgeableBoardIds`, so a load that returned nothing purges everything — which is
 * correct, and is the case an "ids to keep" signature would get exactly backwards.
 */
export function purgeBoardSnapshots(boardIds: readonly string[]): void {
  try {
    for (const id of boardIds) {
      localStorage.removeItem(boardKey(id))
      localStorage.removeItem(labelKey(id))
    }
  } catch {
    // ignore
  }
}

export function readDirectorySnapshot(userId: string): DirectorySnapshot | null {
  const env = readEnvelope(DIRECTORY_KEY, userId)
  if (!env || !Array.isArray(env.boards)) return null
  return env as unknown as DirectorySnapshot
}

export function writeDirectorySnapshot(
  userId: string,
  boards: unknown[],
  selectedBoardId: string | null,
): void {
  write(DIRECTORY_KEY, userId, { boards, selectedBoardId })
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

/**
 * Everything, on sign-out.
 *
 * This clearing is the entire justification for storing task text at rest in `localStorage`, so it
 * has to sweep **every** board key rather than a known list — the account may hold snapshots for
 * boards this session never opened, and a signed-out device that keeps any of them breaks the
 * premise. It also removes the pre-v3 single `ma-snapshot-board` key, which no longer has a reader.
 */
export function clearSnapshots(): void {
  try {
    const stale: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(BOARD_KEY_PREFIX) || key?.startsWith(LABEL_KEY_PREFIX)) stale.push(key)
    }
    for (const key of stale) localStorage.removeItem(key)
    localStorage.removeItem('ma-snapshot-board')
    localStorage.removeItem(SETTINGS_KEY)
    localStorage.removeItem(DIRECTORY_KEY)
  } catch {
    // ignore
  }
}
