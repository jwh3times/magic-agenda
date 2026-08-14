import type { ViewName } from '../types/task'
import type { BoardRole } from './role'

/**
 * Which Board is selected, decided purely.
 *
 * The Board Directory's only interesting decision is this one, and it is the kind that acquires
 * silent special cases if it lives inside a hook: a remembered id that no longer exists, an account
 * whose last Board just went away, a first boot with nothing remembered. Each is a normal
 * condition, not an error, and each has exactly one right answer — which is easier to state and
 * test here than to infer from a `useEffect` later.
 */

/**
 * One Board as the app needs to know it: identity, what to call it, and what this Account may do
 * with it. Flattened across `boards` and `board_memberships` on purpose — every consumer needs both
 * halves, and nothing in the UI has a use for a Board it has no Membership in.
 */
export interface BoardSummary {
  id: string
  name: string
  /** The caller's role in this Board. Read through capabilities, never compared directly. */
  role: BoardRole
  /** This Membership's Default View — a per-Board preference, not an Account-wide one. */
  defaultView: ViewName
  /** The Membership row's id, needed to write Membership Preferences back. */
  membershipId: string
}

/**
 * The Board to show, given what exists and what was last remembered.
 *
 * Returns `null` only when there are no Boards at all. That is a real state the domain model
 * allows — an Account may have zero Boards after leaving or deleting its last one — and the product
 * answer is to offer creating or joining one, never to silently mint another.
 *
 * A remembered id that is absent from `boards` is **not** an error and must not be surfaced as one:
 * it is what a deleted Board, a revoked Membership, and a stale device all look like from here, and
 * the client cannot tell those apart because the server deliberately does not distinguish them.
 * Falling back to the first available Board is what makes losing access degrade to "you are looking
 * at your other board" instead of an empty screen.
 *
 * Order is the caller's: `boards` is expected to arrive in a stable server order so that "the first
 * one" is not a different Board on every load.
 */
export function resolveSelection(
  boards: readonly BoardSummary[],
  rememberedId: string | null | undefined,
): string | null {
  if (boards.length === 0) return null
  if (rememberedId && boards.some((b) => b.id === rememberedId)) return rememberedId
  return boards[0].id
}

/** The selected Board itself, or `null` when the selection resolves to nothing. */
export function selectedBoard(
  boards: readonly BoardSummary[],
  rememberedId: string | null | undefined,
): BoardSummary | null {
  const id = resolveSelection(boards, rememberedId)
  return id ? (boards.find((b) => b.id === id) ?? null) : null
}

/**
 * Which remembered Board snapshots are still allowed to exist.
 *
 * The **security-relevant** half of the Board Directory, and the reason this is a function rather
 * than an inline filter. When access to a Board ends — removed, Board deleted, Account deleted
 * elsewhere — the server simply stops returning it. Nothing announces the loss, so "which local
 * snapshots are stale" is a set difference the client has to compute for itself, and any Board id
 * it holds locally that the server did not just return must have its cached tasks dropped.
 *
 * Deliberately computed from the **server's** list, never from the local one: starting from what is
 * cached and removing what looks gone inverts the failure mode, so a load that returned nothing at
 * all would preserve everything instead of purging it.
 */
export function purgeableBoardIds(
  cachedBoardIds: readonly string[],
  serverBoards: readonly BoardSummary[],
): string[] {
  const live = new Set(serverBoards.map((b) => b.id))
  return cachedBoardIds.filter((id) => !live.has(id))
}
