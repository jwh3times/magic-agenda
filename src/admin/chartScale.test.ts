import { expect, test } from 'vitest'
import { barPercent, niceCeiling, shortUtcDay } from './chartScale'

test('the axis maximum rounds up to 1, 2, or 5 times a power of ten', () => {
  expect(niceCeiling(1)).toBe(1)
  expect(niceCeiling(3)).toBe(5)
  expect(niceCeiling(7)).toBe(10)
  expect(niceCeiling(11)).toBe(20)
  expect(niceCeiling(30)).toBe(50)
  expect(niceCeiling(200)).toBe(200)
  expect(niceCeiling(201)).toBe(500)
  expect(niceCeiling(0.4)).toBe(0.5)
})

test('an all-zero or empty series still has a usable axis', () => {
  expect(niceCeiling(0)).toBe(1)
  expect(niceCeiling(Number.NaN)).toBe(1)
  expect(niceCeiling(Math.max(...[0, 0, 0]))).toBe(1)
})

test('a bar is a share of the axis, and a small non-zero count stays visible', () => {
  expect(barPercent(0, 50)).toBe(0)
  expect(barPercent(25, 50)).toBe(50)
  expect(barPercent(50, 50)).toBe(100)
  expect(barPercent(1, 1000)).toBe(2)
  expect(barPercent(5, 0)).toBe(0)
})

test('a UTC day bucket is labelled as that same day, whatever the local zone', () => {
  expect(shortUtcDay('2026-09-16')).toBe('Sep 16')
  expect(shortUtcDay('2026-10-01')).toBe('Oct 1')
  expect(shortUtcDay('not-a-day')).toBe('not-a-day')
})
