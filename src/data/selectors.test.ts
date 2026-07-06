import { describe, it, expect } from 'vitest'
import {
  notesForDay,
  tasksForStatus,
  buildMonthGrid,
  buildWeekCells,
  agendaGroups,
  applyToggleDone,
} from './selectors'
import { NO_RECUR, type Task } from '../types/task'

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
    atTime: null,
    pinned: false,
    order: 0,
    korder: 0,
    ...NO_RECUR,
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

describe('buildWeekCells', () => {
  it('returns 7 days from the given Sunday and flags today', () => {
    const cells = buildWeekCells(new Date(2026, 5, 28), '2026-06-29') // Sun Jun 28 2026
    expect(cells).toHaveLength(7)
    expect(cells[0].dateStr).toBe('2026-06-28')
    expect(cells[6].dateStr).toBe('2026-07-04')
    expect(cells.find((c) => c.dateStr === '2026-06-29')?.isToday).toBe(true)
  })
})

describe('agendaGroups', () => {
  it('groups scheduled tasks by day ascending, excluding inbox', () => {
    const tasks = [
      t('a', { day: '2026-07-02', order: 1 }),
      t('b', { day: '2026-07-01', order: 0 }),
      t('c', { day: '2026-07-02', order: 0 }),
      t('d', { day: 'inbox' }),
    ]
    const groups = agendaGroups(tasks)
    expect(groups.map((g) => g.day)).toEqual(['2026-07-01', '2026-07-02'])
    expect(groups[1].tasks.map((x) => x.id)).toEqual(['c', 'a']) // sorted by order
  })

  it('sorts timed tasks first within a day, then by time, then order', () => {
    const day = '2026-07-10'
    const tasks = [
      t('untimed-early', { day, order: 0, atTime: null }),
      t('late', { day, order: 1, atTime: '15:00' }),
      t('early', { day, order: 2, atTime: '09:00' }),
      t('tie-b', { day, order: 4, atTime: '09:00' }),
    ]
    const [group] = agendaGroups(tasks)
    expect(group.tasks.map((x) => x.id)).toEqual(['early', 'tie-b', 'late', 'untimed-early'])
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
