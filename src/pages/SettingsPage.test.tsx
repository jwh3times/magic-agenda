import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => {
  const upsert = vi.fn(() => ({
    then: (onFulfilled: (r: { data: null; error: null }) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(onFulfilled),
  }))
  const maybeSingle = vi.fn(() =>
    Promise.resolve({ data: { theme: 'cork', default_view: 'calendar' }, error: null }),
  )
  const channel: Record<string, unknown> = {}
  channel.on = vi.fn(() => channel)
  channel.subscribe = vi.fn(() => channel)
  return { upsert, maybeSingle, channel }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: h.maybeSingle })) })),
      upsert: h.upsert,
    })),
    channel: vi.fn(() => h.channel),
    removeChannel: vi.fn(),
  },
}))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    session: {},
    loading: false,
    signOut: vi.fn(),
  }),
}))

import { SettingsPage } from './SettingsPage'

beforeEach(() => h.upsert.mockClear())

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  )
}

test('renders the Appearance section with theme and default-view controls', async () => {
  renderPage()
  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument()
  expect(screen.getByLabelText('Default view')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '← Board' })).toHaveAttribute('href', '/')
})

test('changing the default view persists it', async () => {
  renderPage()
  const select = await screen.findByLabelText('Default view')
  await userEvent.selectOptions(select, 'kanban')
  expect(h.upsert).toHaveBeenCalledWith(
    { user_id: 'user-1', theme: 'cork', default_view: 'kanban' },
    { onConflict: 'user_id' },
  )
})

test('links to the legal pages from the footer', async () => {
  renderPage()
  expect(await screen.findByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy')
  expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms')
})
