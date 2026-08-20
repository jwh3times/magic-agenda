import { describe, it, expect } from 'vitest'
import {
  FIELD_OWNER,
  PER_OCCURRENCE_FIELDS,
  RULE_EDITABLE_FIELDS,
  RULE_UNEDITABLE,
  SERIES_CONTENT_DEFERRED,
  SERIES_CONTENT_FIELDS,
  pick,
} from './fieldOwnership'
import { NO_RECUR, type Task } from '../types/task'

const sample: Task = {
  id: 'a',
  title: 'T',
  description: 'd',
  labelId: null,
  color: 'yellow',
  checklist: [],
  status: 'todo',
  done: false,
  day: '2026-07-08',
  atTime: null,
  pinned: false,
  order: 0,
  korder: 0,
  ...NO_RECUR,
}

const sorted = (s: ReadonlySet<keyof Task>) => [...s].sort()

describe('FIELD_OWNER', () => {
  it('covers every Task field exactly once', () => {
    // The compile-time guard is the mapped type over `keyof Task` — omitting a field is TS2741.
    // This is the runtime half: a field added to Task but not here would show up as a gap.
    expect(sorted(new Set(Object.keys(FIELD_OWNER) as (keyof Task)[]))).toEqual(
      (Object.keys(sample) as (keyof Task)[]).sort(),
    )
  })

  it('assigns each field a single owner', () => {
    for (const [field, owner] of Object.entries(FIELD_OWNER)) {
      expect(typeof owner, `${field} has no owner`).toBe('string')
    }
  })
})

describe('derived scope lists', () => {
  it('per-occurrence is occurrence state plus placement', () => {
    expect(sorted(PER_OCCURRENCE_FIELDS)).toEqual([
      'day',
      'done',
      'korder',
      'order',
      'pinned',
      'status',
    ])
  })

  it('series content excludes the checklist while #214 is open', () => {
    expect(sorted(SERIES_CONTENT_FIELDS)).toEqual([
      'atTime',
      'color',
      'description',
      'labelId',
      'title',
    ])
  })

  it('names exactly one deferred Series Content field, so the exception cannot grow quietly', () => {
    expect(sorted(SERIES_CONTENT_DEFERRED)).toEqual(['checklist'])
  })

  it('rule fields an edit may carry exclude excludedDates', () => {
    // The trap: a draft is an Occurrence, whose excludedDates is always empty. Copying it onto the
    // Series would erase every Excluded Date and resurrect every deleted Occurrence.
    expect(sorted(RULE_EDITABLE_FIELDS)).toEqual(['recurFreq', 'recurInterval', 'recurUntil'])
    expect(sorted(RULE_UNEDITABLE)).toEqual(['excludedDates'])
  })

  it('the scope lists are disjoint and jointly cover every editable field', () => {
    const editable = (Object.keys(FIELD_OWNER) as (keyof Task)[]).filter(
      (k) => FIELD_OWNER[k] !== 'identity',
    )
    const union = new Set([
      ...PER_OCCURRENCE_FIELDS,
      ...SERIES_CONTENT_FIELDS,
      ...SERIES_CONTENT_DEFERRED,
      ...RULE_EDITABLE_FIELDS,
      ...RULE_UNEDITABLE,
    ])
    expect(sorted(union)).toEqual(editable.sort())
    // Disjoint: nothing is both per-occurrence and series-owned.
    for (const k of PER_OCCURRENCE_FIELDS) {
      expect(SERIES_CONTENT_FIELDS.has(k), `${k} is in both lists`).toBe(false)
      expect(RULE_EDITABLE_FIELDS.has(k), `${k} is in both lists`).toBe(false)
    }
  })
})

describe('pick', () => {
  it('takes only the named fields', () => {
    expect(pick({ ...sample, title: 'X', pinned: true }, SERIES_CONTENT_FIELDS)).toEqual({
      title: 'X',
      description: 'd',
      labelId: null,
      color: 'yellow',
      atTime: null,
    })
  })
})
