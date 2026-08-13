/**
 * The vocabulary every Board command answers in.
 *
 * Same seam as `src/auth/authOutcome.ts`, for the same reason: no vendor error type crosses it,
 * callers branch on a `reason` this app owns, and failures are values rather than exceptions. The
 * auth seam earned that shape by paying for its absence — a missing `.catch` stranded two pages on
 * a spinner forever — and the Board commands are strictly more failure-prone, because every one of
 * them can lose a race against another member.
 *
 * The reasons here are not error codes; they are the **states the domain says a command can land
 * in**. Each one exists because some UI has to do something different about it, and that
 * difference is named in its message.
 */

/**
 * Why a Board command did not take effect.
 *
 * `unknown` is deliberately part of the union rather than an escape to `throw`, exactly as in
 * `AuthFailureReason`: an unmapped Postgres error still has to render something, and losing its
 * text makes an unrecognized failure less diagnosable, not safer. `BoardFailure` therefore carries
 * a `message` — known reasons get our copy, `unknown` passes the underlying text through.
 */
export type BoardFailureReason =
  /** The change would leave a Board with no Owner. Every Board keeps at least one. */
  | 'last-owner'
  /** Someone else's change was accepted first; this save was made against an older Revision. */
  | 'stale-revision'
  /** The caller's Membership ended — removed, left, or the Account was deleted. */
  | 'membership-ended'
  /** The Board itself is gone. Wins over every pending client change. */
  | 'board-deleted'
  | 'unknown'

export interface BoardFailure {
  reason: BoardFailureReason
  /** Ready to render. Never a raw Postgres string except when `reason` is `'unknown'`. */
  message: string
}

export type BoardOutcome<T = void> = { ok: true; value: T } | { ok: false; failure: BoardFailure }

/**
 * Copy for every reason we recognize.
 *
 * `membership-ended` and `board-deleted` are worded so neither implies the other: a removed member
 * must not be told the Board was deleted (it wasn't, and saying so leaks a state change they are
 * no longer entitled to observe), and a member of a deleted Board must not be told they were
 * removed (they weren't, and it invites them to ask a co-owner why).
 */
const MESSAGES: Record<Exclude<BoardFailureReason, 'unknown'>, string> = {
  'last-owner': 'A board needs at least one owner. Make someone else an owner first.',
  'stale-revision': 'Someone else changed this first. Review their version before saving yours.',
  'membership-ended': 'You no longer have access to this board.',
  'board-deleted': 'This board has been deleted.',
}

/** Builds a failure from a reason, using our copy. */
export function boardFailure(reason: Exclude<BoardFailureReason, 'unknown'>): BoardFailure {
  return { reason, message: MESSAGES[reason] }
}

/** Convenience for the common `{ ok: false }` shape. */
export function boardFailed(reason: Exclude<BoardFailureReason, 'unknown'>): {
  ok: false
  failure: BoardFailure
} {
  return { ok: false, failure: boardFailure(reason) }
}

/**
 * The `unknown` escape, kept explicit so it reads as a decision at the call site.
 *
 * There is deliberately **no** `classifyBoardError` here yet. Mapping Postgres error codes and RPC
 * result shapes to these reasons belongs with the adapter that produces them; writing it now would
 * mean inventing the shape of RPC results that do not exist, and a wrong guess frozen into a
 * classifier is harder to notice than a missing one.
 */
export function boardFailureUnknown(message: string): BoardFailure {
  return { reason: 'unknown', message }
}
