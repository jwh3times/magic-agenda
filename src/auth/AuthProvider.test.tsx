import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test } from 'vitest'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './AuthProvider'
import { fakeAuthGateway, fakeSession, type FakeAuth } from './fakeAuthGateway'

// These drive the REAL provider through the fake adapter rather than stubbing `useAuth`, so the
// provider's own wiring — the loading flip, the recovery flag, the SIGNED_OUT cascade, the
// unsubscribe — is what's under test.
let fake: FakeAuth

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  fake = fakeAuthGateway()
})

const wrapper = ({ children }: { children: ReactNode }) => (
  <AuthProvider gateway={fake.gateway}>{children}</AuthProvider>
)

test('PASSWORD_RECOVERY raises the recovery flag and SIGNED_OUT clears it', async () => {
  const { result } = renderHook(() => useAuth(), { wrapper })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.passwordRecovery).toBe(false)

  act(() => fake.emit('PASSWORD_RECOVERY', fakeSession()))
  expect(result.current.passwordRecovery).toBe(true)

  act(() => fake.emit('SIGNED_OUT', null))
  expect(result.current.passwordRecovery).toBe(false)
})

test('the recovery flag survives a remount (page reload) via sessionStorage', async () => {
  const first = renderHook(() => useAuth(), { wrapper })
  await waitFor(() => expect(first.result.current.loading).toBe(false))
  act(() => fake.emit('PASSWORD_RECOVERY', fakeSession()))
  expect(first.result.current.passwordRecovery).toBe(true)
  first.unmount()

  const second = renderHook(() => useAuth(), { wrapper })
  expect(second.result.current.passwordRecovery).toBe(true)

  act(() => second.result.current.clearPasswordRecovery())
  expect(second.result.current.passwordRecovery).toBe(false)
  expect(sessionStorage.getItem('ma-password-recovery')).toBeNull()
})

test('SIGNED_OUT clears the remembered board view and every offline snapshot', async () => {
  // The snapshot clearing is what makes storing task text at rest acceptable (see
  // src/data/snapshot.ts); this is the test that would fail if a future refactor of the
  // SIGNED_OUT block dropped it.
  sessionStorage.setItem('ma-board-view', 'week')
  localStorage.setItem(
    'ma-snapshot-board',
    JSON.stringify({ v: 1, userId: 'u1', savedAt: 1, tasks: [], templates: [] }),
  )
  localStorage.setItem(
    'ma-snapshot-settings',
    JSON.stringify({ v: 1, userId: 'u1', settings: { theme: 'cork', defaultView: 'calendar' } }),
  )
  localStorage.setItem('ma-last-user', 'u1')
  const { result } = renderHook(() => useAuth(), { wrapper })
  await waitFor(() => expect(result.current.loading).toBe(false))
  act(() => fake.emit('SIGNED_OUT', null))
  expect(sessionStorage.getItem('ma-board-view')).toBeNull()
  expect(localStorage.getItem('ma-snapshot-board')).toBeNull()
  expect(localStorage.getItem('ma-snapshot-settings')).toBeNull()
  expect(localStorage.getItem('ma-last-user')).toBeNull()
})

test('an existing session resolves through the gateway and records the last-user id', async () => {
  fake = fakeAuthGateway({ session: fakeSession('u7') })
  const { result } = renderHook(() => useAuth(), { wrapper })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.user?.id).toBe('u7')
  expect(localStorage.getItem('ma-last-user')).toBe('u7')
})

test('unsubscribes from auth state on unmount', async () => {
  const { unmount } = renderHook(() => useAuth(), { wrapper })
  await waitFor(() => expect(fake.listenerCount()).toBe(1))
  unmount()
  expect(fake.listenerCount()).toBe(0)
})

test('actions delegate to the gateway', async () => {
  const { result } = renderHook(() => useAuth(), { wrapper })
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => {
    await result.current.signIn('a@b.co', 'pw')
    await result.current.sendPasswordReset('a@b.co')
    await result.current.setPassword('newpw')
    await result.current.redeemToken('tok', 'signup')
    await result.current.signOut()
  })

  expect(fake.calls.signIn).toEqual([['a@b.co', 'pw']])
  expect(fake.calls.sendPasswordReset).toEqual(['a@b.co'])
  expect(fake.calls.setPassword).toEqual(['newpw'])
  expect(fake.calls.redeemToken).toEqual([['tok', 'signup']])
  expect(fake.calls.signOut).toBe(1)
})

test('action identities are stable across re-renders', async () => {
  // `useTokenRedemption` lists `redeemToken` in an effect's deps. An unstable identity would
  // re-run that effect on every render, and the single-use guard would be the only thing between
  // that and redeeming a spent token.
  const { result } = renderHook(() => useAuth(), { wrapper })
  await waitFor(() => expect(result.current.loading).toBe(false))
  const before = result.current.redeemToken

  act(() => fake.emit('SIGNED_IN', fakeSession()))
  expect(result.current.session).not.toBeNull() // proves a re-render happened
  expect(result.current.redeemToken).toBe(before)
})
