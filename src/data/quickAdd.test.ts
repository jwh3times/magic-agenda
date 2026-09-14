import { describe, expect, it } from 'vitest'
import { dateOrderForLocale, parseQuickAdd } from './quickAdd'

// 2026-09-10 is a Thursday.
const TODAY = '2026-09-10'
const md = (input: string) => parseQuickAdd(input, TODAY, 'md')
const dm = (input: string) => parseQuickAdd(input, TODAY, 'dm')

describe('parseQuickAdd: relative days', () => {
  it('schedules today and tomorrow', () => {
    expect(md('groceries today')).toEqual({ title: 'groceries', day: '2026-09-10' })
    expect(md('groceries tomorrow')).toEqual({ title: 'groceries', day: '2026-09-11' })
  })

  it('is case-insensitive about the date but keeps the title as typed', () => {
    expect(md('Call Mom TOMORROW')).toEqual({ title: 'Call Mom', day: '2026-09-11' })
  })

  it('crosses a month boundary', () => {
    expect(parseQuickAdd('pay rent tomorrow', '2026-09-30', 'md')).toEqual({
      title: 'pay rent',
      day: '2026-10-01',
    })
  })
})

describe('parseQuickAdd: weekdays', () => {
  it('reads a weekday as the next one after today, by full or short name', () => {
    expect(md('standup friday')).toEqual({ title: 'standup', day: '2026-09-11' })
    expect(md('standup fri')).toEqual({ title: 'standup', day: '2026-09-11' })
    expect(md('review monday')).toEqual({ title: 'review', day: '2026-09-14' })
  })

  it('never reads today\'s own weekday as today: that is what "today" is for', () => {
    expect(md('gym thursday')).toEqual({ title: 'gym', day: '2026-09-17' })
  })

  it('drops a connective "on" before the date', () => {
    expect(md('dentist on friday')).toEqual({ title: 'dentist', day: '2026-09-11' })
  })

  it('does not treat a two-letter word as a weekday', () => {
    expect(md('meet mo')).toEqual({ title: 'meet mo', day: 'inbox' })
  })
})

describe('parseQuickAdd: month names', () => {
  it('reads "mar 4", "march 4", and "4 march"', () => {
    expect(md('taxes mar 4')).toEqual({ title: 'taxes', day: '2027-03-04' })
    expect(md('taxes march 4')).toEqual({ title: 'taxes', day: '2027-03-04' })
    expect(md('taxes 4 march')).toEqual({ title: 'taxes', day: '2027-03-04' })
  })

  it('uses this year when the date is still ahead, next year when it has passed', () => {
    expect(md('party oct 2')).toEqual({ title: 'party', day: '2026-10-02' })
    expect(md('party sep 10')).toEqual({ title: 'party', day: '2026-09-10' })
    expect(md('party sep 9')).toEqual({ title: 'party', day: '2027-09-09' })
  })

  it('reads the same regardless of numeric date order', () => {
    expect(dm('taxes mar 4')).toEqual(md('taxes mar 4'))
  })
})

describe('parseQuickAdd: numeric dates follow the date order', () => {
  it('reads 3/4 as March 4 month-first and April 3 day-first', () => {
    expect(md('taxes 3/4')).toEqual({ title: 'taxes', day: '2027-03-04' })
    expect(dm('taxes 3/4')).toEqual({ title: 'taxes', day: '2027-04-03' })
  })

  it('accepts an explicit two- or four-digit year', () => {
    expect(md('renew 3/4/2028')).toEqual({ title: 'renew', day: '2028-03-04' })
    expect(md('renew 3/4/28')).toEqual({ title: 'renew', day: '2028-03-04' })
  })

  it('accepts dashes and dots as separators', () => {
    expect(dm('renew 4.3')).toEqual({ title: 'renew', day: '2027-03-04' })
    expect(md('renew 3-4')).toEqual({ title: 'renew', day: '2027-03-04' })
  })
})

describe('parseQuickAdd: unrecognized dates go to the Inbox instead of being guessed', () => {
  it('leaves a line with no date phrase in the Inbox', () => {
    expect(md('buy milk')).toEqual({ title: 'buy milk', day: 'inbox' })
  })

  it('keeps an impossible date in the title', () => {
    expect(md('fix 2/30')).toEqual({ title: 'fix 2/30', day: 'inbox' })
    expect(md('fix 13/4')).toEqual({ title: 'fix 13/4', day: 'inbox' })
    expect(dm('fix 4/13')).toEqual({ title: 'fix 4/13', day: 'inbox' })
  })

  it('only reads a date at the end of the line', () => {
    expect(md('friday standup notes')).toEqual({ title: 'friday standup notes', day: 'inbox' })
  })

  it('keeps a line that is only a date as the title rather than making an untitled task', () => {
    expect(md('tomorrow')).toEqual({ title: 'tomorrow', day: 'inbox' })
    expect(md('on friday')).toEqual({ title: 'on friday', day: 'inbox' })
  })

  it('normalizes whitespace and handles empty input', () => {
    expect(md('  call   mom   tomorrow  ')).toEqual({ title: 'call mom', day: '2026-09-11' })
    expect(md('   ')).toEqual({ title: '', day: 'inbox' })
  })

  it('schedules the next Feb 29 when the current year has none', () => {
    expect(parseQuickAdd('leap 2/29', '2026-09-10', 'md')).toEqual({
      title: 'leap',
      day: '2028-02-29',
    })
  })
})

describe('dateOrderForLocale', () => {
  it('reads month-first and day-first locales from Intl', () => {
    expect(dateOrderForLocale('en-US')).toBe('md')
    expect(dateOrderForLocale('en-GB')).toBe('dm')
    expect(dateOrderForLocale('de-DE')).toBe('dm')
  })

  it('treats year-first locales as month-before-day', () => {
    expect(dateOrderForLocale('ja-JP')).toBe('md')
  })

  it('falls back to month-first for a locale Intl rejects', () => {
    expect(dateOrderForLocale('not a locale!!')).toBe('md')
  })
})
