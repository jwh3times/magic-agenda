import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
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
  const auth = {
    user: { id: 'user-1' } as { id: string } | null,
    session: {} as unknown,
    loading: false,
    signOut: vi.fn(),
  }
  return { upsert, maybeSingle, channel, auth }
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

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => h.auth }))

import { SettingsProvider } from '../data/SettingsProvider'
import { SettingsPage } from './SettingsPage'

beforeEach(() => {
  h.upsert.mockClear()
  h.auth.user = { id: 'user-1' }
})

// Settings live in a provider above <Routes> (see SettingsProvider), so the page needs it in scope.
function renderPage() {
  return render(
    <SettingsProvider>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </SettingsProvider>,
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
    {
      user_id: 'user-1',
      theme: 'cork',
      default_view: 'kanban',
      week_start: 0,
      timezone: null,
    },
    { onConflict: 'user_id' },
  )
})

test('links to the legal pages from the footer', async () => {
  renderPage()
  expect(await screen.findByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy')
  expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms')
})

// Same defect class as BoardPage: ProtectedRoute now admits an offline sessionless visitor with
// a remembered id (no session, so `user` is null), and this page must not re-derive a stricter
// gate from `user` that spins forever instead of rendering.
test('a sessionless offline visitor with a remembered id still sees the page, not a spinner', async () => {
  localStorage.setItem('ma-last-user', 'user-1')
  h.auth.user = null
  renderPage()
  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
})
