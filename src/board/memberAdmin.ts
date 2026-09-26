import { supabase } from '../lib/supabase'
import {
  boardFailure,
  boardFailureUnknown,
  type BoardFailure,
  type BoardFailureReason,
  type BoardOutcome,
} from './outcome'
import type { BoardRole } from './role'

/**
 * Membership administration's client seam (#438): change a role, remove a member, leave a Board.
 *
 * Each is a command (`change_member_role`, `remove_member`, `leave_board`) because the one rule
 * that matters — a Board always keeps a current Owner — spans rows and races, and only a command
 * holding the Board row lock can enforce it. The server decides everything; this module only
 * translates its refusals into the Board outcome vocabulary, so a caller branches on a reason this
 * app owns and never on a Postgres string.
 *
 * Offering the controls is still a `capabilitiesFor` decision in the UI, and a capability grants
 * nothing: an Editor who reaches `changeMemberRole` is refused by the server as `not-owner`.
 */

/**
 * The refusal tokens the three commands raise (see the migration's header), mapped to reasons.
 * `invalid-role` has no reason of its own: the UI only offers the three roles, so reaching it is a
 * bug, and it falls through to `unknown` with the token as its message.
 */
const TOKENS: Readonly<Record<string, Exclude<BoardFailureReason, 'unknown'>>> = {
  'last-owner': 'last-owner',
  'membership-ended': 'membership-ended',
  'not-owner': 'not-owner',
  'member-ended': 'member-ended',
}

/** A command's error message as a Board failure. Exported for its tests. */
export function classifyMemberAdminError(message: string): BoardFailure {
  const reason = TOKENS[message]
  return reason ? boardFailure(reason) : boardFailureUnknown(message)
}

async function run(
  call: () => PromiseLike<{ error: { message: string } | null }>,
): Promise<BoardOutcome> {
  try {
    const { error } = await call()
    if (error) return { ok: false, failure: classifyMemberAdminError(error.message) }
    return { ok: true, value: undefined }
  } catch (cause) {
    return {
      ok: false,
      failure: boardFailureUnknown(cause instanceof Error ? cause.message : String(cause)),
    }
  }
}

/** An Owner sets another member's role, including their own when another Owner remains. */
export function changeMemberRole(membershipId: string, role: BoardRole): Promise<BoardOutcome> {
  return run(() =>
    supabase.rpc('change_member_role', { p_membership_id: membershipId, p_role: role }),
  )
}

/** An Owner ends another member's Membership. Removing yourself is recorded as leaving. */
export function removeMember(membershipId: string): Promise<BoardOutcome> {
  return run(() => supabase.rpc('remove_member', { p_membership_id: membershipId }))
}

/** Any member ends their own Membership. The last Owner is refused as `last-owner`. */
export function leaveBoard(boardId: string): Promise<BoardOutcome> {
  return run(() => supabase.rpc('leave_board', { p_board_id: boardId }))
}
