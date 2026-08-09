import {
  isAuthApiError,
  isAuthRetryableFetchError,
  isAuthWeakPasswordError,
} from '@supabase/supabase-js'

/**
 * The vocabulary every auth action answers in. This is the whole point of the seam: callers
 * branch on a `reason` this app defines, never on a GoTrue string, a status code, or an
 * `instanceof` against a vendor class.
 *
 * `unknown` is deliberately part of the union rather than an escape hatch to `throw` — an
 * unmapped GoTrue error still has to render *something*, and losing its text would make an
 * unrecognized failure less diagnosable than it is today. That is why `AuthFailure` carries a
 * `message` alongside the `reason`: known reasons get our copy, `unknown` passes the vendor
 * message through.
 */
export type AuthFailureReason =
  | 'bad-credentials'
  | 'email-not-confirmed'
  | 'email-taken'
  | 'weak-password'
  | 'same-password'
  | 'expired-link'
  | 'rate-limited'
  | 'offline'
  | 'unknown'

export interface AuthFailure {
  reason: AuthFailureReason
  /** Ready to render. Never a raw GoTrue string except when `reason` is `'unknown'`. */
  message: string
}

export type AuthOutcome = { ok: true } | { ok: false; failure: AuthFailure }

/**
 * Sign-up needs one extra bit: whether Supabase returned a session immediately or is waiting on
 * an emailed confirmation. It is not a failure, so it cannot ride on `AuthFailure`.
 */
export type SignUpOutcome =
  { ok: true; confirmationRequired: boolean } | { ok: false; failure: AuthFailure }

/**
 * Copy for every reason we recognize.
 *
 * `bad-credentials` stays deliberately vague about *which* half was wrong — GoTrue does not
 * distinguish them either, and a message that did would turn the sign-in form into an account
 * enumeration oracle.
 */
const MESSAGES: Record<Exclude<AuthFailureReason, 'unknown'>, string> = {
  'bad-credentials': 'That email and password don’t match an account.',
  'email-not-confirmed': 'Confirm your email address first — check your inbox for the link.',
  'email-taken': 'An account already exists for that email. Try signing in instead.',
  'weak-password':
    'That password is too weak. Use at least 10 characters, including upper- and lower-case letters, a number, and a symbol.',
  'same-password': 'That’s already your current password. Choose a different one.',
  'expired-link': 'This link is invalid or has expired.',
  'rate-limited': 'Too many attempts. Wait a minute and try again.',
  offline: 'Couldn’t reach the server. Check your connection and try again.',
}

/**
 * GoTrue error codes we map. Anything absent falls through to `unknown` and keeps its own text,
 * so an unrecognized code degrades to today's behaviour rather than to silence.
 *
 * Codes are from GoTrue's stable `error_code` set, not the human-readable `message` — the
 * message is localized/reworded across releases, the code is not.
 */
const CODE_REASONS: Record<string, AuthFailureReason> = {
  invalid_credentials: 'bad-credentials',
  email_not_confirmed: 'email-not-confirmed',
  user_already_exists: 'email-taken',
  email_exists: 'email-taken',
  weak_password: 'weak-password',
  same_password: 'same-password',
  otp_expired: 'expired-link',
  otp_disabled: 'expired-link',
  over_email_send_rate_limit: 'rate-limited',
  over_request_rate_limit: 'rate-limited',
  over_sms_send_rate_limit: 'rate-limited',
}

/** Builds a failure from a reason, using our copy. */
export function authFailure(reason: Exclude<AuthFailureReason, 'unknown'>): AuthFailure {
  return { reason, message: MESSAGES[reason] }
}

/**
 * Turns anything a GoTrue call can produce — a returned `{ error }`, a thrown `AuthError`, a
 * rejected fetch, a non-Error value — into one `AuthFailure`.
 *
 * The two specific guards run first because in auth-js 2.110.8 `AuthRetryableFetchError` and
 * `AuthWeakPasswordError` are **not** `AuthApiError`s — `isAuthApiError` returns false for both —
 * so the code-based lookup below would never see them. `AuthWeakPasswordError` even carries
 * `code: 'weak_password'`, which makes it look like the table would catch it. It would not.
 */
export function classifyAuthError(e: unknown): AuthFailure {
  if (isAuthRetryableFetchError(e)) return authFailure('offline')
  if (isAuthWeakPasswordError(e)) return authFailure('weak-password')

  if (isAuthApiError(e)) {
    const reason = e.code ? CODE_REASONS[e.code] : undefined
    if (reason && reason !== 'unknown') return authFailure(reason)
    // 429 without a recognized code is still a rate limit.
    if (e.status === 429) return authFailure('rate-limited')
    return { reason: 'unknown', message: e.message }
  }

  // A fetch that never reached GoTrue rejects as a bare TypeError ("Failed to fetch"), which
  // carries no auth-js branding at all. Treating it as `unknown` would tell a user with no
  // connection that their link expired — the exact confusion #131 is about.
  if (e instanceof TypeError) return authFailure('offline')

  if (e instanceof Error) return { reason: 'unknown', message: e.message }
  return { reason: 'unknown', message: 'Something went wrong' }
}

/** Convenience for the common `{ ok: false }` shape. */
export function failed(e: unknown): { ok: false; failure: AuthFailure } {
  return { ok: false, failure: classifyAuthError(e) }
}
