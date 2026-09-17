import { describe, expect, test } from 'vitest'
import { planBulkUpdate } from './bulk'
import { INBOX, NO_RECUR, type Task } from '../types/task'

const NOW = '2026-09-17T12:00:00.000Z'

function task(id: string, values: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: '',
    labelId: null,
    color: 'yellow',
    checklist: [],
    status: 'todo',
    completedAt: null,
    reopenStatus: 'todo',
    archivedAt: null,
    day: '2026-09-17',
    atTime: null,
    pinned: false,
    order: 0,
    korder: 0,
    ...NO_RECUR,
    ...values,
  } as Task
}

const ids = (...values: string[]) => new Set(values)

describe('planBulkUpdate: move to a day', () => {
  test('appends the selection after the destination lane, keeping its relative order', () => {
    const board = [
      task('a', { day: '2026-09-17', order: 1 }),
      task('b', { day: '2026-09-18', order: 0 }),
      task('c', { day: '2026-09-17', order: 0 }),
      task('stay', { day: '2026-09-20', order: 0 }),
      task('stay2', { day: '2026-09-20', order: 1 }),
    ]
    const { tasks, changed } = planBulkUpdate(
      board,
      ids('a', 'b', 'c'),
      {
        kind: 'day',
        day: '2026-09-20',
      },
      NOW,
    )

    const lane = tasks
      .filter((t) => t.day === '2026-09-20')
      .sort((x, y) => x.order - y.order)
      .map((t) => t.id)
    // Earlier days first, then lane order within a day: c (17th, 0), a (17th, 1), b (18th).
    expect(lane).toEqual(['stay', 'stay2', 'c', 'a', 'b'])
    expect(changed.map((t) => t.id).sort()).toEqual(['a', 'b', 'c'])
  })

  test('leaves tasks already on the destination day untouched', () => {
    const board = [task('a', { day: '2026-09-20', order: 4 }), task('b', { day: '2026-09-17' })]
    const { tasks, changed } = planBulkUpdate(
      board,
      ids('a', 'b'),
      {
        kind: 'day',
        day: '2026-09-20',
      },
      NOW,
    )
    expect(changed.map((t) => t.id)).toEqual(['b'])
    expect(tasks.find((t) => t.id === 'a')).toEqual(board[0])
    expect(tasks.find((t) => t.id === 'b')?.order).toBe(5)
  })

  test('moving into the Inbox clears Due Time; an Occurrence keeps its Occurrence Date', () => {
    const occurrence = task('o', {
      day: '2026-09-17',
      atTime: '09:30',
      recurParentId: 'series',
      occurrenceDate: '2026-09-17',
    })
    const { changed } = planBulkUpdate([occurrence], ids('o'), { kind: 'day', day: INBOX }, NOW)
    expect(changed[0]).toMatchObject({
      day: INBOX,
      atTime: null,
      recurParentId: 'series',
      occurrenceDate: '2026-09-17',
    })
  })

  test('a move between scheduled days keeps Due Time', () => {
    const { changed } = planBulkUpdate(
      [task('a', { atTime: '14:00' })],
      ids('a'),
      { kind: 'day', day: '2026-09-21' },
      NOW,
    )
    expect(changed[0].atTime).toBe('14:00')
  })
})

describe('planBulkUpdate: status', () => {
  test('applies the completion decision and appends to the destination column', () => {
    const board = [
      task('done1', { status: 'completed', reopenStatus: 'todo', completedAt: NOW, korder: 0 }),
      task('a', { status: 'doing', reopenStatus: 'doing', korder: 3 }),
      task('b', { status: 'todo', korder: 1 }),
    ]
    const { tasks, changed } = planBulkUpdate(
      board,
      ids('a', 'b', 'done1'),
      { kind: 'status', status: 'completed' },
      NOW,
    )
    expect(changed.map((t) => t.id).sort()).toEqual(['a', 'b'])
    expect(tasks.find((t) => t.id === 'a')).toMatchObject({
      status: 'completed',
      completedAt: NOW,
      reopenStatus: 'doing',
      korder: 2,
    })
    expect(tasks.find((t) => t.id === 'b')).toMatchObject({ korder: 1, reopenStatus: 'todo' })
    expect(tasks.find((t) => t.id === 'done1')).toEqual(board[0])
  })

  test('reopening clears completion fields', () => {
    const { changed } = planBulkUpdate(
      [task('a', { status: 'completed', completedAt: NOW, reopenStatus: 'doing' })],
      ids('a'),
      { kind: 'status', status: 'todo' },
      NOW,
    )
    expect(changed[0]).toMatchObject({ status: 'todo', completedAt: null, reopenStatus: 'todo' })
  })
})

describe('planBulkUpdate: color', () => {
  test('recolors only tasks whose color differs', () => {
    const board = [task('a', { color: 'pink' }), task('b', { color: 'blue' }), task('c')]
    const { tasks, changed } = planBulkUpdate(
      board,
      ids('a', 'b'),
      { kind: 'color', color: 'pink' },
      NOW,
    )
    expect(changed.map((t) => t.id)).toEqual(['b'])
    expect(tasks.map((t) => t.color)).toEqual(['pink', 'pink', 'yellow'])
  })
})

test('unknown ids and an empty selection change nothing', () => {
  const board = [task('a')]
  const result = planBulkUpdate(board, ids('missing'), { kind: 'color', color: 'mint' }, NOW)
  expect(result.changed).toEqual([])
  expect(result.tasks).toEqual(board)
})
