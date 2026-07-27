import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => {
  const maybeSingle = vi.fn(() =>
    Promise.resolve({ data: { theme: 'glass', default_view: 'kanban' }, error: null }),
  )
  const channel: Record<string, unknown> = {}
  channel.on = vi.fn(() => channel)
  channel.subscribe = vi.fn(() => channel)
  const from = vi.fn(() => ({
    select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })),
    upsert: vi.fn(() => ({
      then: (f: (r: { error: null }) => unknown) => Promise.resolve({ error: null }).then(f),
    })),
  }))
  const channelFn = vi.fn(() => channel)
  return { maybeSingle, from, channelFn, user: { current: null as { id: string } | null } }
})

vi.mock('../lib/supabase', () => ({
  supabase: { from: h.from, channel: h.channelFn, removeChannel: vi.fn() },
}))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: h.user.current,
    session: h.user.current ? {} : null,
    loading: false,
    signOut: vi.fn(),
  }),
}))

import { SettingsProvider, useSettingsContext } from './SettingsProvider'

function Consumer({ label }: { label: string }) {
  const { settings, loading } = useSettingsContext()
  return <div data-testid={label}>{loading ? 'loading' : (settings?.theme ?? 'none')}</div>
}

beforeEach(() => {
  h.maybeSingle.mockClear()
  h.from.mockClear()
  h.channelFn.mockClear()
  h.user.current = { id: 'user-1' }
})

// The provider sits above <Routes>, so it also mounts for the public landing page. Without an
// empty-userId guard it would fire a user_settings query for every signed-out visitor.
test('a signed-out visitor triggers no settings query and no realtime channel', async () => {
  h.user.current = null
  render(
    <SettingsProvider>
      <Consumer label="a" />
    </SettingsProvider>,
  )
  await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('none'))
  expect(h.from).not.toHaveBeenCalled()
  expect(h.channelFn).not.toHaveBeenCalled()
})

// The point of hoisting: `/` and `/settings` share one fetch and one channel instead of tearing
// them down and recreating them on every navigation between the board and settings.
test('multiple consumers share a single fetch and a single channel', async () => {
  render(
    <SettingsProvider>
      <Consumer label="a" />
      <Consumer label="b" />
    </SettingsProvider>,
  )
  await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('glass'))
  expect(screen.getByTestId('b')).toHaveTextContent('glass')
  expect(h.maybeSingle).toHaveBeenCalledTimes(1)
  expect(h.channelFn).toHaveBeenCalledTimes(1)
})

test('consuming the context outside the provider is a clear error, not a silent null', () => {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(() => render(<Consumer label="a" />)).toThrow(/SettingsProvider/)
  quiet.mockRestore()
})
