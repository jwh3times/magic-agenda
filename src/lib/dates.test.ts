import { expect, test } from 'vitest'
import { formatTime } from './dates'

test('formatTime renders compact 12-hour labels', () => {
  expect(formatTime('09:00')).toBe('9am')
  expect(formatTime('14:30')).toBe('2:30pm')
  expect(formatTime('12:00')).toBe('12pm')
  expect(formatTime('00:15')).toBe('12:15am')
  expect(formatTime('23:59')).toBe('11:59pm')
})
