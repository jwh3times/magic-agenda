import { render, screen, fireEvent } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  saveWeekStart: vi.fn(),
  saveTimezone: vi.fn(),
}))

vi.mock('../data/SettingsProvider', () => ({
  useSettingsContext: () => ({
    settings: { theme: 'cork', defaultView: 'calendar', weekStart: 1, timezone: 'Europe/London' },
    loading: false,
    saveTheme: vi.fn(),
    saveView: vi.fn(),
    saveWeekStart: h.saveWeekStart,
    saveTimezone: h.saveTimezone,
  }),
}))

import { DatesSection } from './DatesSection'

test('shows the current week start and timezone', () => {
  render(<DatesSection />)
  expect(screen.getByLabelText('Week starts on')).toHaveValue('1')
  expect(screen.getByLabelText('Timezone')).toHaveValue('Europe/London')
})

test('saves a new week start', () => {
  render(<DatesSection />)
  fireEvent.change(screen.getByLabelText('Week starts on'), { target: { value: '6' } })
  expect(h.saveWeekStart).toHaveBeenCalledWith(6)
})

test('saves a new timezone, and "Automatic" stores null', () => {
  render(<DatesSection />)
  const tz = screen.getByLabelText('Timezone')
  fireEvent.change(tz, { target: { value: 'Asia/Tokyo' } })
  expect(h.saveTimezone).toHaveBeenCalledWith('Asia/Tokyo')

  // The empty option means "follow the browser" — it must persist as NULL, not as ''.
  fireEvent.change(tz, { target: { value: '' } })
  expect(h.saveTimezone).toHaveBeenLastCalledWith(null)
})
