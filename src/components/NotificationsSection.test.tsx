import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  state: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  devices: vi.fn(),
  removeDevice: vi.fn(),
  saveLead: vi.fn(),
  timezone: 'America/New_York' as string | null,
  lead: null as number | null,
}))

vi.mock('../notifications/pushGateway', () => ({
  browserPushGateway: {
    state: h.state,
    subscribe: h.subscribe,
    unsubscribe: h.unsubscribe,
    devices: h.devices,
    removeDevice: h.removeDevice,
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
  h.devices.mockReset().mockResolvedValue([])
  h.removeDevice.mockReset().mockResolvedValue(undefined)
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

// ——— the device list ———

const laptop = {
  id: 'laptop',
  label: 'Chrome on Linux',
  createdAt: '2026-09-01T10:00:00Z',
  current: false,
}
const phone = {
  id: 'phone',
  label: 'Safari on iPhone',
  createdAt: '2026-10-01T10:00:00Z',
  current: true,
}

test('lists every device with Reminders, and offers Remove for the others', async () => {
  h.devices.mockResolvedValue([phone, laptop])
  render(<NotificationsSection />)

  const list = await screen.findByRole('list', { name: 'Devices with reminders' })
  const items = within(list).getAllByRole('listitem')
  expect(items).toHaveLength(2)
  expect(items[0]).toHaveTextContent('Safari on iPhone')
  expect(items[0]).toHaveTextContent('This device')
  // This device is changed by the button above, which also retires the browser's subscription.
  expect(within(items[0]).queryByRole('button')).not.toBeInTheDocument()
  expect(items[1]).toHaveTextContent('Chrome on Linux')
  expect(within(items[1]).getByRole('button', { name: 'Remove Chrome on Linux' })).toBeEnabled()
  expect(h.devices).toHaveBeenCalledWith('account-1')
})

test('removing another device deletes it and rereads the list', async () => {
  h.devices.mockResolvedValueOnce([phone, laptop]).mockResolvedValue([phone])
  render(<NotificationsSection />)

  await userEvent.click(await screen.findByRole('button', { name: 'Remove Chrome on Linux' }))

  expect(h.removeDevice).toHaveBeenCalledWith('account-1', 'laptop')
  await waitFor(() => expect(screen.queryByText('Chrome on Linux')).not.toBeInTheDocument())
  expect(screen.getByText('Safari on iPhone')).toBeInTheDocument()
})

test('a removal that fails is reported and the device stays listed', async () => {
  h.devices.mockResolvedValue([laptop])
  h.removeDevice.mockRejectedValue(new Error('offline'))
  render(<NotificationsSection />)

  await userEvent.click(await screen.findByRole('button', { name: 'Remove Chrome on Linux' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove Chrome on Linux.')
  expect(screen.getByText('Chrome on Linux')).toBeInTheDocument()
})

test('a list that cannot be read says so instead of showing no devices', async () => {
  h.devices.mockRejectedValue(new Error('offline'))
  render(<NotificationsSection />)

  expect(await screen.findByText('Could not load your devices.')).toBeInTheDocument()
  expect(screen.queryByText('No devices receive reminders.')).not.toBeInTheDocument()
})

test('an Account with no devices is told so', async () => {
  render(<NotificationsSection />)
  expect(await screen.findByText('No devices receive reminders.')).toBeInTheDocument()
})

test('a device that cannot subscribe itself can still remove the others', async () => {
  h.state.mockResolvedValue({
    availability: 'ios-install-required',
    permission: 'default',
    subscribed: false,
  })
  h.devices.mockResolvedValue([laptop])
  render(<NotificationsSection />)

  expect(await screen.findByRole('button', { name: 'Remove Chrome on Linux' })).toBeEnabled()
})

test('enabling this device rereads the list', async () => {
  h.devices.mockResolvedValueOnce([]).mockResolvedValue([phone])
  render(<NotificationsSection />)
  await userEvent.click(await screen.findByRole('button', { name: 'Enable on this device' }))

  expect(await screen.findByText('Safari on iPhone')).toBeInTheDocument()
})
