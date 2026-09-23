import { supabase } from '../lib/supabase'
import { boardFailed, boardFailureUnknown, type BoardOutcome } from './outcome'

/**
 * The calendar feed's client seam (#277): read and rotate the caller's own feed token for a Board.
 *
 * **The token is a capability.** Whoever holds the feed URL reads that Board, calendar clients
 * store it in plaintext, and rotation is the only revocation short of leaving the Board. That is why
 * this module is deliberately *not* part of `useBoardDirectory`: the directory is snapshotted to
 * `localStorage` for offline boot, and the token must never be written anywhere this app persists.
 * It is read on demand, held in component state while the panel is open, and dropped with it.
 *
 * Failures are values in the Board command vocabulary (`./outcome`), never throws, so a network
 * error while offline renders as a message rather than an unhandled rejection.
 */

const FEED_PATH = '/functions/v1/ical'

/** The `ical` Edge Function's URL for one token. The base defaults to the configured project. */
export function calendarFeedUrl(
  token: string,
  base: string = import.meta.env.VITE_SUPABASE_URL,
): string {
  return `${base.replace(/\/+$/, '')}${FEED_PATH}?token=${encodeURIComponent(token)}`
}

/**
 * The same URL on the `webcal:` scheme, which operating systems hand to the calendar app as a
 * **subscription**. The `https:` form, opened in a browser, downloads a one-off snapshot instead.
 */
export function subscribeUrl(feedUrl: string): string {
  return feedUrl.replace(/^https?:\/\//, 'webcal://')
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * The caller's token for this Board, from their own current Membership.
 *
 * RLS (`board_memberships_select_own`) is what limits this to the caller's row; the `ended_at`
 * filter is ours, because an ended Membership's token no longer resolves and showing it would hand
 * the user a URL that silently does not work.
 */
export async function readCalendarFeedToken(boardId: string): Promise<BoardOutcome<string>> {
  try {
    const { data, error } = await supabase
      .from('board_memberships')
      .select('ical_token')
      .eq('board_id', boardId)
      .is('ended_at', null)
      .maybeSingle()
    if (error) return { ok: false, failure: boardFailureUnknown(error.message) }
    if (!data) return boardFailed('membership-ended')
    return { ok: true, value: data.ical_token }
  } catch (cause) {
    return { ok: false, failure: boardFailureUnknown(message(cause)) }
  }
}

/**
 * Issue a fresh token for the caller's own Membership, which kills the old URL immediately.
 *
 * The server draws the value (`rotate_ical_token`), so a client cannot choose a weak one. A NULL
 * answer means the command found no current Membership of the caller's on this Board.
 */
export async function rotateCalendarFeedToken(boardId: string): Promise<BoardOutcome<string>> {
  try {
    const { data, error } = await supabase.rpc('rotate_ical_token', { p_board_id: boardId })
    if (error) return { ok: false, failure: boardFailureUnknown(error.message) }
    if (!data) return boardFailed('membership-ended')
    return { ok: true, value: data }
  } catch (cause) {
    return { ok: false, failure: boardFailureUnknown(message(cause)) }
  }
}
