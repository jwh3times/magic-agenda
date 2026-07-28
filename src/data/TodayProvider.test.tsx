import { render, screen, act } from '@testing-library/react'
import { useState } from 'react'
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

// FINDING 1: a child that mounts for the first time in the same commit where settings finish
// loading (and the timezone resolves) must not capture whatever `today` state TodayProvider's
// own `useState` initializer produced back when `tz` was still null — that initializer only ever
// runs once, on TodayProvider's own first mount, which can predate the tz becoming known. This
// mirrors Board's `useState(() => parseDay(today))` anchor initializer: it runs once, on the
// render where Board itself first mounts, and takes whatever `useToday()` returns at that instant.
test('a child mounting the instant the timezone resolves does not capture a stale today', () => {
  function CaptureOnMount() {
    const today = useToday()
    // Same shape as Board's real anchor bug: `useState(() => parseDay(today))` — an initializer
    // that runs exactly once, on this component's own first render, and freezes whatever
    // `useToday()` returned at that instant.
    const [captured] = useState(() => today)
    return <span data-testid="captured">{captured}</span>
  }

  h.timezone = null
  const { rerender } = render(
    <TodayProvider>
      <span>settings still loading</span>
    </TodayProvider>,
  )

  // Settings finish loading and the resolved timezone arrives in the very same render pass that
  // mounts the gated child for the first time.
  h.timezone = 'Pacific/Kiritimati' // UTC+14 — already the 29th at this instant
  rerender(
    <TodayProvider>
      <CaptureOnMount />
    </TodayProvider>,
  )

  expect(screen.getByTestId('captured')).toHaveTextContent('2026-07-29')
})

// FINDING 5: an already-mounted consumer must also follow the timezone when it changes later,
// not only capture it correctly at mount (the case above). This exercises the ordinary `[tz]`
// re-sync path.
test('an already-mounted consumer follows the timezone when it changes post-mount', () => {
  h.timezone = 'UTC'
  const { rerender } = render(
    <TodayProvider>
      <Show />
    </TodayProvider>,
  )
  expect(screen.getByTestId('today')).toHaveTextContent('2026-07-28')

  h.timezone = 'Pacific/Kiritimati' // UTC+14 — already the 29th
  rerender(
    <TodayProvider>
      <Show />
    </TodayProvider>,
  )
  expect(screen.getByTestId('today')).toHaveTextContent('2026-07-29')
})
