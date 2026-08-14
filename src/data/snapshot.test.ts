import { afterEach, expect, test, vi } from 'vitest'
import { NO_RECUR, type Task } from '../types/task'
import {
  cachedBoardIds,
  clearSnapshots,
  hasAnyBoardSnapshot,
  hasBoardSnapshot,
  purgeBoardSnapshots,
  readBoardSnapshot,
  readDirectorySnapshot,
  readSettingsSnapshot,
  writeBoardSnapshot,
  writeDirectorySnapshot,
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
  writeBoardSnapshot('u1', 'b1', [task('a')], [task('t')])
  const snap = readBoardSnapshot('u1', 'b1')
  expect(snap?.tasks.map((t) => t.id)).toEqual(['a'])
  expect(snap?.templates.map((t) => t.id)).toEqual(['t'])
  expect(snap?.savedAt).toBeGreaterThan(0)
})

test('templates are stored separately from board tasks', () => {
  writeBoardSnapshot('u1', 'b1', [task('a')], [task('t')])
  expect(readBoardSnapshot('u1', 'b1')?.tasks.some((t) => t.id === 't')).toBe(false)
})

test('refuses a snapshot belonging to another user', () => {
  writeBoardSnapshot('u1', 'b1', [task('a')], [])
  expect(readBoardSnapshot('u2', 'b1')).toBeNull()
  expect(hasBoardSnapshot('u2', 'b1')).toBe(false)
})

test('refuses an envelope from an older version', () => {
  localStorage.setItem('ma-snapshot-board.b1', JSON.stringify({ v: 0, userId: 'u1', tasks: [] }))
  expect(readBoardSnapshot('u1', 'b1')).toBeNull()
})

test('refuses a payload whose shape is wrong', () => {
  localStorage.setItem(
    'ma-snapshot-board.b1',
    JSON.stringify({ v: 3, userId: 'u1', boardId: 'b1', tasks: 'nope' }),
  )
  expect(readBoardSnapshot('u1', 'b1')).toBeNull()
})

test('survives unparseable JSON', () => {
  localStorage.setItem('ma-snapshot-board.b1', '{{{')
  expect(readBoardSnapshot('u1', 'b1')).toBeNull()
})

test('an empty user id never reads or writes', () => {
  writeBoardSnapshot('', 'b1', [task('a')], [])
  expect(localStorage.getItem('ma-snapshot-board.b1')).toBeNull()
  expect(readBoardSnapshot('', 'b1')).toBeNull()
})

test('a failed write is swallowed', () => {
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError')
  })
  expect(() => writeBoardSnapshot('u1', 'b1', [task('a')], [])).not.toThrow()
})

test('one board’s snapshot never reads back as another’s', () => {
  // The whole point of keying per board. Before this, "the" snapshot was a single key, so opening a
  // second board would show the first board's tasks under the second board's name.
  writeBoardSnapshot('u1', 'b1', [task('from-b1')], [])
  writeBoardSnapshot('u1', 'b2', [task('from-b2')], [])
  expect(readBoardSnapshot('u1', 'b1')?.tasks.map((t) => t.id)).toEqual(['from-b1'])
  expect(readBoardSnapshot('u1', 'b2')?.tasks.map((t) => t.id)).toEqual(['from-b2'])
})

test('a board id is required to read or write', () => {
  writeBoardSnapshot('u1', '', [task('a')], [])
  expect(cachedBoardIds()).toEqual([])
  expect(readBoardSnapshot('u1', '')).toBeNull()
})

test('purge drops only the named boards', () => {
  // The client-side half of revocation. Access ending is silent — the server just stops returning
  // the board — so this is what makes "purged on the next successful contact" true rather than
  // aspirational.
  writeBoardSnapshot('u1', 'keep', [task('a')], [])
  writeBoardSnapshot('u1', 'revoked', [task('b')], [])
  purgeBoardSnapshots(['revoked'])
  expect(readBoardSnapshot('u1', 'keep')).not.toBeNull()
  expect(readBoardSnapshot('u1', 'revoked')).toBeNull()
})

test('purging an unknown board id is a no-op, not a throw', () => {
  writeBoardSnapshot('u1', 'b1', [task('a')], [])
  expect(() => purgeBoardSnapshots(['never-existed'])).not.toThrow()
  expect(readBoardSnapshot('u1', 'b1')).not.toBeNull()
})

test('hasAnyBoardSnapshot answers the offline-boot question without knowing a board', () => {
  // `App` and `ProtectedRoute` ask this before any board is selected or even known, which is why it
  // cannot just be `readBoardSnapshot` with a default.
  expect(hasAnyBoardSnapshot('u1')).toBe(false)
  writeBoardSnapshot('u1', 'b7', [task('a')], [])
  expect(hasAnyBoardSnapshot('u1')).toBe(true)
  // ...and it stays scoped to the account, so another user's cached board does not let this one in.
  expect(hasAnyBoardSnapshot('u2')).toBe(false)
})

test('the directory envelope round-trips and is user-scoped', () => {
  writeDirectorySnapshot('u1', [{ id: 'b1', name: 'Mine' }], 'b1')
  expect(readDirectorySnapshot('u1')?.selectedBoardId).toBe('b1')
  expect(readDirectorySnapshot('u2')).toBeNull()
})

test('clearing sweeps every board, including ones this session never opened', () => {
  // Sign-out clearing is the entire justification for storing task text at rest, so it has to sweep
  // by prefix rather than by a known list — the account may hold snapshots for boards this session
  // never touched, and leaving any of them breaks the premise.
  writeBoardSnapshot('u1', 'b1', [task('a')], [])
  writeBoardSnapshot('u1', 'b2', [task('b')], [])
  writeDirectorySnapshot('u1', [], 'b1')
  localStorage.setItem('ma-snapshot-board', JSON.stringify({ v: 2, userId: 'u1', tasks: [] }))

  clearSnapshots()

  expect(cachedBoardIds()).toEqual([])
  expect(readDirectorySnapshot('u1')).toBeNull()
  // The pre-v3 single key has no reader any more, but it still holds task text at rest.
  expect(localStorage.getItem('ma-snapshot-board')).toBeNull()
})

test('settings round-trip and clear together with the board', () => {
  writeBoardSnapshot('u1', 'b1', [task('a')], [])
  writeSettingsSnapshot('u1', {
    theme: 'glass',
    defaultView: 'kanban',
    weekStart: 0,
    timezone: null,
  })
  expect(readSettingsSnapshot('u1')?.settings.theme).toBe('glass')
  clearSnapshots()
  expect(readBoardSnapshot('u1', 'b1')).toBeNull()
  expect(readSettingsSnapshot('u1')).toBeNull()
})
