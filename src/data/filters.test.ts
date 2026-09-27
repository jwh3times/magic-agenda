import { describe, it, expect } from 'vitest'
import { applyFilters, isFilterActive, EMPTY_FILTER } from './filters'
import { asTask, NO_RECUR, type Task, type TaskDraft } from '../types/task'

function t(id: string, over: Partial<TaskDraft> = {}): Task {
  return asTask({
    id,
    title: id,
    description: '',
    labelId: 'work-label',
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

const tasks = [
  t('a', {
    title: 'Finish Q3 deck',
    description: 'pull numbers',
    labelId: 'work-label',
    assigneeId: null,
    status: 'doing',
  }),
  t('b', { title: 'Call plumber', labelId: 'errands-label', status: 'todo' }),
  t('c', { title: 'Gym', labelId: null, status: 'completed' }),
]

describe('isFilterActive', () => {
  it('is false for the empty filter', () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false)
  })
  it('is true when any facet is set', () => {
    expect(isFilterActive({ ...EMPTY_FILTER, text: 'x' })).toBe(true)
    expect(isFilterActive({ ...EMPTY_FILTER, labelId: 'work-label' })).toBe(true)
    expect(isFilterActive({ ...EMPTY_FILTER, labelId: 'unlabeled' })).toBe(true)
    expect(isFilterActive({ ...EMPTY_FILTER, status: 'completed' })).toBe(true)
  })
})

describe('applyFilters', () => {
  it('returns all tasks for the empty filter', () => {
    expect(applyFilters(tasks, EMPTY_FILTER)).toHaveLength(3)
  })
  it('matches text in title or description, case-insensitive', () => {
    expect(applyFilters(tasks, { ...EMPTY_FILTER, text: 'FINISH' }).map((x) => x.id)).toEqual(['a'])
    expect(applyFilters(tasks, { ...EMPTY_FILTER, text: 'numbers' }).map((x) => x.id)).toEqual([
      'a',
    ])
  })
  it('filters by Label id and by the first-class Unlabeled state', () => {
    expect(
      applyFilters(tasks, { ...EMPTY_FILTER, labelId: 'errands-label' }).map((x) => x.id),
    ).toEqual(['b'])
    expect(applyFilters(tasks, { ...EMPTY_FILTER, labelId: 'unlabeled' }).map((x) => x.id)).toEqual(
      ['c'],
    )
  })
  it('filters by status', () => {
    expect(applyFilters(tasks, { ...EMPTY_FILTER, status: 'completed' }).map((x) => x.id)).toEqual([
      'c',
    ])
  })
  it('combines facets with AND', () => {
    expect(
      applyFilters(tasks, {
        text: 'call',
        labelId: 'errands-label',
        assignedTo: null,
        status: 'todo',
        pinned: false,
      }).map((x) => x.id),
    ).toEqual(['b'])
    expect(
      applyFilters(tasks, {
        text: 'call',
        labelId: 'work-label',
        status: 'todo',
        pinned: false,
        assignedTo: null,
      }),
    ).toHaveLength(0)
  })
})

describe('pinned facet', () => {
  it('keeps only pinned tasks and counts as an active filter', () => {
    const pinTasks = [t('a', { pinned: true }), t('b', { pinned: false })]
    const q = { ...EMPTY_FILTER, pinned: true }
    expect(applyFilters(pinTasks, q).map((x) => x.id)).toEqual(['a'])
    expect(isFilterActive(q)).toBe(true)
    expect(isFilterActive(EMPTY_FILTER)).toBe(false)
  })
})

describe('assignedTo (#440)', () => {
  const assigned = [
    t('mine', { assigneeId: 'me' }),
    t('theirs', { assigneeId: 'them' }),
    t('nobody', { assigneeId: null }),
  ]
  it('keeps only the named account’s Tasks, and counts as an active filter', () => {
    const query = { ...EMPTY_FILTER, assignedTo: 'me' }
    expect(applyFilters(assigned, query).map((x) => x.id)).toEqual(['mine'])
    expect(isFilterActive(query)).toBe(true)
  })
  it('is off when null', () => {
    expect(applyFilters(assigned, EMPTY_FILTER)).toHaveLength(3)
  })
})
