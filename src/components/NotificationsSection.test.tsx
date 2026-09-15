import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  state: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  saveLead: vi.fn(),
  timezone: 'America/New_York' as string | null,
  lead: null as number | null,
}))

vi.mock('../notifications/pushGateway', () => ({
  browserPushGateway: {
    state: h.state,
    subscribe: h.subscribe,
    unsubscribe: h.unsubscribe,
  },
}))

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'account-1' } }) }))
vi.mock('../data/SettingsProvider', () => ({
  useSettingsContext: () => ({
    settings: {
      theme: 'cork',
      weekStart: 0,
      timezone: h.timezone,
      keyboardShortcuts: true,
      reminderLeadMinutes: h.lead,
    },
    saveReminderLeadMinutes: h.saveLead,
  }),
}))

import { NotificationsSection } from './NotificationsSection'

beforeEach(() => {
  h.timezone = 'America/New_York'
  h.lead = null
  h.state.mockReset().mockResolvedValue({
    availability: 'supported',
    permission: 'default',
    subscribed: false,
  })
  h.subscribe.mockReset().mockResolvedValue(undefined)
  h.unsubscribe.mockReset().mockResolvedValue(undefined)
  h.saveLead.mockReset()
})

test('Automatic timezone keeps reminders off and explains the requirement', async () => {
  h.timezone = null
  render(<NotificationsSection />)

  expect(await screen.findByText(/choose a specific timezone/i)).toBeInTheDocument()
  expect(screen.getByLabelText('Reminder timing')).toBeDisabled()
})

test('the Account lead can be enabled and disabled', async () => {
  render(<NotificationsSection />)
  const select = await screen.findByLabelText('Reminder timing')

  await userEvent.selectOptions(select, '15')
  expect(h.saveLead).toHaveBeenCalledWith(15)
  await userEvent.selectOptions(select, '')
  expect(h.saveLead).toHaveBeenCalledWith(null)
})

test('permission is requested only from the explicit device button', async () => {
  render(<NotificationsSection />)
  await screen.findByRole('button', { name: 'Enable on this device' })
  expect(h.subscribe).not.toHaveBeenCalled()

  await userEvent.click(screen.getByRole('button', { name: 'Enable on this device' }))
  expect(h.subscribe).toHaveBeenCalledWith('account-1')
})

test('a denied permission gets actionable browser-settings guidance', async () => {
  h.subscribe.mockRejectedValue(new Error('Notification permission was denied.'))
  render(<NotificationsSection />)
  await userEvent.click(await screen.findByRole('button', { name: 'Enable on this device' }))

  expect(await screen.findByText(/browser or system settings/i)).toBeInTheDocument()
})

test('iOS outside the installed app gets Home Screen guidance', async () => {
  h.state.mockResolvedValue({
    availability: 'ios-install-required',
    permission: 'default',
    subscribed: false,
  })
  render(<NotificationsSection />)

  expect(await screen.findByText(/add magic agenda to your home screen/i)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Enable on this device' })).not.toBeInTheDocument()
})

test('an existing subscription can be removed from this device', async () => {
  h.state.mockResolvedValue({
    availability: 'supported',
    permission: 'granted',
    subscribed: true,
  })
  render(<NotificationsSection />)
  await userEvent.click(await screen.findByRole('button', { name: 'Remove this device' }))

  await waitFor(() => expect(h.unsubscribe).toHaveBeenCalledWith('account-1'))
})
