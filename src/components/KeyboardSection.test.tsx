import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  keyboardShortcuts: true,
  saveKeyboardShortcuts: vi.fn(),
}))

vi.mock('../data/SettingsProvider', () => ({
  useSettingsContext: () => ({
    settings: {
      theme: 'cork',
      weekStart: 0,
      timezone: null,
      keyboardShortcuts: h.keyboardShortcuts,
    },
    saveKeyboardShortcuts: h.saveKeyboardShortcuts,
  }),
}))

import { KeyboardSection } from './KeyboardSection'

beforeEach(() => {
  h.keyboardShortcuts = true
  h.saveKeyboardShortcuts.mockClear()
})

test('the checkbox reflects the account preference', () => {
  render(<KeyboardSection />)
  expect(
    screen.getByRole('checkbox', { name: 'Single-letter shortcuts on the board' }),
  ).toBeChecked()
})

test('an account with shortcuts off sees the box unticked', () => {
  h.keyboardShortcuts = false
  render(<KeyboardSection />)
  expect(
    screen.getByRole('checkbox', { name: 'Single-letter shortcuts on the board' }),
  ).not.toBeChecked()
})

test('unticking it saves the preference as off', async () => {
  const user = userEvent.setup()
  render(<KeyboardSection />)
  await user.click(screen.getByRole('checkbox', { name: 'Single-letter shortcuts on the board' }))
  expect(h.saveKeyboardShortcuts).toHaveBeenCalledWith(false)
})

test('explains that Ctrl+K is unaffected', () => {
  render(<KeyboardSection />)
  expect(screen.getByText(/Ctrl\+K .* always opens the command palette/)).toBeInTheDocument()
})
