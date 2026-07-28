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
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError')
  })
  expect(() => writeBoardSnapshot('u1', [task('a')], [])).not.toThrow()
})

test('settings round-trip and clear together with the board', () => {
  writeBoardSnapshot('u1', [task('a')], [])
  writeSettingsSnapshot('u1', {
    theme: 'glass',
    defaultView: 'kanban',
    weekStart: 0,
    timezone: null,
  })
  expect(readSettingsSnapshot('u1')?.settings.theme).toBe('glass')
  clearSnapshots()
  expect(readBoardSnapshot('u1')).toBeNull()
  expect(readSettingsSnapshot('u1')).toBeNull()
})
