import { describe, it, expect } from 'vitest'
import { findContainer, moveToDay, moveToStatus, reindex } from './reorder'
import type { Status, Task } from '../types/task'

function t(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: '',
    category: 'work',
    color: 'yellow',
    checklist: [],
    status: 'todo',
    done: false,
    day: 'inbox',
    order: 0,
    korder: 0,
    ...over,
  }
}

/** ids of a day's tasks in calendar order. */
const dayIds = (tasks: Task[], day: string) =>
  tasks
    .filter((x) => x.day === day)
    .sort((a, b) => a.order - b.order)
    .map((x) => x.id)
/** the order values of a day's tasks (sorted) — used to assert contiguity. */
const dayOrders = (tasks: Task[], day: string) =>
  tasks
    .filter((x) => x.day === day)
    .map((x) => x.order)
    .sort((a, b) => a - b)
const statusIds = (tasks: Task[], status: Status) =>
  tasks
    .filter((x) => x.status === status)
    .sort((a, b) => a.korder - b.korder)
    .map((x) => x.id)
const statusKorders = (tasks: Task[], status: Status) =>
  tasks
    .filter((x) => x.status === status)
    .map((x) => x.korder)
    .sort((a, b) => a - b)

describe('findContainer', () => {
  const tasks = [t('a', { day: '2026-06-29', status: 'doing' }), t('b', { day: 'inbox' })]
  it('returns the day in calendar mode', () => {
    expect(findContainer(tasks, 'a', 'day')).toBe('2026-06-29')
    expect(findContainer(tasks, 'b', 'day')).toBe('inbox')
  })
  it('returns the status in kanban mode', () => {
    expect(findContainer(tasks, 'a', 'status')).toBe('doing')
  })
  it('returns undefined for an unknown id', () => {
    expect(findContainer(tasks, 'nope', 'day')).toBeUndefined()
  })
})

describe('reindex', () => {
  it('makes a day order contiguous 0..n-1 by current order', () => {
    const tasks = [
      t('a', { day: 'D', order: 0 }),
      t('b', { day: 'D', order: 5 }),
      t('c', { day: 'D', order: 2 }),
      t('z', { day: 'OTHER', order: 9 }),
    ]
    const next = reindex(tasks, 'D', 'day')
    expect(dayIds(next, 'D')).toEqual(['a', 'c', 'b'])
    expect(dayOrders(next, 'D')).toEqual([0, 1, 2])
    expect(next.find((x) => x.id === 'z')!.order).toBe(9) // untouched
  })
  it('reindexes a status by korder', () => {
    const tasks = [
      t('a', { status: 'done', korder: 3 }),
      t('b', { status: 'done', korder: 1 }),
    ]
    const next = reindex(tasks, 'done', 'status')
    expect(statusIds(next, 'done')).toEqual(['b', 'a'])
    expect(statusKorders(next, 'done')).toEqual([0, 1])
  })
  it('does not mutate the input', () => {
    const tasks = [t('a', { day: 'D', order: 7 })]
    reindex(tasks, 'D', 'day')
    expect(tasks[0].order).toBe(7)
  })
})

describe('moveToDay', () => {
  const base = () => [
    t('a', { day: 'A', order: 0 }),
    t('b', { day: 'A', order: 1 }),
    t('c', { day: 'A', order: 2 }),
    t('d', { day: 'B', order: 0 }),
    t('e', { day: 'B', order: 1 }),
  ]

  it('reorders within the same day, staying contiguous', () => {
    const next = moveToDay(base(), 'a', 'A', 2)
    expect(dayIds(next, 'A')).toEqual(['b', 'c', 'a'])
    expect(dayOrders(next, 'A')).toEqual([0, 1, 2])
  })

  it('moves across days and reindexes BOTH source and destination', () => {
    const next = moveToDay(base(), 'b', 'B', 1)
    expect(next.find((x) => x.id === 'b')!.day).toBe('B')
    expect(dayIds(next, 'B')).toEqual(['d', 'b', 'e'])
    expect(dayOrders(next, 'B')).toEqual([0, 1, 2])
    // source 'A' had a hole where b was — it must be re-packed contiguously.
    expect(dayIds(next, 'A')).toEqual(['a', 'c'])
    expect(dayOrders(next, 'A')).toEqual([0, 1])
  })

  it('drops into an empty day', () => {
    const tasks = [t('a', { day: 'A', order: 0 })]
    const next = moveToDay(tasks, 'a', 'EMPTY', 0)
    expect(dayIds(next, 'EMPTY')).toEqual(['a'])
    expect(next.find((x) => x.id === 'a')!.order).toBe(0)
  })

  it('clamps an out-of-range index to the end', () => {
    const next = moveToDay(base(), 'd', 'A', 999)
    expect(dayIds(next, 'A')).toEqual(['a', 'b', 'c', 'd'])
    expect(dayOrders(next, 'A')).toEqual([0, 1, 2, 3])
  })

  it('clamps a negative index to the start', () => {
    const next = moveToDay(base(), 'd', 'A', -5)
    expect(dayIds(next, 'A')).toEqual(['d', 'a', 'b', 'c'])
  })

  it('moves to inbox', () => {
    const next = moveToDay(base(), 'a', 'inbox', 0)
    expect(next.find((x) => x.id === 'a')!.day).toBe('inbox')
    expect(dayIds(next, 'inbox')).toEqual(['a'])
  })

  it('does not mutate the input', () => {
    const tasks = base()
    moveToDay(tasks, 'b', 'B', 0)
    expect(tasks.find((x) => x.id === 'b')!.day).toBe('A')
  })
})

describe('moveToStatus', () => {
  const base = () => [
    t('a', { status: 'todo', korder: 0 }),
    t('b', { status: 'todo', korder: 1 }),
    t('c', { status: 'doing', korder: 0 }),
    t('d', { status: 'done', korder: 0, done: true }),
  ]

  it('moves across columns, reindexing both, and respects the drop index', () => {
    const next = moveToStatus(base(), 'a', 'doing', 0)
    expect(statusIds(next, 'doing')).toEqual(['a', 'c'])
    expect(statusKorders(next, 'doing')).toEqual([0, 1])
    expect(statusIds(next, 'todo')).toEqual(['b'])
    expect(statusKorders(next, 'todo')).toEqual([0])
  })

  it('sets done=true when moving into done, false when leaving', () => {
    const intoDone = moveToStatus(base(), 'a', 'done', 1)
    expect(intoDone.find((x) => x.id === 'a')!.done).toBe(true)
    expect(intoDone.find((x) => x.id === 'a')!.status).toBe('done')

    const outOfDone = moveToStatus(intoDone, 'd', 'todo', 0)
    expect(outOfDone.find((x) => x.id === 'd')!.done).toBe(false)
    expect(outOfDone.find((x) => x.id === 'd')!.status).toBe('todo')
  })

  it('drops into an empty column', () => {
    const tasks = [t('a', { status: 'todo', korder: 0 })]
    const next = moveToStatus(tasks, 'a', 'done', 5)
    expect(statusIds(next, 'done')).toEqual(['a'])
    expect(next.find((x) => x.id === 'a')!.korder).toBe(0)
  })

  it('does not mutate the input', () => {
    const tasks = base()
    moveToStatus(tasks, 'a', 'done', 0)
    expect(tasks.find((x) => x.id === 'a')!.status).toBe('todo')
  })
})
