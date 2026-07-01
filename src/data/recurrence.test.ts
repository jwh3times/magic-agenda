import { describe, it, expect } from 'vitest'
import {
  occurrenceDates,
  missingInstanceDates,
  missingInstances,
  instanceOrigin,
  isFromOccurrenceOnward,
  type RecurRule,
} from './recurrence'

describe('occurrenceDates', () => {
  it('returns nothing for freq none', () => {
    expect(occurrenceDates('none', 1, '2026-07-01', null, '2026-12-31')).toEqual([])
  })

  it('weekly steps by 7 days up to the horizon (inclusive)', () => {
    expect(occurrenceDates('weekly', 1, '2026-07-01', null, '2026-07-29')).toEqual([
      '2026-07-01',
      '2026-07-08',
      '2026-07-15',
      '2026-07-22',
      '2026-07-29',
    ])
  })

  it('honours the interval for daily', () => {
    expect(occurrenceDates('daily', 2, '2026-07-01', null, '2026-07-07')).toEqual([
      '2026-07-01',
      '2026-07-03',
      '2026-07-05',
      '2026-07-07',
    ])
  })

  it('steps monthly', () => {
    expect(occurrenceDates('monthly', 1, '2026-07-15', null, '2026-09-30')).toEqual([
      '2026-07-15',
      '2026-08-15',
      '2026-09-15',
    ])
  })

  it('stops at recur_until', () => {
    expect(occurrenceDates('weekly', 1, '2026-07-01', '2026-07-15', '2026-07-29')).toEqual([
      '2026-07-01',
      '2026-07-08',
      '2026-07-15',
    ])
  })

  it('omits skipped dates', () => {
    expect(occurrenceDates('weekly', 1, '2026-07-01', null, '2026-07-22', ['2026-07-08'])).toEqual([
      '2026-07-01',
      '2026-07-15',
      '2026-07-22',
    ])
  })
})

function rule(over: Partial<RecurRule> = {}): RecurRule {
  return {
    day: '2026-07-01',
    recurFreq: 'weekly',
    recurInterval: 1,
    recurUntil: null,
    recurSkip: [],
    ...over,
  }
}

describe('missingInstanceDates', () => {
  it('returns occurrences within the horizon that have no instance yet', () => {
    // today 2026-07-01, horizon 14 days -> end 2026-07-15: occurrences 07-01, 07-08, 07-15
    const missing = missingInstanceDates(rule(), ['2026-07-08'], '2026-07-01', 14)
    expect(missing).toEqual(['2026-07-01', '2026-07-15'])
  })

  it('does not regenerate skipped (deleted) occurrences', () => {
    const missing = missingInstanceDates(rule({ recurSkip: ['2026-07-08'] }), [], '2026-07-01', 14)
    expect(missing).toEqual(['2026-07-01', '2026-07-15'])
  })

  it('is empty for a non-recurring or unscheduled template', () => {
    expect(missingInstanceDates(rule({ recurFreq: 'none' }), [], '2026-07-01', 90)).toEqual([])
    expect(missingInstanceDates(rule({ day: 'inbox' }), [], '2026-07-01', 90)).toEqual([])
  })
})

describe('instanceOrigin', () => {
  it('is the recorded origin day when present', () => {
    expect(instanceOrigin({ recurOriginDay: '2026-07-08', day: '2026-07-10' })).toBe('2026-07-08')
  })

  it('falls back to the current day for legacy instances without an origin', () => {
    expect(instanceOrigin({ recurOriginDay: null, day: '2026-07-08' })).toBe('2026-07-08')
  })
})

describe('missingInstances', () => {
  // today 2026-07-01, horizon 14 days -> end 2026-07-15: occurrences 07-01, 07-08, 07-15
  it('does not regenerate an occurrence whose instance was dragged to another day', () => {
    // The 07-08 instance was moved to 07-10; its origin still covers occurrence 07-08.
    const existing = [{ recurOriginDay: '2026-07-08', day: '2026-07-10' }]
    expect(missingInstances(rule(), existing, '2026-07-01', 14)).toEqual([
      '2026-07-01',
      '2026-07-15',
    ])
  })

  it('covers occurrences by origin for legacy instances that predate origin tracking', () => {
    const existing = [{ recurOriginDay: null, day: '2026-07-08' }]
    expect(missingInstances(rule(), existing, '2026-07-01', 14)).toEqual([
      '2026-07-01',
      '2026-07-15',
    ])
  })

  it('still reports genuinely missing occurrences', () => {
    expect(missingInstances(rule(), [], '2026-07-01', 14)).toEqual([
      '2026-07-01',
      '2026-07-08',
      '2026-07-15',
    ])
  })
})

describe('isFromOccurrenceOnward', () => {
  it('includes an instance whose origin is at or after the cut', () => {
    expect(
      isFromOccurrenceOnward({ recurOriginDay: '2026-07-15', day: '2026-07-02' }, '2026-07-08'),
    ).toBe(true)
  })

  it('excludes an instance whose origin precedes the cut even when dragged to a later day', () => {
    // The crux: day 07-20 is >= cut, but origin 07-01 is not — scope by origin, not day.
    expect(
      isFromOccurrenceOnward({ recurOriginDay: '2026-07-01', day: '2026-07-20' }, '2026-07-08'),
    ).toBe(false)
  })

  it('includes the cut occurrence itself (inclusive boundary)', () => {
    expect(
      isFromOccurrenceOnward({ recurOriginDay: '2026-07-08', day: '2026-07-08' }, '2026-07-08'),
    ).toBe(true)
  })

  it('falls back to day for legacy instances without an origin', () => {
    expect(isFromOccurrenceOnward({ recurOriginDay: null, day: '2026-07-15' }, '2026-07-08')).toBe(
      true,
    )
    expect(isFromOccurrenceOnward({ recurOriginDay: null, day: '2026-07-01' }, '2026-07-08')).toBe(
      false,
    )
  })
})
