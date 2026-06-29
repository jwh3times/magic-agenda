import { describe, it, expect } from 'vitest'
import { notesForDay, tasksForStatus, buildMonthGrid, applyToggleDone } from './selectors'
import type { Task } from '../types/task'

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

describe('notesForDay', () => {
  const tasks = [
    t('a', { day: '2026-06-29', order: 2 }),
    t('b', { day: '2026-06-29', order: 0 }),
    t('c', { day: 'inbox', order: 0 }),
    t('d', { day: '2026-06-29', order: 1 }),
  ]
  it('filters by day and sorts by order', () => {
    expect(notesForDay(tasks, '2026-06-29').map((x) => x.id)).toEqual(['b', 'd', 'a'])
  })
  it('can exclude an id (the dragged task)', () => {
    expect(notesForDay(tasks, '2026-06-29', 'd').map((x) => x.id)).toEqual(['b', 'a'])
  })
})

describe('tasksForStatus', () => {
  const tasks = [
    t('a', { status: 'doing', korder: 1 }),
    t('b', { status: 'doing', korder: 0 }),
    t('c', { status: 'done', korder: 0 }),
  ]
  it('filters by status and sorts by korder', () => {
    expect(tasksForStatus(tasks, 'doing').map((x) => x.id)).toEqual(['b', 'a'])
  })
})

describe('buildMonthGrid', () => {
  it('always returns 42 cells starting on a Sunday', () => {
    const { cells, weekdays } = buildMonthGrid(2026, 5, '2026-06-29') // June 2026
    expect(cells).toHaveLength(42)
    expect(weekdays[0]).toBe('Sun')
    // June 1 2026 is a Monday, so the grid starts on Sun May 31.
    expect(cells[0].dateStr).toBe('2026-05-31')
    expect(cells[0].inMonth).toBe(false)
    const today = cells.find((c) => c.dateStr === '2026-06-29')
    expect(today?.isToday).toBe(true)
    expect(today?.inMonth).toBe(true)
  })
})

describe('applyToggleDone', () => {
  it('marks done, flips status, and bumps korder to the bottom of done', () => {
    const tasks = [
      t('a', { status: 'done', korder: 0 }),
      t('b', { status: 'done', korder: 1 }),
      t('x', { status: 'todo', korder: 5 }),
    ]
    const { tasks: next, justDone } = applyToggleDone(tasks, 'x')
    const x = next.find((n) => n.id === 'x')!
    expect(justDone).toBe(true)
    expect(x.status).toBe('done')
    expect(x.done).toBe(true)
    expect(x.korder).toBe(2) // max(0,1) + 1
  })
  it('un-done flips status back to todo', () => {
    const { tasks: next } = applyToggleDone([t('a', { status: 'done', done: true })], 'a')
    expect(next[0].status).toBe('todo')
    expect(next[0].done).toBe(false)
  })
})
