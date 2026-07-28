import { render, screen, act } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ timezone: null as string | null }))

// Mocked so this tests the provider, not the whole auth + supabase settings stack.
vi.mock('./SettingsProvider', () => ({
  useSettingsContext: () => ({
    settings: {
      theme: 'cork',
      defaultView: 'calendar',
      weekStart: 0,
      timezone: h.timezone,
    },
    loading: false,
    saveTheme: vi.fn(),
    saveView: vi.fn(),
    saveWeekStart: vi.fn(),
    saveTimezone: vi.fn(),
  }),
}))

import { TodayProvider } from './TodayProvider'
import { useToday } from './todayContext'

function Show() {
  return <span data-testid="today">{useToday()}</span>
}

beforeEach(() => {
  h.timezone = null
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-28T11:30:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

test('publishes today in the configured zone', () => {
  h.timezone = 'Pacific/Kiritimati' // UTC+14 — already the 29th at this instant
  render(
    <TodayProvider>
      <Show />
    </TodayProvider>,
  )
  expect(screen.getByTestId('today')).toHaveTextContent('2026-07-29')
})

test('rolls over without a reload when the day changes', () => {
  h.timezone = 'UTC'
  render(
    <TodayProvider>
      <Show />
    </TodayProvider>,
  )
  expect(screen.getByTestId('today')).toHaveTextContent('2026-07-28')

  // A board left open overnight used to keep highlighting yesterday.
  act(() => {
    vi.setSystemTime(new Date('2026-07-29T11:30:00Z'))
    vi.advanceTimersByTime(60_000)
  })
  expect(screen.getByTestId('today')).toHaveTextContent('2026-07-29')
})

test('useToday works with no provider, so components render unwrapped', () => {
  render(<Show />)
  expect(screen.getByTestId('today')).toHaveTextContent(/^\d{4}-\d{2}-\d{2}$/)
})
