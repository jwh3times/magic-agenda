import { describe, expect, it } from 'vitest'
import { asTask, isOccurrence, NO_RECUR, type TaskDraft } from './task'

function draft(over: Partial<TaskDraft> = {}): TaskDraft {
  return {
    id: 'd1',
    title: 'Standup',
    description: '',
    labelId: null,
    color: 'yellow',
    checklist: [],
    status: 'todo',
    completedAt: null,
    reopenStatus: 'todo',
    archivedAt: null,
    day: '2026-07-06',
    atTime: null,
    pinned: false,
    order: 0,
    korder: 0,
    ...NO_RECUR,
    ...over,
  }
}

/**
 * An editor draft for an Occurrence, as `Board.openTask` builds it: the row plus its Series' Rule.
 * This is the input shape #345 is about — it names a parent *and* carries Rule parameters.
 */
const occurrenceDraft = (over: Partial<TaskDraft> = {}) =>
  draft({
    recurParentId: 'series',
    occurrenceDate: '2026-07-06',
    recurFreq: 'weekly',
    recurUntil: '2026-12-31',
    recurInterval: 3,
    recurWeekdays: [1, 3],
    recurCount: 5,
    excludedDates: ['2026-07-13'],
    ...over,
  })

describe('asTask narrowing a draft to an Occurrence (#345)', () => {
  it('clears the Rule parameters the database couples to recur_freq', () => {
    const task = asTask(occurrenceDraft())
    expect(isOccurrence(task)).toBe(true)
    // Each asserted separately so a mutation removing one reset fails on a named line.
    expect(task.recurWeekdays).toEqual([])
    expect(task.recurCount).toBeNull()
  })

  it('still clears the union discriminants', () => {
    const task = asTask(occurrenceDraft())
    expect(task.recurFreq).toBe('none')
    expect(task.recurUntil).toBeNull()
    expect(task.recurParentId).toBe('series')
    expect(task.occurrenceDate).toBe('2026-07-06')
  })

  it('leaves recurInterval and excludedDates alone, so database rows keep round-tripping', () => {
    // Neither is CHECK-coupled, so a stored Occurrence may legally hold these values; resetting
    // them would make `rowToTask` rewrite the row on its next write.
    const task = asTask(occurrenceDraft())
    expect(task.recurInterval).toBe(3)
    expect(task.excludedDates).toEqual(['2026-07-13'])
  })

  it('does not disturb a Series definition, which keeps its whole Rule', () => {
    // Positive control: the reset is confined to the Occurrence branch. Were it hoisted to run on
    // every shape, this is the test that would say so.
    const task = asTask(occurrenceDraft({ recurParentId: null, occurrenceDate: null }))
    expect(isOccurrence(task)).toBe(false)
    expect(task.recurFreq).toBe('weekly')
    expect(task.recurWeekdays).toEqual([1, 3])
    expect(task.recurCount).toBe(5)
  })

  it('also clears them on a standalone Task, as it already did', () => {
    const task = asTask(
      occurrenceDraft({ recurParentId: null, occurrenceDate: null, recurFreq: 'none' }),
    )
    expect(task.recurWeekdays).toEqual([])
    expect(task.recurCount).toBeNull()
  })
})
