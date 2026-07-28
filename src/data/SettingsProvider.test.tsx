import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => {
  // Typed to allow a `data: null` resolution too (the FIX 1 bite-proof overrides it once with
  // that shape), not just the default authenticated-row response below.
  const maybeSingle = vi.fn(
    (): Promise<{ data: { theme: string; default_view: string } | null; error: null }> =>
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
// empty-userId guard it would fire a user_settings query for every signed-out visitor. This is
// specifically the visitor who never signed in on this device: no session AND no `ma-last-user`,
// so `useSettings('')` takes the no-op branch.
test('a signed-out visitor who never signed in triggers no settings query and no realtime channel', async () => {
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

// The widened case the docstring now calls out: a session that vanished WITHOUT a SIGNED_OUT
// event (the offline-drop this whole feature exists for) leaves `ma-last-user` behind, so a
// signed-out visitor with that stale id DOES fire a query and open a channel here — unlike the
// never-signed-in visitor above. Not a leak (RLS returns nothing to an unauthenticated request),
// but a real, deliberate widening that must not silently regress back to "never queries at all".
test('a signed-out visitor with a stale remembered id still fires a query', async () => {
  h.user.current = null
  localStorage.setItem('ma-last-user', 'user-1')
  render(
    <SettingsProvider>
      <Consumer label="a" />
    </SettingsProvider>,
  )
  await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('glass'))
  expect(h.from).toHaveBeenCalled()
  expect(h.channelFn).toHaveBeenCalled()
})

// FIX 1 bite-proof. Unauthenticated PostgREST under RLS resolves `{ data: null, error: null }` —
// indistinguishable, from useSettings' point of view, from "this authenticated user genuinely has
// no settings row yet". Before the fix, that empty-row branch always persisted DEFAULTS to
// `ma-snapshot-settings`, so a signed-out visitor whose session vanished without a SIGNED_OUT event
// (leaving `ma-last-user` behind) would silently overwrite the real snapshot with cork/calendar —
// exactly the regression Task 3 fixed for the *error* case, reopened here for the *empty* case.
test('a signed-out visitor with a stale remembered id does not overwrite the settings snapshot on an empty row', async () => {
  h.user.current = null
  localStorage.setItem('ma-last-user', 'user-1')
  const existing = { v: 1, userId: 'user-1', settings: { theme: 'brutal', defaultView: 'kanban' } }
  localStorage.setItem('ma-snapshot-settings', JSON.stringify(existing))
  h.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
  render(
    <SettingsProvider>
      <Consumer label="a" />
    </SettingsProvider>,
  )
  // The hook still resolves (to DEFAULTS) rather than hanging...
  await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('cork'))
  // ...but the on-disk snapshot, which the next offline boot reads, must be untouched.
  expect(JSON.parse(localStorage.getItem('ma-snapshot-settings')!)).toEqual(existing)
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
