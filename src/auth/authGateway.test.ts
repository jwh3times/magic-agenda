import { beforeEach, expect, test, vi } from 'vitest'
import { AuthApiError } from '@supabase/supabase-js'

const ok = { data: { session: null, user: null }, error: null }

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signInWithOAuth: vi.fn(),
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({ supabase: { auth: h } }))

import { supabaseAuthGateway as gw } from './authGateway'

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.getSession.mockResolvedValue({ data: { session: null }, error: null })
  h.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  h.signInWithPassword.mockResolvedValue(ok)
  h.signUp.mockResolvedValue(ok)
  h.resetPasswordForEmail.mockResolvedValue(ok)
  h.signInWithOAuth.mockResolvedValue(ok)
  h.updateUser.mockResolvedValue(ok)
  h.verifyOtp.mockResolvedValue(ok)
  h.signOut.mockResolvedValue({ error: null })
})

// ——— the redirect URLs ———
// These moved off Login.tsx, where they were built inline at four call sites. They must stay in
// lockstep with the routes in App.tsx, `additional_redirect_urls` in supabase/config.toml, and
// `{{ .RedirectTo }}` in supabase/templates/*.html — none of which this suite can see, which is
// exactly why the values are pinned here.

test('signUp points the confirmation email at /auth/confirm', async () => {
  await gw.signUp('a@b.co', 'Longenough123!')
  expect(h.signUp).toHaveBeenCalledWith({
    email: 'a@b.co',
    password: 'Longenough123!',
    options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
  })
})

test('sendPasswordReset points the reset email at /auth/reset', async () => {
  await gw.sendPasswordReset('a@b.co')
  expect(h.resetPasswordForEmail).toHaveBeenCalledWith('a@b.co', {
    redirectTo: `${window.location.origin}/auth/reset`,
  })
})

test('startGoogleSignIn points OAuth at /auth/callback', async () => {
  await gw.startGoogleSignIn()
  expect(h.signInWithOAuth).toHaveBeenCalledWith({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  })
})

test('redeemToken passes the token and type straight through', async () => {
  await gw.redeemToken('tok123', 'recovery')
  expect(h.verifyOtp).toHaveBeenCalledWith({ token_hash: 'tok123', type: 'recovery' })
})

// ——— the "nothing rejects" invariant ———
// This is #131. Before the seam, a rejected verifyOtp was an unhandled rejection that left
// ResetPassword and AuthConfirm on a spinner forever, with the token already scrubbed from the URL.

test('every action resolves a failure instead of rejecting', async () => {
  const boom = new TypeError('Failed to fetch')
  h.signInWithPassword.mockRejectedValue(boom)
  h.signUp.mockRejectedValue(boom)
  h.resetPasswordForEmail.mockRejectedValue(boom)
  h.signInWithOAuth.mockRejectedValue(boom)
  h.updateUser.mockRejectedValue(boom)
  h.verifyOtp.mockRejectedValue(boom)

  const outcomes = await Promise.all([
    gw.signIn('a@b.co', 'pw'),
    gw.signUp('a@b.co', 'pw'),
    gw.sendPasswordReset('a@b.co'),
    gw.startGoogleSignIn(),
    gw.setPassword('pw'),
    gw.redeemToken('tok', 'signup'),
  ])

  for (const outcome of outcomes) {
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.failure.reason).toBe('offline')
  }
})

test('a returned { error } becomes the same shape as a thrown one', async () => {
  h.signInWithPassword.mockResolvedValue({
    data: { session: null, user: null },
    error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
  })
  const outcome = await gw.signIn('a@b.co', 'wrong')
  expect(outcome).toEqual({
    ok: false,
    failure: {
      reason: 'bad-credentials',
      message: 'That email and password don’t match an account.',
    },
  })
})

test('signOut swallows a rejection rather than blocking the local sign-out cascade', async () => {
  h.signOut.mockRejectedValue(new TypeError('Failed to fetch'))
  await expect(gw.signOut()).resolves.toBeUndefined()
})

// ——— session reads ———

test('signUp reports whether a confirmation email is pending', async () => {
  h.signUp.mockResolvedValue({ data: { session: null, user: {} }, error: null })
  expect(await gw.signUp('a@b.co', 'pw')).toEqual({ ok: true, confirmationRequired: true })

  h.signUp.mockResolvedValue({ data: { session: { user: {} }, user: {} }, error: null })
  expect(await gw.signUp('a@b.co', 'pw')).toEqual({ ok: true, confirmationRequired: false })
})

test('getSession degrades to null instead of rejecting', async () => {
  // A rejection here used to leave AuthProvider's `loading` true forever — the whole app stuck
  // on a spinner. Signed-out is the correct degradation: writes are gated on a live session.
  h.getSession.mockRejectedValue(new TypeError('Failed to fetch'))
  await expect(gw.getSession()).resolves.toBeNull()
})

test('onAuthStateChange returns an unsubscribe that reaches the vendor subscription', async () => {
  const unsubscribe = vi.fn()
  h.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } })
  const stop = gw.onAuthStateChange(() => {})
  expect(unsubscribe).not.toHaveBeenCalled()
  stop()
  expect(unsubscribe).toHaveBeenCalledTimes(1)
})
