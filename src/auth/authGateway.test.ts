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
  mfa: {
    enroll: vi.fn(),
    challengeAndVerify: vi.fn(),
    listFactors: vi.fn(),
    unenroll: vi.fn(),
    getAuthenticatorAssuranceLevel: vi.fn(),
  },
}))

vi.mock('../lib/supabase', () => ({ supabase: { auth: h } }))

import { supabaseAuthGateway as gw } from './authGateway'

const ENROLLED = {
  id: 'factor-1',
  type: 'totp',
  totp: { qr_code: '<svg/>', secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x' },
}

beforeEach(() => {
  for (const fn of Object.values(h)) if (typeof fn === 'function') fn.mockReset()
  for (const fn of Object.values(h.mfa)) fn.mockReset()
  h.mfa.enroll.mockResolvedValue({ data: ENROLLED, error: null })
  h.mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null })
  h.mfa.listFactors.mockResolvedValue({ data: { all: [], totp: [] }, error: null })
  h.mfa.unenroll.mockResolvedValue({ data: { id: 'factor-1' }, error: null })
  h.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
    data: { currentLevel: 'aal1', nextLevel: 'aal1', currentAuthenticationMethods: [] },
    error: null,
  })
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

test('onAuthStateChange returns an unsubscribe that reaches the vendor subscription', () => {
  const unsubscribe = vi.fn()
  h.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } })
  const stop = gw.onAuthStateChange(() => {})
  expect(unsubscribe).not.toHaveBeenCalled()
  stop()
  expect(unsubscribe).toHaveBeenCalledTimes(1)
})

// ——— two-factor ———

test('enrollTotp asks for a TOTP factor and flattens the secret out of the vendor shape', async () => {
  const result = await gw.enrollTotp('Authenticator')
  expect(h.mfa.enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: 'Authenticator' })
  expect(result).toEqual({
    ok: true,
    data: {
      factorId: 'factor-1',
      qrCodeSvg: '<svg/>',
      secret: 'JBSWY3DPEHPK3PXP',
      uri: 'otpauth://totp/x',
    },
  })
})

test('verifyTotp issues the challenge and spends it in one call', async () => {
  // Separate challenge/verify would mean holding a challengeId across however long the user takes
  // to read a code, which is a race against its expiry for no benefit — the two are never wanted
  // apart here.
  await gw.verifyTotp('factor-1', '123456')
  expect(h.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'factor-1', code: '123456' })
})

test('listTotpFactors returns unverified factors too, and only TOTP ones', async () => {
  // `all` rather than `totp`, which is verified-only: an abandoned enrollment still occupies one
  // of the account's slots, so the UI has to be able to show it. A phone factor is not ours.
  h.mfa.listFactors.mockResolvedValue({
    data: {
      all: [
        {
          id: 'a',
          friendly_name: 'Authenticator',
          factor_type: 'totp',
          status: 'verified',
          created_at: 't',
          updated_at: 't',
        },
        { id: 'b', factor_type: 'totp', status: 'unverified', created_at: 't', updated_at: 't' },
        {
          id: 'c',
          friendly_name: 'Phone',
          factor_type: 'phone',
          status: 'verified',
          created_at: 't',
          updated_at: 't',
        },
      ],
      totp: [],
    },
    error: null,
  })
  expect(await gw.listTotpFactors()).toEqual({
    ok: true,
    data: [
      { id: 'a', name: 'Authenticator', verified: true, createdAt: 't' },
      { id: 'b', name: null, verified: false, createdAt: 't' },
    ],
  })
})

test('getAssuranceLevel renames the vendor fields and keeps both nullable', async () => {
  h.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
    data: { currentLevel: 'aal1', nextLevel: null, currentAuthenticationMethods: [] },
    error: null,
  })
  expect(await gw.getAssuranceLevel()).toEqual({ ok: true, data: { current: 'aal1', next: null } })
})

test('a wrong code becomes this app’s own reason, not GoTrue’s prose', async () => {
  h.mfa.challengeAndVerify.mockResolvedValue({
    data: null,
    error: new AuthApiError('Invalid TOTP code entered', 422, 'mfa_verification_failed'),
  })
  const outcome = await gw.verifyTotp('factor-1', '000000')
  expect(outcome.ok).toBe(false)
  if (!outcome.ok) expect(outcome.failure.reason).toBe('invalid-code')
})

test('the two-factor actions resolve failures instead of rejecting, like every other one', async () => {
  const boom = new TypeError('Failed to fetch')
  h.mfa.enroll.mockRejectedValue(boom)
  h.mfa.challengeAndVerify.mockRejectedValue(boom)
  h.mfa.listFactors.mockRejectedValue(boom)
  h.mfa.unenroll.mockRejectedValue(boom)
  h.mfa.getAuthenticatorAssuranceLevel.mockRejectedValue(boom)

  const outcomes = await Promise.all([
    gw.enrollTotp('Authenticator'),
    gw.verifyTotp('factor-1', '123456'),
    gw.listTotpFactors(),
    gw.unenrollFactor('factor-1'),
    gw.getAssuranceLevel(),
  ])

  for (const outcome of outcomes) {
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.failure.reason).toBe('offline')
  }
})
