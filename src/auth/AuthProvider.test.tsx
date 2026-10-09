import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
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

test('redeeming a sign-up link raises the password gate, with its own reason', async () => {
  // A confirmed sign-up has no password: the database discards whatever was stored before the
  // address was confirmed. GoTrue reports the redemption as a plain SIGNED_IN, so nothing but
  // the redeem call itself can raise the gate.
  const { result } = renderHook(() => useAuth(), { wrapper })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.passwordGateReason).toBeNull()

  await act(async () => {
    await result.current.redeemToken('hash', 'signup')
  })
  expect(result.current.passwordRecovery).toBe(true)
  expect(result.current.passwordGateReason).toBe('signup')
  expect(sessionStorage.getItem('ma-password-recovery')).toBe('signup')

  act(() => result.current.clearPasswordRecovery())
  expect(result.current.passwordRecovery).toBe(false)
})

test('a sign-up link that fails to redeem leaves no password gate behind', async () => {
  fake.next.redeemToken = { ok: false, failure: { reason: 'unknown', message: 'expired' } }
  const { result } = renderHook(() => useAuth(), { wrapper })
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => {
    await result.current.redeemToken('hash', 'signup')
  })
  expect(result.current.passwordRecovery).toBe(false)
  expect(sessionStorage.getItem('ma-password-recovery')).toBeNull()
})

test('redeeming a recovery link does not raise the sign-up gate by itself', async () => {
  // Recovery is raised by the PASSWORD_RECOVERY event, as before; the redeem call must not claim
  // it as a sign-up.
  const { result } = renderHook(() => useAuth(), { wrapper })
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => {
    await result.current.redeemToken('hash', 'recovery')
  })
  expect(result.current.passwordGateReason).toBeNull()

  act(() => fake.emit('PASSWORD_RECOVERY', fakeSession()))
  expect(result.current.passwordGateReason).toBe('recovery')
})

test('a sign-up that signs in at once still owes a password', async () => {
  fake.next.signUp = { ok: true, confirmationRequired: false }
  const { result } = renderHook(() => useAuth(), { wrapper })
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => {
    await result.current.signUp('a@b.co', 'throwaway', 'captcha')
  })
  expect(result.current.passwordGateReason).toBe('signup')
})

test('a sign-up awaiting confirmation raises nothing yet', async () => {
  fake.next.signUp = { ok: true, confirmationRequired: true }
  const { result } = renderHook(() => useAuth(), { wrapper })
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => {
    await result.current.signUp('a@b.co', 'throwaway', 'captcha')
  })
  expect(result.current.passwordRecovery).toBe(false)
})

test('SIGNED_OUT clears the remembered board and view, and every offline snapshot', async () => {
  // The snapshot clearing is what makes storing task text at rest acceptable (see
  // src/data/snapshot.ts); this is the test that would fail if a future refactor of the
  // SIGNED_OUT block dropped it.
  sessionStorage.setItem('ma-board-view', 'week')
  localStorage.setItem('ma-selected-board', 'b1')
  localStorage.setItem(
    'ma-snapshot-board',
    JSON.stringify({ v: 1, userId: 'u1', savedAt: 1, tasks: [], templates: [] }),
  )
  localStorage.setItem(
    'ma-snapshot-settings',
    JSON.stringify({ v: 1, userId: 'u1', settings: { theme: 'cork', defaultView: 'calendar' } }),
  )
  localStorage.setItem('ma-last-user', 'u1')
  localStorage.setItem('ma-pending-invitation', JSON.stringify({ token: 't', savedAt: Date.now() }))
  const { result } = renderHook(() => useAuth(), { wrapper })
  await waitFor(() => expect(result.current.loading).toBe(false))
  act(() => fake.emit('SIGNED_OUT', null))
  expect(sessionStorage.getItem('ma-board-view')).toBeNull()
  expect(localStorage.getItem('ma-selected-board')).toBeNull()
  expect(localStorage.getItem('ma-snapshot-board')).toBeNull()
  expect(localStorage.getItem('ma-snapshot-settings')).toBeNull()
  // A held Board Invitation belongs to whoever was signing in with it (#437).
  expect(localStorage.getItem('ma-pending-invitation')).toBeNull()
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
    await result.current.signIn('a@b.co', 'pw', 'captcha')
    await result.current.sendPasswordReset('a@b.co', 'captcha')
    await result.current.setPassword('newpw')
    await result.current.redeemToken('tok', 'signup')
    await result.current.signOut()
  })

  expect(fake.calls.signIn).toEqual([['a@b.co', 'pw', 'captcha']])
  expect(fake.calls.sendPasswordReset).toEqual([['a@b.co', 'captcha']])
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

// ——— the device's push subscription follows the session ———

function pushSpy() {
  const order: string[] = []
  return {
    order,
    push: {
      release: vi.fn((accountId: string | null) => {
        order.push(`release:${accountId}`)
        return Promise.resolve()
      }),
      reconcile: vi.fn((_accountId: string) => Promise.resolve()),
    },
  }
}

test('signing out releases this device before the session is gone', async () => {
  const session = fakeSession()
  fake = fakeAuthGateway({ session })
  const signOut = fake.gateway.signOut.bind(fake.gateway)
  const { push, order } = pushSpy()
  fake.gateway.signOut = () => {
    order.push('signOut')
    return signOut()
  }
  const { result } = renderHook(() => useAuth(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AuthProvider gateway={fake.gateway} push={push}>
        {children}
      </AuthProvider>
    ),
  })
  await waitFor(() => expect(result.current.user).not.toBeNull())

  await act(async () => {
    await result.current.signOut()
  })
  expect(order).toEqual([`release:${session.user.id}`, 'signOut'])
})

test('a sign-out that fails to release the device still signs out', async () => {
  fake = fakeAuthGateway({ session: fakeSession() })
  const { push } = pushSpy()
  push.release.mockRejectedValue(new Error('no service worker'))
  const { result } = renderHook(() => useAuth(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AuthProvider gateway={fake.gateway} push={push}>
        {children}
      </AuthProvider>
    ),
  })
  await waitFor(() => expect(result.current.user).not.toBeNull())
  await act(async () => {
    await result.current.signOut()
  })
  expect(fake.calls.signOut).toBe(1)
})

test('SIGNED_OUT from anywhere retires the browser subscription', () => {
  const { push } = pushSpy()
  renderHook(() => useAuth(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AuthProvider gateway={fake.gateway} push={push}>
        {children}
      </AuthProvider>
    ),
  })
  act(() => fake.emit('SIGNED_OUT', null))
  expect(push.release).toHaveBeenCalledWith(null)
})

test('a session reconciles the subscription it inherited from this browser', async () => {
  const session = fakeSession()
  fake = fakeAuthGateway({ session })
  const { push } = pushSpy()
  const { result } = renderHook(() => useAuth(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AuthProvider gateway={fake.gateway} push={push}>
        {children}
      </AuthProvider>
    ),
  })
  await waitFor(() => expect(result.current.user).not.toBeNull())
  await waitFor(() => expect(push.reconcile).toHaveBeenCalledWith(session.user.id))
  // A token refresh replaces the session object, not the Account: once is enough.
  act(() => fake.emit('TOKEN_REFRESHED', fakeSession()))
  expect(push.reconcile).toHaveBeenCalledTimes(1)
})
