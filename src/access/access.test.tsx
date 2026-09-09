import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'
import { AuthProvider } from '../auth/AuthProvider'
import { fakeAuthGateway, fakeSession } from '../auth/fakeAuthGateway'
import { useRole } from './useRole'
import { useFlags } from './useFlags'

const mock = vi.hoisted(() => ({
  role: vi.fn<() => Promise<{ data: { role: string } | null; error: unknown }>>(),
  flags: vi.fn<
    () => Promise<{
      data: Array<{ key: string; enabled: boolean; description: string }>
      error: unknown
    }>
  >(),
}))
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () =>
        table === 'user_roles' ? { eq: () => ({ maybeSingle: mock.role }) } : { order: mock.flags },
    }),
  },
}))

beforeEach(() => {
  vi.resetAllMocks()
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  mock.role.mockResolvedValue({ data: { role: 'admin' }, error: null })
  mock.flags.mockResolvedValue({
    data: [{ key: 'preview', enabled: true, description: '' }],
    error: null,
  })
})

function setup(session = fakeSession()) {
  const auth = fakeAuthGateway({ session })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider gateway={auth.gateway}>{children}</AuthProvider>
  )
  return { auth, ...renderHook(() => ({ role: useRole(), flags: useFlags() }), { wrapper }) }
}

test('loads the database role and gates only explicitly enabled flags', async () => {
  const { result } = setup()
  expect(result.current.role.isAdmin).toBe(false)
  expect(result.current.flags.isEnabled('preview')).toBe(false)
  await waitFor(() => expect(result.current.role.isAdmin).toBe(true))
  expect(result.current.flags.isEnabled('preview')).toBe(true)
  expect(result.current.flags.isEnabled('unknown')).toBe(false)
})

test('sign-out clears both hints without leaving an offline copy', async () => {
  const { auth, result } = setup()
  await waitFor(() => expect(result.current.role.isAdmin).toBe(true))
  act(() => auth.emit('SIGNED_OUT', null))
  expect(result.current.role.isAdmin).toBe(false)
  expect(result.current.flags.isEnabled('preview')).toBe(false)
})

test('late responses cannot grant the previous account permissions to the next account', async () => {
  let finish!: (value: { data: { role: string }; error: null }) => void
  mock.role.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const { auth, result } = setup()
  await waitFor(() => expect(mock.role).toHaveBeenCalledTimes(1))
  mock.role.mockResolvedValue({ data: null, error: null })
  mock.flags.mockResolvedValue({ data: [], error: null })
  act(() => auth.emit('SIGNED_IN', fakeSession('u2')))
  expect(result.current.role.isAdmin).toBe(false)
  expect(result.current.flags.isEnabled('preview')).toBe(false)
  await waitFor(() => expect(result.current.role.loading).toBe(false))
  await act(async () => {
    finish({ data: { role: 'admin' }, error: null })
    await Promise.resolve()
  })
  expect(result.current.role.isAdmin).toBe(false)
})

test('offline closes gates immediately and reconnect reloads them', async () => {
  const { result } = setup()
  await waitFor(() => expect(result.current.role.isAdmin).toBe(true))
  act(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    window.dispatchEvent(new Event('offline'))
  })
  expect(result.current.role.isAdmin).toBe(false)
  expect(result.current.flags.isEnabled('preview')).toBe(false)
  mock.role.mockResolvedValue({ data: null, error: null })
  mock.flags.mockResolvedValue({ data: [], error: null })
  act(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    window.dispatchEvent(new Event('online'))
  })
  await waitFor(() => expect(result.current.role.loading).toBe(false))
  expect(result.current.role.isAdmin).toBe(false)
})

test('focus refresh observes revocation and read failures disable flags', async () => {
  const { result } = setup()
  await waitFor(() => expect(result.current.role.isAdmin).toBe(true))
  mock.role.mockResolvedValue({ data: null, error: null })
  mock.flags.mockRejectedValue(new Error('network unavailable'))
  act(() => {
    window.dispatchEvent(new Event('focus'))
  })
  await waitFor(() => expect(result.current.flags.error).not.toBeNull())
  expect(result.current.role.isAdmin).toBe(false)
  expect(result.current.flags.isEnabled('preview')).toBe(false)
})
