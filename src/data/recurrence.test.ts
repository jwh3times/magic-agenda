import { describe, it, expect } from 'vitest'
import { occurrenceDates, missingInstanceDates, type RecurRule } from './recurrence'

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
