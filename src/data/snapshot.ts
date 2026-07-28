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
