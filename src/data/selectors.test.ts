import { describe, it, test, expect } from 'vitest'
import {
  notesForDay,
  tasksForStatus,
  buildMonthGrid,
  buildWeekCells,
  agendaGroups,
  applyToggleDone,
  isOverdue,
  overdueTasks,
  applyRollForward,
} from './selectors'
import { missingInstances, type RecurRule } from './recurrence'
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

test('isOverdue: past + scheduled + not done, nothing else', () => {
  const today = '2026-07-10'
  expect(isOverdue(t('a', { day: '2026-07-09', status: 'todo' }), today)).toBe(true)
  expect(isOverdue(t('a', { day: '2026-07-09', status: 'done' }), today)).toBe(false)
  expect(isOverdue(t('a', { day: '2026-07-10' }), today)).toBe(false)
  expect(isOverdue(t('a', { day: 'inbox' }), today)).toBe(false)
})

test('overdueTasks sorts by day then manual order', () => {
  const today = '2026-07-10'
  const tasks = [
    t('b', { day: '2026-07-09', order: 1 }),
    t('c', { day: '2026-07-09', order: 0 }),
    t('a', { day: '2026-07-01', order: 5 }),
    t('x', { day: '2026-07-11', order: 0 }),
  ]
  expect(overdueTasks(tasks, today).map((x) => x.id)).toEqual(['a', 'c', 'b'])
})

test('applyRollForward appends overdue tasks after today existing order', () => {
  const today = '2026-07-10'
  const tasks = [
    t('today-1', { day: today, order: 3 }),
    t('old-late', { day: '2026-07-09', order: 1, recurOriginDay: '2026-07-09' }),
    t('old-early', { day: '2026-07-01', order: 0 }),
    t('done-old', { day: '2026-07-01', order: 1, status: 'done' }),
  ]
  const { tasks: next, changed } = applyRollForward(tasks, today)
  expect(changed.map((x) => x.id)).toEqual(['old-early', 'old-late'])
  const early = next.find((x) => x.id === 'old-early')!
  const late = next.find((x) => x.id === 'old-late')!
  expect(early.day).toBe(today)
  expect(early.order).toBe(4)
  expect(late.order).toBe(5)
  // Occurrence identity never moves with the card.
  expect(late.recurOriginDay).toBe('2026-07-09')
  expect(next.find((x) => x.id === 'done-old')!.day).toBe('2026-07-01')
})

test('applyRollForward is a referential no-op when nothing is overdue', () => {
  const tasks = [t('a', { day: '2026-07-10' })]
  const res = applyRollForward(tasks, '2026-07-10')
  expect(res.tasks).toBe(tasks)
  expect(res.changed).toEqual([])
})

test('applyRollForward with onlyIds moves only the overdue tasks in the set', () => {
  const today = '2026-07-10'
  const tasks = [
    t('today-1', { day: today, order: 3 }),
    t('old-a', { day: '2026-07-09', order: 1 }),
    t('old-b', { day: '2026-07-01', order: 0 }),
  ]
  const onlyIds = new Set(['old-a'])
  const { tasks: next, changed } = applyRollForward(tasks, today, onlyIds)
  expect(changed.map((x) => x.id)).toEqual(['old-a'])
  const movedA = next.find((x) => x.id === 'old-a')!
  const untouchedB = next.find((x) => x.id === 'old-b')!
  expect(movedA.day).toBe(today)
  expect(movedA.order).toBe(4) // base = max(today orders)=3 + 1
  // Still overdue, but excluded from onlyIds, so it stays put.
  expect(untouchedB.day).toBe('2026-07-01')
  expect(untouchedB.order).toBe(0)
})

test('applyRollForward with onlyIds is a referential no-op when no overdue task is in the set', () => {
  const today = '2026-07-10'
  const tasks = [t('old', { day: '2026-07-01' })]
  const res = applyRollForward(tasks, today, new Set(['not-present']))
  expect(res.tasks).toBe(tasks)
  expect(res.changed).toEqual([])
})

describe('applyRollForward + missingInstances (regression)', () => {
  // Regression for: rolling an overdue recurring instance forward (its `day` moves to today,
  // but `recurOriginDay` stays put) must not make the materializer regenerate a duplicate on
  // the instance's original occurrence day.
  it('still covers its origin occurrence after being rolled forward, so the old day is not regenerated', () => {
    const today = '2026-07-10'
    // Biweekly (interval 2) from 07-03 so occurrences are 07-03, 07-17, 07-31 — `today` itself
    // is deliberately not an occurrence, keeping the assertions about the old day unambiguous.
    const template: RecurRule = {
      day: '2026-07-03',
      recurFreq: 'weekly',
      recurInterval: 2,
      recurUntil: null,
      recurSkip: [],
    }
    const instance = t('inst', {
      day: '2026-07-03',
      recurOriginDay: '2026-07-03',
      recurParentId: 'template-1',
      status: 'todo',
    })

    // Baseline: the instance (still on its own day) already covers occurrence 07-03.
    const before = missingInstances(template, [instance], today, 30)
    expect(before).not.toContain('2026-07-03')
    expect(before).toEqual(['2026-07-17', '2026-07-31'])

    // Roll the overdue instance forward: day -> today, origin untouched.
    const { tasks: rolled, changed } = applyRollForward([instance], today)
    const moved = rolled.find((x) => x.id === 'inst')!
    expect(changed.map((x) => x.id)).toEqual(['inst'])
    expect(moved.day).toBe(today)
    expect(moved.recurOriginDay).toBe('2026-07-03')

    // After the move, occurrence 07-03 must still read as covered — not regenerated.
    const after = missingInstances(template, [moved], today, 30)
    expect(after).not.toContain('2026-07-03')
    expect(after).toEqual(before)
  })
})
