import { describe, it, expect } from 'vitest'
import {
  allOccurrenceDates,
  isBoundedRule,
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
    expect(occurrenceDates(rule({ recurFreq: 'none' }), '2026-07-01', '2026-12-31')).toEqual([])
  })

  it('weekly steps by 7 days up to the horizon (inclusive)', () => {
    expect(occurrenceDates(rule(), '2026-07-01', '2026-07-29')).toEqual([
      '2026-07-01',
      '2026-07-08',
      '2026-07-15',
      '2026-07-22',
      '2026-07-29',
    ])
  })

  it('honours the interval for daily', () => {
    expect(
      occurrenceDates(rule({ recurFreq: 'daily', recurInterval: 2 }), '2026-07-01', '2026-07-07'),
    ).toEqual(['2026-07-01', '2026-07-03', '2026-07-05', '2026-07-07'])
  })

  it('steps monthly', () => {
    expect(
      occurrenceDates(
        rule({ recurFreq: 'monthly', day: '2026-07-15' }),
        '2026-07-15',
        '2026-09-30',
      ),
    ).toEqual(['2026-07-15', '2026-08-15', '2026-09-15'])
  })

  it('stops at recur_until', () => {
    expect(occurrenceDates(rule({ recurUntil: '2026-07-15' }), '2026-07-01', '2026-07-29')).toEqual(
      ['2026-07-01', '2026-07-08', '2026-07-15'],
    )
  })

  it('omits skipped dates', () => {
    expect(
      occurrenceDates(rule({ excludedDates: ['2026-07-08'] }), '2026-07-01', '2026-07-22'),
    ).toEqual(['2026-07-01', '2026-07-15', '2026-07-22'])
  })

  it('emits nothing before `from`, keeping the anchor as the phase (#210)', () => {
    // Anchor 07-01 weekly lands on 01, 08, 15, 22, 29. `from` filters that set; it does not
    // re-anchor the rule, which is why the first result is 07-22 rather than 07-20.
    expect(occurrenceDates(rule(), '2026-07-20', '2026-08-05')).toEqual([
      '2026-07-22',
      '2026-07-29',
      '2026-08-05',
    ])
  })

  it('keeps interval phase when `from` falls between two occurrences', () => {
    // Every 3 days from 07-01: 01, 04, 07, 10, 13, 16, 19, 22. A `from` that re-anchored the rule
    // would answer 07-20 and 07-23 instead.
    expect(
      occurrenceDates(rule({ recurFreq: 'daily', recurInterval: 3 }), '2026-07-20', '2026-07-25'),
    ).toEqual(['2026-07-22', '2026-07-25'])
  })

  it('reaches the window from a years-old anchor instead of truncating (#210)', () => {
    // ~1,277 daily steps separate the anchor from the window. The old iteration ceiling stopped
    // the walk at 1,000 — still in 2025 — so this window came back empty, with nothing reported.
    expect(
      occurrenceDates(rule({ recurFreq: 'daily', day: '2023-01-01' }), '2026-07-01', '2026-07-04'),
    ).toEqual(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04'])
  })

  it('does not re-phase a monthly rule whose anchor overflows a short month', () => {
    // `addMonths` overflows rather than clamps, so a walk from Jan 31 reaches Mar 3 (not Feb 28)
    // and carries that drift onward. Jumping n months in one go would answer the 31st instead —
    // which is why the monthly walk is never fast-forwarded.
    expect(
      occurrenceDates(
        rule({ recurFreq: 'monthly', day: '2026-01-31' }),
        '2026-05-01',
        '2026-07-31',
      ),
    ).toEqual(['2026-05-03', '2026-06-03', '2026-07-03'])
  })

  it('ignores a `from` that precedes the anchor', () => {
    expect(occurrenceDates(rule(), '2026-01-01', '2026-07-15')).toEqual([
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
      expect(
        occurrenceDates(rule({ recurFreq: freq, recurInterval: interval, day: anchor }), from, to),
      ).toEqual(naive(freq, interval, anchor, from, to))
    }
  })
})

// 2026-07-01 is a Wednesday; 07-06 and 07-13 are Mondays, 07-03 and 07-10 Fridays. Every
// expectation below is a literal, so a change to the walk shows up as a diff of dates.
describe('occurrenceDates with a weekday set', () => {
  const weekly = (over: Partial<RecurRule> = {}) => rule({ recurFreq: 'weekly', ...over })

  it('lands on every chosen weekday within each week block', () => {
    expect(occurrenceDates(weekly({ recurWeekdays: [1, 5] }), '2026-07-01', '2026-07-14')).toEqual([
      '2026-07-01',
      '2026-07-03',
      '2026-07-06',
      '2026-07-08',
      '2026-07-10',
      '2026-07-13',
    ])
  })

  it("always includes the anchor's own weekday, listed or not", () => {
    // Mondays only, from a Wednesday anchor. Wednesday is still produced: the Series' first
    // Occurrence is its anchor (planPromoteToSeries keeps that very row), so a Rule that skipped
    // it would leave that Occurrence Date unfilled forever. See effectiveWeekdays.
    expect(occurrenceDates(weekly({ recurWeekdays: [1] }), '2026-07-01', '2026-07-14')).toEqual([
      '2026-07-01',
      '2026-07-06',
      '2026-07-08',
      '2026-07-13',
    ])
  })

  it('counts the interval in week blocks measured from the anchor', () => {
    // Every other week on Fri, anchored Wed 07-01. Block 0 is 07-01..07-07 and block 1 is
    // 07-15..07-21, so the whole of 07-08..07-14 is off — including its Wednesday and Friday.
    expect(
      occurrenceDates(weekly({ recurInterval: 2, recurWeekdays: [5] }), '2026-07-01', '2026-07-21'),
    ).toEqual(['2026-07-01', '2026-07-03', '2026-07-15', '2026-07-17'])
  })

  it('reads the weekday list as a set, so duplicates and order change nothing', () => {
    expect(
      occurrenceDates(weekly({ recurWeekdays: [5, 1, 5, 1] }), '2026-07-01', '2026-07-14'),
    ).toEqual(occurrenceDates(weekly({ recurWeekdays: [1, 5] }), '2026-07-01', '2026-07-14'))
  })

  it('filters by the window without re-phasing the blocks', () => {
    // Same Rule as the first case; only the window moves. A window that re-anchored the blocks
    // would start counting weeks at 07-07 and answer 07-07/07-09/07-12 instead.
    expect(occurrenceDates(weekly({ recurWeekdays: [1, 5] }), '2026-07-07', '2026-07-14')).toEqual([
      '2026-07-08',
      '2026-07-10',
      '2026-07-13',
    ])
  })

  it('drops Excluded Dates and stops at recurUntil like any other Rule', () => {
    expect(
      occurrenceDates(
        weekly({ recurWeekdays: [1, 5], recurUntil: '2026-07-10', excludedDates: ['2026-07-03'] }),
        '2026-07-01',
        '2026-07-31',
      ),
    ).toEqual(['2026-07-01', '2026-07-06', '2026-07-08', '2026-07-10'])
  })

  it('is ignored on a daily Rule, which has no week block', () => {
    // The database refuses this combination outright; the walk answers coherently rather than
    // depending on it to.
    expect(
      occurrenceDates(
        rule({ recurFreq: 'daily', recurWeekdays: [1, 5] }),
        '2026-07-01',
        '2026-07-04',
      ),
    ).toEqual(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04'])
  })
})

describe('occurrenceDates with a count', () => {
  const daily = (over: Partial<RecurRule> = {}) => rule({ recurFreq: 'daily', ...over })

  it('stops after the given number of Occurrence Dates', () => {
    expect(occurrenceDates(daily({ recurCount: 3 }), '2026-07-01', '2026-12-31')).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
    ])
  })

  it("counts from the Series' first Occurrence, not from the start of the window", () => {
    // The count and the materialization window are anchored differently on purpose — #210 moved
    // the window's lower bound to today. Counting from `from` would answer three dates here, and
    // would silently lengthen every Rule whose Series began before the window.
    expect(occurrenceDates(daily({ recurCount: 3 }), '2026-07-03', '2026-12-31')).toEqual([
      '2026-07-03',
    ])
  })

  it('is spent by Excluded Dates rather than extended past them', () => {
    // The count bounds what the Rule generates; exclusions then remove from that set. Deleting one
    // Occurrence of a five-Occurrence Series leaves four, not five.
    expect(
      occurrenceDates(
        daily({ recurCount: 5, excludedDates: ['2026-07-02'] }),
        '2026-07-01',
        '2026-12-31',
      ),
    ).toEqual(['2026-07-01', '2026-07-03', '2026-07-04', '2026-07-05'])
  })

  it('yields to recurUntil when the date comes first', () => {
    expect(
      occurrenceDates(
        daily({ recurCount: 10, recurUntil: '2026-07-03' }),
        '2026-07-01',
        '2026-12-31',
      ),
    ).toEqual(['2026-07-01', '2026-07-02', '2026-07-03'])
  })

  it('wins over recurUntil when the count comes first', () => {
    expect(
      occurrenceDates(
        daily({ recurCount: 2, recurUntil: '2026-07-31' }),
        '2026-07-01',
        '2026-12-31',
      ),
    ).toEqual(['2026-07-01', '2026-07-02'])
  })

  it('counts each chosen weekday, not each week', () => {
    // Two weekdays a week, so a count of 5 spans two blocks and stops part-way through the second.
    expect(
      occurrenceDates(
        rule({ recurFreq: 'weekly', recurWeekdays: [1, 5], recurCount: 5 }),
        '2026-07-01',
        '2026-12-31',
      ),
    ).toEqual(['2026-07-01', '2026-07-03', '2026-07-06', '2026-07-08', '2026-07-10'])
  })

  it('counts weekday Occurrences from the anchor even when the window starts later', () => {
    // The blocked walk has its own tally, and this is the case that separates it from a tally
    // kept over the window: counting in-window would reach 07-17 instead of stopping at 07-10.
    expect(
      occurrenceDates(
        rule({ recurFreq: 'weekly', recurWeekdays: [1, 5], recurCount: 5 }),
        '2026-07-07',
        '2026-12-31',
      ),
    ).toEqual(['2026-07-08', '2026-07-10'])
  })

  it('yields nothing for an unscheduled anchor rather than NaN dates', () => {
    // A behavioural assertion, not a test of the guard inside the walk: two accidents of string
    // comparison against the 'inbox' sentinel produce this same answer, so removing that guard
    // leaves this green. Pinned anyway because the answer itself matters — an unscheduled Series
    // has been unsavable since #209, and a Rule that yielded dates for one would materialize them.
    expect(
      occurrenceDates(rule({ day: 'inbox', recurCount: 3 }), '2026-07-01', '2026-12-31'),
    ).toEqual([])
  })
  it('still honours the horizon, which truncates the answer without spending the Rule', () => {
    expect(occurrenceDates(daily({ recurCount: 100 }), '2026-07-01', '2026-07-03')).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
    ])
  })
})

describe('allOccurrenceDates', () => {
  it('is every date a date-bounded Rule will ever yield', () => {
    const r = rule({ recurUntil: '2026-07-22' })
    expect(isBoundedRule(r)).toBe(true)
    expect(isBoundedRule(r) && allOccurrenceDates(r)).toEqual([
      '2026-07-01',
      '2026-07-08',
      '2026-07-15',
      '2026-07-22',
    ])
  })

  it('is every date a count-bounded Rule will ever yield, with no end date at all', () => {
    // The case a recurUntil-shaped horizon cannot express, and the reason this exists beside
    // occurrenceDates rather than being folded into it.
    const r = rule({ recurCount: 3, recurUntil: null })
    expect(isBoundedRule(r) && allOccurrenceDates(r)).toEqual([
      '2026-07-01',
      '2026-07-08',
      '2026-07-15',
    ])
  })

  it('is empty when every date the Rule yields is excluded', () => {
    // What ruleIsSpent reads: a Rule that can produce nothing more.
    const r = rule({ recurCount: 2, excludedDates: ['2026-07-01', '2026-07-08'] })
    expect(isBoundedRule(r) && allOccurrenceDates(r)).toEqual([])
  })

  it('is empty for an unscheduled anchor, which yields no Occurrence Dates at all', () => {
    const r = rule({ day: 'inbox', recurCount: 5 })
    expect(isBoundedRule(r) && allOccurrenceDates(r)).toEqual([])
  })

  it('reports an unbounded Rule as unbounded', () => {
    expect(isBoundedRule(rule())).toBe(false)
    expect(isBoundedRule(rule({ recurUntil: null, recurCount: null }))).toBe(false)
  })
})

function rule(over: Partial<RecurRule> = {}): RecurRule {
  return {
    day: '2026-07-01',
    recurFreq: 'weekly',
    recurInterval: 1,
    recurUntil: null,
    recurCount: null,
    recurWeekdays: [],
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

  it('counts a bounded Rule from its anchor, not from the start of the horizon', () => {
    // Daily from 06-28 ending after 10 Occurrences: 06-28 through 07-07. Today is 07-01, so the
    // window opens at 06-30 (one grace day). Counting from the window instead would reach 07-09
    // and hand the user two Occurrences the Rule never had -- the trap the issue names, because
    // #210 anchored the window at today while the count stayed anchored at the Series.
    expect(
      missingInstanceDates(
        rule({ day: '2026-06-28', recurFreq: 'daily', recurCount: 10 }),
        [],
        '2026-07-01',
        14,
      ),
    ).toEqual([
      '2026-06-30',
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-05',
      '2026-07-06',
      '2026-07-07',
    ])
  })

  it('materializes only the chosen weekdays', () => {
    // today 07-01 (Wed), horizon 14 -> window 06-30..07-15. Anchor 07-01 with Mon and Fri added.
    expect(missingInstanceDates(rule({ recurWeekdays: [1, 5] }), [], '2026-07-01', 14)).toEqual([
      '2026-07-01',
      '2026-07-03',
      '2026-07-06',
      '2026-07-08',
      '2026-07-10',
      '2026-07-13',
      '2026-07-15',
    ])
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
