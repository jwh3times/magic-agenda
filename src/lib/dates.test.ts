import { expect, test, vi } from 'vitest'
import {
  formatTime,
  dateYmd,
  todayYmd,
  ymd,
  startOfWeek,
  weekdayLabels,
  browserTimezone,
  supportedTimezones,
} from './dates'

test('formatTime renders compact 12-hour labels', () => {
  expect(formatTime('09:00')).toBe('9am')
  expect(formatTime('14:30')).toBe('2:30pm')
  expect(formatTime('12:00')).toBe('12pm')
  expect(formatTime('00:15')).toBe('12:15am')
  expect(formatTime('23:59')).toBe('11:59pm')
})

test('todayYmd resolves the calendar date in the given zone', () => {
  vi.useFakeTimers()
  // One instant that is two different calendar dates: UTC+14 has already rolled over, UTC-11
  // has not. This is the whole point of storing a zone, so it is the case worth pinning.
  vi.setSystemTime(new Date('2026-07-28T11:30:00Z'))
  expect(todayYmd('Pacific/Kiritimati')).toBe('2026-07-29')
  expect(todayYmd('Pacific/Niue')).toBe('2026-07-28')
  vi.useRealTimers()
})

test('dateYmd resolves an arbitrary instant in the given zone', () => {
  const instant = new Date('2026-07-28T11:30:00Z')
  expect(dateYmd(instant, 'Pacific/Kiritimati')).toBe('2026-07-29')
  expect(dateYmd(instant, 'Pacific/Niue')).toBe('2026-07-28')
})

test('todayYmd falls back to browser-local for a nullish or unknown zone', () => {
  const local = ymd(new Date())
  expect(todayYmd()).toBe(local)
  expect(todayYmd(null)).toBe(local)
  // A stale zone from another device, or a hand-edited row, must not throw and blank the board.
  expect(todayYmd('Not/AZone')).toBe(local)
})

test('todayYmd is unaffected by a non-Gregorian ambient locale', () => {
  // Guards the explicit 'en-US-u-ca-gregory' locale: under a Thai ambient locale a
  // locale-less formatter would yield a Buddhist-era year (2569), silently breaking
  // every string comparison against a 'YYYY-MM-DD' day.
  const spy = vi.spyOn(Intl, 'DateTimeFormat')
  expect(todayYmd('UTC')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(spy.mock.calls[0][0]).toBe('en-US-u-ca-gregory')
  spy.mockRestore()
})

test('startOfWeek honours the configured first day', () => {
  const tue = new Date(2026, 6, 28) // Tuesday 2026-07-28
  expect(ymd(startOfWeek(tue))).toBe('2026-07-26') // default: Sunday
  expect(ymd(startOfWeek(tue, 0))).toBe('2026-07-26')
  expect(ymd(startOfWeek(tue, 1))).toBe('2026-07-27') // Monday
  expect(ymd(startOfWeek(tue, 6))).toBe('2026-07-25') // Saturday
})

test('startOfWeek crosses a month boundary', () => {
  const sun = new Date(2026, 7, 2) // Sunday 2026-08-02
  expect(ymd(startOfWeek(sun, 1))).toBe('2026-07-27')
})

test('weekdayLabels rotate to the configured first day', () => {
  expect(weekdayLabels()).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
  expect(weekdayLabels(1)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
  expect(weekdayLabels(6)).toEqual(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
})

test('browserTimezone returns a usable IANA id', () => {
  expect(todayYmd(browserTimezone())).toBe(ymd(new Date()))
})

test('supportedTimezones falls back when the engine lacks Intl.supportedValuesOf', () => {
  const full = supportedTimezones()
  expect(full).toContain('UTC')
  expect(full.length).toBeGreaterThan(20)

  const intl = Intl as { supportedValuesOf?: unknown }
  const original = intl.supportedValuesOf
  delete intl.supportedValuesOf
  try {
    const fallback = supportedTimezones()
    expect(fallback).toContain('America/Chicago')
    expect(fallback.length).toBeGreaterThan(20)
  } finally {
    if (original !== undefined) intl.supportedValuesOf = original
  }
})
