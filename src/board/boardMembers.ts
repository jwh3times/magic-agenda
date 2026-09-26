import { supabase } from '../lib/supabase'
import { boardFailed, boardFailureUnknown, type BoardOutcome } from './outcome'
import { asBoardRole, type BoardRole } from './role'

/**
 * The co-member read path's client seam (#435): who is currently on a Board.
 *
 * Served by the `board_members` RPC rather than by reading `board_memberships` and
 * `account_profiles` directly, because both tables stay own-rows only: a Membership row carries
 * that member's calendar-feed capability, and a co-member clause on its policy would hand it to
 * every other member. The definer returns exactly six columns and never the token.
 *
 * What a caller sees follows the domain model, and the server enforces it — nothing here decides
 * visibility: every current member sees every current member's Display Name and role; only an
 * Owner receives email addresses (`email` is `null` for everyone else); ended Memberships are
 * never listed.
 *
 * Not snapshotted or cached. Membership can change under a live client, and a stale list of who
 * can read a Board is worse than a spinner.
 */

export interface BoardMember {
  membershipId: string
  accountId: string
  role: BoardRole
  /** The Account's Display Name; empty when the member never set one. */
  displayName: string
  joinedAt: string
  /** Present only when the caller is an Owner of this Board. */
  email: string | null
}

/** A row as the `board_members` RPC returns it. */
export interface BoardMemberRow {
  membership_id: string
  account_id: string
  role: string
  display_name: string
  joined_at: string
  email: string | null
}

/**
 * Maps RPC rows to members, keeping the server's order (Owners, then Editors, then Viewers).
 *
 * A row whose role this client does not recognize is **dropped**, not defaulted: an unknown role
 * means a client older than the schema, and rendering it as a known role would invent an authority
 * level nobody granted — the same reason `asBoardRole` returns null rather than `viewer`.
 */
export function toBoardMembers(rows: readonly BoardMemberRow[]): BoardMember[] {
  const members: BoardMember[] = []
  for (const row of rows) {
    const role = asBoardRole(row.role)
    if (!role) continue
    members.push({
      membershipId: row.membership_id,
      accountId: row.account_id,
      role,
      displayName: row.display_name,
      joinedAt: row.joined_at,
      email: row.email,
    })
  }
  return members
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * The current members of a Board, or `membership-ended` when the caller is not one of them.
 *
 * A current member always sees at least their own row, so an empty answer can only mean the
 * caller has no current Membership — ended, never joined, or the Board is gone. The server does
 * not distinguish those for the caller, and neither does this.
 */
export async function listBoardMembers(boardId: string): Promise<BoardOutcome<BoardMember[]>> {
  try {
    const { data, error } = await supabase.rpc('board_members', { p_board_id: boardId })
    if (error) return { ok: false, failure: boardFailureUnknown(error.message) }
    if (!data || data.length === 0) return boardFailed('membership-ended')
    return { ok: true, value: toBoardMembers(data) }
  } catch (cause) {
    return { ok: false, failure: boardFailureUnknown(message(cause)) }
  }
}

/** The seam's signature, so a caller can take an in-memory source in tests. */
export type ListBoardMembers = typeof listBoardMembers

/**
 * In-memory source for tests of a caller, in the spirit of `fakeBoardDirectory`: it applies the
 * same email rule the server does, so a test cannot assert against a list the real RPC would
 * never return. Carries no vitest import and is never imported by the app.
 */
export function fakeListBoardMembers(
  members: readonly BoardMember[],
  callerAccountId: string,
): ListBoardMembers {
  return () => {
    const caller = members.find((member) => member.accountId === callerAccountId)
    if (!caller) return Promise.resolve(boardFailed('membership-ended'))
    const isOwner = caller.role === 'owner'
    const value = members.map((m) => ({ ...m, email: isOwner ? m.email : null }))
    return Promise.resolve({ ok: true, value })
  }
}
