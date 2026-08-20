import { describe, it, expect } from 'vitest'
import {
  occurrenceDates,
  missingInstanceDates,
  missingInstances,
  occurrenceDateOf,
  isFromOccurrenceOnward,
  type RecurRule,
} from './recurrence'
import { addDays, parseDay, ymd } from '../lib/dates'

describe('occurrenceDates', () => {
  it('returns nothing for freq none', () => {
    expect(occurrenceDates('none', 1, '2026-07-01', null, '2026-07-01', '2026-12-31')).toEqual([])
  })

  it('weekly steps by 7 days up to the horizon (inclusive)', () => {
    expect(occurrenceDates('weekly', 1, '2026-07-01', null, '2026-07-01', '2026-07-29')).toEqual([
      '2026-07-01',
      '2026-07-08',
      '2026-07-15',
      '2026-07-22',
      '2026-07-29',
    ])
  })

  it('honours the interval for daily', () => {
    expect(occurrenceDates('daily', 2, '2026-07-01', null, '2026-07-01', '2026-07-07')).toEqual([
      '2026-07-01',
      '2026-07-03',
      '2026-07-05',
      '2026-07-07',
    ])
  })

  it('steps monthly', () => {
    expect(occurrenceDates('monthly', 1, '2026-07-15', null, '2026-07-15', '2026-09-30')).toEqual([
      '2026-07-15',
      '2026-08-15',
      '2026-09-15',
    ])
  })

  it('stops at recur_until', () => {
    expect(
      occurrenceDates('weekly', 1, '2026-07-01', '2026-07-15', '2026-07-01', '2026-07-29'),
    ).toEqual(['2026-07-01', '2026-07-08', '2026-07-15'])
  })

  it('omits skipped dates', () => {
    expect(
      occurrenceDates('weekly', 1, '2026-07-01', null, '2026-07-01', '2026-07-22', ['2026-07-08']),
    ).toEqual(['2026-07-01', '2026-07-15', '2026-07-22'])
  })

  it('emits nothing before `from`, keeping the anchor as the phase (#210)', () => {
    // Anchor 07-01 weekly lands on 01, 08, 15, 22, 29. `from` filters that set; it does not
    // re-anchor the rule, which is why the first result is 07-22 rather than 07-20.
    expect(occurrenceDates('weekly', 1, '2026-07-01', null, '2026-07-20', '2026-08-05')).toEqual([
      '2026-07-22',
      '2026-07-29',
      '2026-08-05',
    ])
  })

  it('keeps interval phase when `from` falls between two occurrences', () => {
    // Every 3 days from 07-01: 01, 04, 07, 10, 13, 16, 19, 22. A `from` that re-anchored the rule
    // would answer 07-20 and 07-23 instead.
    expect(occurrenceDates('daily', 3, '2026-07-01', null, '2026-07-20', '2026-07-25')).toEqual([
      '2026-07-22',
      '2026-07-25',
    ])
  })

  it('reaches the window from a years-old anchor instead of truncating (#210)', () => {
    // ~1,277 daily steps separate the anchor from the window. The old iteration ceiling stopped
    // the walk at 1,000 — still in 2025 — so this window came back empty, with nothing reported.
    expect(occurrenceDates('daily', 1, '2023-01-01', null, '2026-07-01', '2026-07-04')).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
    ])
  })

  it('does not re-phase a monthly rule whose anchor overflows a short month', () => {
    // `addMonths` overflows rather than clamps, so a walk from Jan 31 reaches Mar 3 (not Feb 28)
    // and carries that drift onward. Jumping n months in one go would answer the 31st instead —
    // which is why the monthly walk is never fast-forwarded.
    expect(occurrenceDates('monthly', 1, '2026-01-31', null, '2026-05-01', '2026-07-31')).toEqual([
      '2026-05-03',
      '2026-06-03',
      '2026-07-03',
    ])
  })

  it('ignores a `from` that precedes the anchor', () => {
    expect(occurrenceDates('weekly', 1, '2026-07-01', null, '2026-01-01', '2026-07-15')).toEqual([
      '2026-07-01',
      '2026-07-08',
      '2026-07-15',
    ])
  })

  it('starting the walk near `from` cannot change which dates are emitted', () => {
    // The daily/weekly fast-forward is an optimization, so it is pinned against a naive walk that
    // has none. Anchors straddle a leap day, month ends, and a US DST transition (2026-03-08).
    const naive = (
      freq: 'daily' | 'weekly',
      interval: number,
      anchor: string,
      from: string,
      to: string,
    ) => {
      const stepDays = freq === 'daily' ? interval : 7 * interval
      const out: string[] = []
      for (let d = parseDay(anchor); ymd(d) <= to; d = addDays(d, stepDays)) {
        if (ymd(d) >= from) out.push(ymd(d))
      }
      return out
    }
    const cases: ['daily' | 'weekly', number, string, string, string][] = [
      ['daily', 1, '2024-02-27', '2026-07-01', '2026-07-10'],
      ['daily', 3, '2023-11-01', '2026-03-08', '2026-03-20'],
      ['daily', 7, '2025-12-31', '2026-07-01', '2026-07-30'],
      ['weekly', 1, '2024-02-29', '2026-07-01', '2026-08-15'],
      ['weekly', 2, '2023-01-01', '2026-07-01', '2026-09-01'],
    ]
    for (const [freq, interval, anchor, from, to] of cases) {
      expect(occurrenceDates(freq, interval, anchor, null, from, to)).toEqual(
        naive(freq, interval, anchor, from, to),
      )
    }
  })
})

function rule(over: Partial<RecurRule> = {}): RecurRule {
  return {
    day: '2026-07-01',
    recurFreq: 'weekly',
    recurInterval: 1,
    recurUntil: null,
    excludedDates: [],
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
    const missing = missingInstanceDates(
      rule({ excludedDates: ['2026-07-08'] }),
      [],
      '2026-07-01',
      14,
    )
    expect(missing).toEqual(['2026-07-01', '2026-07-15'])
  })

  it('materializes only from today forward for a rule anchored in the past (#210)', () => {
    // Anchor a year back, weekly: on-phase dates near today are 07-01, 07-08, 07-15. Walking from
    // the anchor would have inserted ~52 rows for dates that are already gone.
    expect(missingInstanceDates(rule({ day: '2025-07-02' }), [], '2026-07-01', 14)).toEqual([
      '2026-07-01',
      '2026-07-08',
      '2026-07-15',
    ])
  })

  it('reports the whole window for a daily rule anchored years back', () => {
    // The count is the point: four dates, not the 1,000 the old iteration ceiling truncated to.
    expect(
      missingInstanceDates(rule({ day: '2023-01-01', recurFreq: 'daily' }), [], '2026-07-01', 2),
    ).toEqual(['2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03'])
  })

  it('allows one day of slack below today for clock skew', () => {
    // Without the grace day this answers 07-01 and 07-02 only. See MATERIALIZE_GRACE_DAYS.
    expect(
      missingInstanceDates(rule({ day: '2026-06-01', recurFreq: 'daily' }), [], '2026-07-01', 1),
    ).toEqual(['2026-06-30', '2026-07-01', '2026-07-02'])
  })

  it('is empty for a non-recurring or unscheduled template', () => {
    expect(missingInstanceDates(rule({ recurFreq: 'none' }), [], '2026-07-01', 90)).toEqual([])
    expect(missingInstanceDates(rule({ day: 'inbox' }), [], '2026-07-01', 90)).toEqual([])
  })
})

describe('occurrenceDateOf', () => {
  it('is the recorded origin day when present', () => {
    expect(occurrenceDateOf({ occurrenceDate: '2026-07-08', day: '2026-07-10' })).toBe('2026-07-08')
  })

  it('falls back to the current day for legacy instances without an origin', () => {
    expect(occurrenceDateOf({ occurrenceDate: null, day: '2026-07-08' })).toBe('2026-07-08')
  })
})

describe('missingInstances', () => {
  // today 2026-07-01, horizon 14 days -> end 2026-07-15: occurrences 07-01, 07-08, 07-15
  it('does not regenerate an occurrence whose instance was dragged to another day', () => {
    // The 07-08 instance was moved to 07-10; its origin still covers occurrence 07-08.
    const existing = [{ occurrenceDate: '2026-07-08', day: '2026-07-10' }]
    expect(missingInstances(rule(), existing, '2026-07-01', 14)).toEqual([
      '2026-07-01',
      '2026-07-15',
    ])
  })

  it('covers occurrences by origin for legacy instances that predate origin tracking', () => {
    const existing = [{ occurrenceDate: null, day: '2026-07-08' }]
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
      isFromOccurrenceOnward({ occurrenceDate: '2026-07-15', day: '2026-07-02' }, '2026-07-08'),
    ).toBe(true)
  })

  it('excludes an instance whose origin precedes the cut even when dragged to a later day', () => {
    // The crux: day 07-20 is >= cut, but origin 07-01 is not — scope by origin, not day.
    expect(
      isFromOccurrenceOnward({ occurrenceDate: '2026-07-01', day: '2026-07-20' }, '2026-07-08'),
    ).toBe(false)
  })

  it('includes the cut occurrence itself (inclusive boundary)', () => {
    expect(
      isFromOccurrenceOnward({ occurrenceDate: '2026-07-08', day: '2026-07-08' }, '2026-07-08'),
    ).toBe(true)
  })

  it('falls back to day for legacy instances without an origin', () => {
    expect(isFromOccurrenceOnward({ occurrenceDate: null, day: '2026-07-15' }, '2026-07-08')).toBe(
      true,
    )
    expect(isFromOccurrenceOnward({ occurrenceDate: null, day: '2026-07-01' }, '2026-07-08')).toBe(
      false,
    )
  })
})
