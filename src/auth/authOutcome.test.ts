import { expect, test } from 'vitest'
import { AuthApiError, AuthRetryableFetchError, AuthWeakPasswordError } from '@supabase/supabase-js'
import { classifyAuthError, failed } from './authOutcome'

test('maps GoTrue error codes to this app’s reasons', () => {
  const cases: Array<[string, string]> = [
    ['invalid_credentials', 'bad-credentials'],
    ['email_not_confirmed', 'email-not-confirmed'],
    ['user_already_exists', 'email-taken'],
    ['email_exists', 'email-taken'],
    ['same_password', 'same-password'],
    ['otp_expired', 'expired-link'],
    ['otp_disabled', 'expired-link'],
    ['over_email_send_rate_limit', 'rate-limited'],
  ]
  for (const [code, reason] of cases) {
    expect(classifyAuthError(new AuthApiError('vendor text', 400, code)).reason).toBe(reason)
  }
})

test('never renders the raw GoTrue string for a mapped reason', () => {
  // The whole point of the seam: "Invalid login credentials" is vendor vocabulary.
  const failure = classifyAuthError(
    new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
  )
  expect(failure.message).not.toContain('Invalid login credentials')
  expect(failure.message).toBe('That email and password don’t match an account.')
})

test('a bad-credentials message does not distinguish email from password', () => {
  // A message that named which half was wrong would make this form an account-enumeration oracle.
  const { message } = classifyAuthError(
    new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
  )
  expect(message.toLowerCase()).not.toMatch(/no account|not registered|wrong password|unknown user/)
})

test('classifies the two error classes that are not AuthApiErrors', () => {
  // Regression guard: isAuthApiError returns FALSE for both of these in auth-js 2.110.8, so the
  // code table alone would miss them — AuthWeakPasswordError despite carrying code 'weak_password'.
  expect(classifyAuthError(new AuthRetryableFetchError('Failed to fetch', 0)).reason).toBe(
    'offline',
  )
  expect(classifyAuthError(new AuthWeakPasswordError('too weak', 422, ['length'])).reason).toBe(
    'weak-password',
  )
})

test('a bare fetch TypeError is offline, not unknown', () => {
  // This is the #131 case: a rejected fetch carries no auth-js branding at all, and calling it
  // "expired" would send a user with a good link off to request another one.
  expect(classifyAuthError(new TypeError('Failed to fetch')).reason).toBe('offline')
})

test('a 429 with no recognized code is still rate-limited', () => {
  expect(classifyAuthError(new AuthApiError('slow down', 429, 'something_new')).reason).toBe(
    'rate-limited',
  )
})

test('an unmapped code keeps the vendor message rather than losing it', () => {
  const failure = classifyAuthError(new AuthApiError('Some novel failure', 400, 'brand_new_code'))
  expect(failure.reason).toBe('unknown')
  expect(failure.message).toBe('Some novel failure')
})

test('handles a plain Error and a non-Error throw', () => {
  expect(classifyAuthError(new Error('boom'))).toEqual({ reason: 'unknown', message: 'boom' })
  expect(classifyAuthError('a string')).toEqual({
    reason: 'unknown',
    message: 'Something went wrong',
  })
})

test('failed() wraps a classification in the outcome shape', () => {
  const outcome = failed(new AuthApiError('x', 400, 'invalid_credentials'))
  expect(outcome.ok).toBe(false)
  expect(outcome.failure.reason).toBe('bad-credentials')
})
