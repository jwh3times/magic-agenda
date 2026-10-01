import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { DailyChart, type DailyPoint } from './DailyChart'

/** Thirty consecutive UTC days ending 2026-09-30, with the given counts (missing ones are 0). */
function month(counts: Record<number, number> = {}): DailyPoint[] {
  return Array.from({ length: 30 }, (_, i) => ({
    day: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10),
    count: counts[i] ?? 0,
  }))
}

const bars = () => screen.getAllByTestId('daily-bar')

test('draws one bar per day, scaled against a clean axis maximum', () => {
  render(<DailyChart title="New Tasks" points={month({ 0: 30, 14: 15, 29: 3 })} />)
  expect(bars()).toHaveLength(30)
  // A peak of 30 rounds the axis up to 50.
  expect(screen.getByText('50')).toBeInTheDocument()
  expect(bars()[0].style.height).toBe('60%')
  expect(bars()[14].style.height).toBe('30%')
  expect(bars()[1].style.height).toBe('0%')
  expect(screen.getByText('Sep 1')).toBeInTheDocument()
  expect(screen.getByText('Sep 30')).toBeInTheDocument()
})

test('summarizes the series in one sentence for assistive tech', () => {
  render(<DailyChart title="New Tasks" points={month({ 0: 30, 14: 15, 29: 3 })} />)
  expect(
    screen.getByText('New Tasks: 48 in the last 30 days (UTC), most on Sep 1 (30).'),
  ).toBeInTheDocument()
  // The plot itself is hidden from assistive tech; the summary and Admin's table carry the values.
  expect(screen.getByTestId('daily-plot').closest('[aria-hidden="true"]')).not.toBeNull()
})

test('an all-zero month draws no bars and does not divide by zero', () => {
  render(<DailyChart title="New accounts" points={month()} />)
  expect(bars().every((bar) => bar.style.height === '0%')).toBe(true)
  expect(screen.getByText('1')).toBeInTheDocument()
  expect(screen.getByText('New accounts: none in the last 30 days (UTC).')).toBeInTheDocument()
  expect(screen.getByText('0 in 30 days')).toBeInTheDocument()
})

test('pointing at a day shows its date and count, and leaving restores the total', () => {
  render(<DailyChart title="New Tasks" points={month({ 14: 15 })} />)
  const columns = screen.getAllByTestId('daily-column')
  fireEvent.pointerEnter(columns[14])
  expect(screen.getByText('Sep 15: 15')).toBeInTheDocument()
  expect(bars()[14].style.opacity).toBe('1')
  expect(bars()[0].style.opacity).toBe('0.45')

  fireEvent.pointerLeave(screen.getByTestId('daily-plot'))
  expect(screen.getByText('15 in 30 days')).toBeInTheDocument()
  expect(bars()[0].style.opacity).toBe('1')
})

test('an empty series renders without day labels or a crash', () => {
  render(<DailyChart title="New Tasks" points={[]} />)
  expect(screen.queryAllByTestId('daily-bar')).toHaveLength(0)
  expect(screen.getByText('New Tasks: none in the last 30 days (UTC).')).toBeInTheDocument()
})
