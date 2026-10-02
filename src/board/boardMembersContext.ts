import { createContext, useContext } from 'react'
import type { BoardMember } from './boardMembers'

/**
 * The open Board's current members, for Assignee display and choice (#440).
 *
 * `BoardPage` fills this only when the `board-sharing` flag is on; otherwise it stays empty, and
 * every Assignee control reads "empty" as "not shared" and renders nothing. A Board with one member
 * — every Private Board — is treated the same way, so nothing about Assignees appears until a
 * second person is actually on the Board.
 */
export interface BoardMembersValue {
  members: readonly BoardMember[]
  /** The signed-in viewer's account id, for "Assigned to me". Null when unknown. */
  me: string | null
}

export const NO_BOARD_MEMBERS: BoardMembersValue = { members: [], me: null }

export const BoardMembersContext = createContext<BoardMembersValue>(NO_BOARD_MEMBERS)

export function useBoardMembers(): BoardMembersValue {
  return useContext(BoardMembersContext)
}

/** Whether Assignee controls should appear at all: more than one person is on the Board. */
export function isShared(value: BoardMembersValue): boolean {
  return value.members.length > 1
}

/**
 * The name to show for a member: the Owner-private label when there is one (#490), then their own
 * Display Name, then a neutral fallback. No role check is needed here: the server returns a label
 * only to an Owner, and never on the viewer's own row, so for anyone else `nickname` is null.
 */
export function memberName(member: BoardMember | undefined): string {
  return member?.nickname?.trim() || member?.displayName.trim() || 'Unnamed member'
}

/** Up to two initials from a Display Name, for a card badge. `?` when there is no name. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const letters = words.length === 1 ? [...words[0]].slice(0, 1) : [words[0][0], words[1][0]]
  return letters.join('').toUpperCase()
}
