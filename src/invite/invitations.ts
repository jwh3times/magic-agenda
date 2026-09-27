import { supabase } from '../lib/supabase'

/**
 * Board Invitations' client seam (#437) over the #436 commands.
 *
 * The server decides everything — who may invite, the limits, whether a token is still good, and
 * whether the caller is the person it names. This module translates its refusal tokens into copy
 * and never throws: failures are values, as in the Board and auth seams.
 */

export type InvitationRole = 'editor' | 'viewer'

export type InvitationFailureReason =
  | 'membership-ended'
  | 'not-owner'
  | 'invalid-email'
  | 'invalid-role'
  | 'already-member'
  | 'already-invited'
  | 'too-many-pending'
  | 'rate-limited'
  | 'invitation-unavailable'
  | 'invitation-expired'
  | 'email-unverified'
  | 'email-mismatch'
  | 'unknown'

export type InvitationOutcome<T = void> =
  { ok: true; value: T } | { ok: false; reason: InvitationFailureReason; message: string }

const MESSAGES: Record<Exclude<InvitationFailureReason, 'unknown'>, string> = {
  'membership-ended': 'You no longer have access to this board.',
  'not-owner': 'Only an owner of this board can invite people.',
  'invalid-email': 'Enter a valid email address.',
  'invalid-role': 'Choose Editor or Viewer.',
  'already-member': 'That person is already on this board.',
  'already-invited': 'That email already has a pending invitation. Revoke it to create a new link.',
  'too-many-pending': 'This board has too many pending invitations. Revoke some first.',
  'rate-limited': 'You have created a lot of invitations today. Try again tomorrow.',
  'invitation-unavailable':
    'This invitation is no longer available. Ask the board owner for a new link.',
  'invitation-expired': 'This invitation has expired. Ask the board owner for a new link.',
  'email-unverified': 'Confirm your email address first, then open the invitation again.',
  'email-mismatch':
    'This invitation was sent to a different email address. Sign in with that address to accept it.',
}

/**
 * Refusals that end an invitation for this browser: the held token can never succeed for this
 * Account, so it is cleared. `email-unverified` is deliberately not one — confirming the address
 * fixes it — and neither is a network failure.
 */
export const FINAL_FOR_INVITEE: ReadonlySet<InvitationFailureReason> = new Set([
  'invitation-unavailable',
  'invitation-expired',
  'email-mismatch',
])

/** A command's error message as an outcome. Exported for its tests. */
export function classifyInvitationError(message: string): {
  ok: false
  reason: InvitationFailureReason
  message: string
} {
  if (message in MESSAGES) {
    const reason = message as Exclude<InvitationFailureReason, 'unknown'>
    return { ok: false, reason, message: MESSAGES[reason] }
  }
  return { ok: false, reason: 'unknown', message }
}

async function run<T>(
  call: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  map: (data: unknown) => T,
): Promise<InvitationOutcome<T>> {
  try {
    const { data, error } = await call()
    if (error) return classifyInvitationError(error.message)
    return { ok: true, value: map(data) }
  } catch (cause) {
    return {
      ok: false,
      reason: 'unknown',
      message: cause instanceof Error ? cause.message : String(cause),
    }
  }
}

// ——— Owner side ———

/** Creates an Invitation and returns its token — the only time the token is ever available. */
export function createInvitation(
  boardId: string,
  email: string,
  role: InvitationRole,
): Promise<InvitationOutcome<string>> {
  return run(
    () => supabase.rpc('create_invitation', { p_board_id: boardId, p_email: email, p_role: role }),
    (data) => String(data),
  )
}

export function revokeInvitation(invitationId: string): Promise<InvitationOutcome> {
  return run(
    () => supabase.rpc('revoke_invitation', { p_invitation_id: invitationId }),
    () => undefined,
  )
}

export interface PendingInvitation {
  id: string
  email: string
  role: InvitationRole
  expiresAt: string
}

/**
 * A Board's pending, unexpired Invitations. RLS returns rows only to the Board's current Owners,
 * so for anyone else this is an empty list, not an error.
 */
export function listPendingInvitations(
  boardId: string,
  now = new Date(),
): Promise<InvitationOutcome<PendingInvitation[]>> {
  return run(
    () =>
      supabase
        .from('board_invitations')
        .select('id, target_email, role, expires_at')
        .eq('board_id', boardId)
        .eq('status', 'pending')
        .gt('expires_at', now.toISOString())
        .order('created_at', { ascending: true }),
    (data) =>
      (
        (data ?? []) as {
          id: string
          target_email: string | null
          role: string
          expires_at: string
        }[]
      )
        .filter(
          (row) => row.target_email !== null && (row.role === 'editor' || row.role === 'viewer'),
        )
        .map((row) => ({
          id: row.id,
          email: row.target_email as string,
          role: row.role as InvitationRole,
          expiresAt: row.expires_at,
        })),
  )
}

// ——— Invitee side ———

export interface InvitationPreview {
  boardName: string
  /** The inviter's Display Name; empty when they never set one. */
  inviterName: string
  role: InvitationRole
  expiresAt: string
}

/** What the invitation offers, for the signed-in invitee whose verified email it names. */
export function previewInvitation(token: string): Promise<InvitationOutcome<InvitationPreview>> {
  return run(
    () => supabase.rpc('invitation_preview', { p_token: token }),
    (data) => {
      const [row] = (data ?? []) as {
        board_name: string
        inviter_name: string
        role: string
        expires_at: string
      }[]
      return {
        boardName: row.board_name,
        inviterName: row.inviter_name,
        role: row.role === 'editor' ? 'editor' : 'viewer',
        expiresAt: row.expires_at,
      }
    },
  )
}

/** Joins the Board. Resolves to the Board's id. */
export function acceptInvitation(token: string): Promise<InvitationOutcome<string>> {
  return run(
    () => supabase.rpc('accept_invitation', { p_token: token }),
    (data) => String(data),
  )
}

export function declineInvitation(token: string): Promise<InvitationOutcome> {
  return run(
    () => supabase.rpc('decline_invitation', { p_token: token }),
    () => undefined,
  )
}
