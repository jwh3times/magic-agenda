import { describe, it, expect } from 'vitest'
import { applyFilters, isFilterActive, EMPTY_FILTER } from './filters'
import { NO_RECUR, type Task } from '../types/task'

function t(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: '',
    labelId: 'work-label',
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

const tasks = [
  t('a', {
    title: 'Finish Q3 deck',
    description: 'pull numbers',
    labelId: 'work-label',
    status: 'doing',
  }),
  t('b', { title: 'Call plumber', labelId: 'errands-label', status: 'todo' }),
  t('c', { title: 'Gym', labelId: null, status: 'done' }),
]

describe('isFilterActive', () => {
  it('is false for the empty filter', () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false)
  })
  it('is true when any facet is set', () => {
    expect(isFilterActive({ ...EMPTY_FILTER, text: 'x' })).toBe(true)
    expect(isFilterActive({ ...EMPTY_FILTER, labelId: 'work-label' })).toBe(true)
    expect(isFilterActive({ ...EMPTY_FILTER, labelId: 'unlabeled' })).toBe(true)
    expect(isFilterActive({ ...EMPTY_FILTER, status: 'done' })).toBe(true)
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
    expect(applyFilters(tasks, { ...EMPTY_FILTER, status: 'done' }).map((x) => x.id)).toEqual(['c'])
  })
  it('combines facets with AND', () => {
    expect(
      applyFilters(tasks, {
        text: 'call',
        labelId: 'errands-label',
        status: 'todo',
        pinned: false,
      }).map((x) => x.id),
    ).toEqual(['b'])
    expect(
      applyFilters(tasks, { text: 'call', labelId: 'work-label', status: 'todo', pinned: false }),
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
