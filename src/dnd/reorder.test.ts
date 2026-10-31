import { describe, it, expect } from 'vitest'
import { moveToDay, moveToStatus, revertPreview } from './reorder'
import { asTask, NO_RECUR, type Task, type TaskDraft, type WorkflowStatus } from '../types/task'

const NOW = '2026-09-03T14:45:00.000Z'

function t(id: string, over: Partial<TaskDraft> = {}): Task {
  return asTask({
    id,
    title: id,
    description: '',
    labelId: null,
    assigneeId: null,
    color: 'yellow',
    checklist: [],
    status: 'todo',
    completedAt: null,
    reopenStatus: 'todo',
    archivedAt: null,
    day: 'inbox',
    atTime: null,
    pinned: false,
    order: 0,
    korder: 0,
    ...NO_RECUR,
    ...over,
  })
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
const statusIds = (tasks: Task[], status: WorkflowStatus) =>
  tasks
    .filter((x) => x.status === status)
    .sort((a, b) => a.korder - b.korder)
    .map((x) => x.id)
const statusKorders = (tasks: Task[], status: WorkflowStatus) =>
  tasks
    .filter((x) => x.status === status)
    .map((x) => x.korder)
    .sort((a, b) => a - b)

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
    const tasks = base()
    tasks[0] = t('a', {
      day: 'A',
      order: 0,
      atTime: '09:00',
      recurParentId: 'series-1',
      occurrenceDate: '2026-07-08',
    })
    const next = moveToDay(tasks, 'a', 'inbox', 0)
    expect(next.find((x) => x.id === 'a')).toMatchObject({
      day: 'inbox',
      atTime: null,
      occurrenceDate: '2026-07-08',
    })
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
    t('d', {
      status: 'completed',
      completedAt: '2026-09-01T10:00:00.000Z',
      reopenStatus: 'doing',
      korder: 0,
    }),
  ]

  it('moves across columns, reindexing both, and respects the drop index', () => {
    const next = moveToStatus(base(), 'a', 'doing', 0, NOW)
    expect(statusIds(next, 'doing')).toEqual(['a', 'c'])
    expect(statusKorders(next, 'doing')).toEqual([0, 1])
    expect(statusIds(next, 'todo')).toEqual(['b'])
    expect(statusKorders(next, 'todo')).toEqual([0])
  })

  it('Completes and explicitly Reopens through the shared lifecycle decision', () => {
    const intoCompleted = moveToStatus(base(), 'a', 'completed', 1, NOW)
    expect(intoCompleted.find((x) => x.id === 'a')).toMatchObject({
      status: 'completed',
      completedAt: NOW,
      reopenStatus: 'todo',
    })

    const reopened = moveToStatus(intoCompleted, 'd', 'todo', 0, NOW)
    expect(reopened.find((x) => x.id === 'd')).toMatchObject({
      status: 'todo',
      completedAt: null,
      reopenStatus: 'todo',
      archivedAt: null,
    })
  })

  it('drops into an empty column', () => {
    const tasks = [t('a', { status: 'todo', korder: 0 })]
    const next = moveToStatus(tasks, 'a', 'completed', 5, NOW)
    expect(statusIds(next, 'completed')).toEqual(['a'])
    expect(next.find((x) => x.id === 'a')!.korder).toBe(0)
  })

  it('does not mutate the input', () => {
    const tasks = base()
    moveToStatus(tasks, 'a', 'completed', 0, NOW)
    expect(tasks.find((x) => x.id === 'a')!.status).toBe('todo')
  })
})

describe('revertPreview', () => {
  const DAY = '2026-07-01'
  const OTHER = '2026-07-02'
  const before = [
    t('a', { day: DAY, order: 0, atTime: '09:00' }),
    t('b', { day: DAY, order: 1 }),
    t('c', { day: OTHER, order: 0 }),
  ]
  const shown = moveToDay(before, 'a', OTHER, 1)
  const find = (tasks: Task[], id: string) => tasks.find((x) => x.id === id)!

  it('puts every lane the preview reindexed back', () => {
    const next = revertPreview(shown, before, shown)
    expect(find(next, 'a')).toMatchObject({ day: DAY, order: 0, atTime: '09:00' })
    expect(find(next, 'b').order).toBe(1)
    expect(find(next, 'c').order).toBe(0)
  })

  it('undoes a move to the Inbox, including the Due Time it cleared', () => {
    const toInbox = moveToDay(before, 'a', 'inbox', 0)
    expect(find(toInbox, 'a').atTime).toBeNull()
    expect(find(revertPreview(toInbox, before, toInbox), 'a')).toMatchObject({
      day: DAY,
      atTime: '09:00',
    })
  })

  it('undoes a move across Workflow Statuses, including its Completion fields', () => {
    const toDone = moveToStatus(before, 'a', 'completed', 0, NOW)
    expect(find(toDone, 'a').completedAt).toBe(NOW)
    expect(find(revertPreview(toDone, before, toDone), 'a')).toMatchObject({
      status: 'todo',
      completedAt: null,
    })
  })

  it('keeps an edit to another field of the dragged Task', () => {
    const current = shown.map((x) => (x.id === 'a' ? { ...x, title: 'renamed remotely' } : x))
    const a = find(revertPreview(current, before, shown), 'a')
    expect(a.title).toBe('renamed remotely')
    expect(a.day).toBe(DAY)
  })

  it('keeps a placement something else set since the preview', () => {
    const elsewhere = '2026-07-09'
    const current = shown.map((x) => (x.id === 'c' ? { ...x, day: elsewhere, order: 7 } : x))
    expect(find(revertPreview(current, before, shown), 'c')).toMatchObject({
      day: elsewhere,
      order: 7,
    })
  })

  it('keeps a row that arrived during the drag, and stays out of one that left', () => {
    const current = [...shown.filter((x) => x.id !== 'c'), t('new', { day: OTHER, order: 3 })]
    const next = revertPreview(current, before, shown)
    expect(next.map((x) => x.id).sort()).toEqual(['a', 'b', 'new'])
    expect(find(next, 'new')).toMatchObject({ day: OTHER, order: 3 })
  })

  it('returns the same board when the preview has already gone', () => {
    expect(revertPreview(before, before, shown)).toBe(before)
  })
})
