/**
 * The Board Invitation token this browser is holding for its invitee (#437).
 *
 * `/auth-token-bootstrap.js` captures `?token=` from `/invite` into closure memory and scrubs the
 * address bar before any app code runs; `adoptCapturedInvitation` moves it here. It is held in
 * `localStorage`, not `sessionStorage`, because the most common path is: open the link, sign up,
 * and confirm from the email, which opens a **new tab** — per-tab storage would lose the token
 * exactly there.
 *
 * `localStorage` is acceptable for this token, while the calendar-feed token is kept out of it,
 * because an Invitation token is **not a bearer credential**: accepting also requires the caller's
 * verified Account email to equal the invited address, re-checked by the server. The stored token
 * is useless to anyone but the person it names. It still expires after a day here, and is cleared
 * on accept, decline, refusal, sign-out, or expiry.
 */

const KEY = 'ma-pending-invitation'

/** How long a captured invitation waits for its invitee to sign in. */
export const PENDING_INVITATION_TTL_MS = 24 * 60 * 60 * 1000

interface Stored {
  token: string
  savedAt: number
}

interface InvitationCapture {
  read(): string | null
  consume(): void
}

declare global {
  interface Window {
    __magicAgendaInvitationCapture?: InvitationCapture
  }
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Stores a token for the invitee, replacing any earlier one. */
export function savePendingInvitation(token: string, now = Date.now()): void {
  try {
    storage()?.setItem(KEY, JSON.stringify({ token, savedAt: now } satisfies Stored))
  } catch {
    // Storage full or blocked: the invitee can still open the link again after signing in.
  }
}

/** The held token, or null when there is none, it is malformed, or it has expired. */
export function readPendingInvitation(now = Date.now()): string | null {
  let raw: string | null
  try {
    raw = storage()?.getItem(KEY) ?? null
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<Stored>
    if (
      typeof parsed.token === 'string' &&
      parsed.token !== '' &&
      typeof parsed.savedAt === 'number' &&
      now - parsed.savedAt < PENDING_INVITATION_TTL_MS &&
      parsed.savedAt <= now
    ) {
      return parsed.token
    }
  } catch {
    // Malformed: fall through and clear it.
  }
  clearPendingInvitation()
  return null
}

export function clearPendingInvitation(): void {
  try {
    storage()?.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
}

/**
 * Moves a token the bootstrap captured on this page load into storage, then forgets the capture so
 * a later client-side visit to `/invite` cannot re-adopt it. Idempotent, so StrictMode's double
 * evaluation of a state initializer is harmless.
 */
export function adoptCapturedInvitation(now = Date.now()): void {
  const capture = window.__magicAgendaInvitationCapture
  const token = capture?.read() ?? null
  if (!token) return
  savePendingInvitation(token, now)
  capture?.consume()
}

/** The link an Owner hands to the invitee. */
export function invitationLink(token: string, origin = window.location.origin): string {
  return `${origin}/invite?token=${encodeURIComponent(token)}`
}
