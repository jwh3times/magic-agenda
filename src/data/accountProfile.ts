import { supabase } from '../lib/supabase'

/**
 * The caller's own Display Name (#475): the one name an Account shows to the members of every
 * Board shared with it — in the Members list, the Assignee picker, card initials, and Board
 * Activity Records, all of which read it through `board_members()`.
 *
 * `account_profiles` is own-rows only: an UPDATE policy scoped to `auth.uid()` plus a column grant
 * on `display_name` alone. Both are the boundary; the `account_id` filter below only names the row
 * the policy would allow anyway. Nothing here can read or write another Account's name.
 */

/** Mirrors the `char_length(display_name) <= 80` CHECK, which counts code points, not UTF-16 units. */
export const DISPLAY_NAME_MAX = 80

export type ProfileResult<T> = { ok: true; data: T } | { ok: false; message: string }

/** The name as it is stored: surrounding whitespace dropped. An empty name means "not set". */
export function normalizeDisplayName(raw: string): string {
  return raw.trim()
}

/** Why a (normalized) name cannot be saved, or null when it can. */
export function displayNameError(name: string): string | null {
  return Array.from(name).length > DISPLAY_NAME_MAX
    ? `Use at most ${DISPLAY_NAME_MAX} characters for your name.`
    : null
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export async function loadDisplayName(accountId: string): Promise<ProfileResult<string>> {
  try {
    const { data, error } = await supabase
      .from('account_profiles')
      .select('display_name')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) return { ok: false, message: error.message }
    // Every Account has a profile row from `handle_new_user`; a missing one reads as unset.
    const name = (data as { display_name?: unknown } | null)?.display_name
    return { ok: true, data: typeof name === 'string' ? name : '' }
  } catch (cause) {
    return { ok: false, message: message(cause) }
  }
}

/**
 * Saves the caller's name and returns it as stored. A write that matched no row is a failure, not
 * a success: PostgREST answers an UPDATE refused by RLS with zero rows and no error.
 */
export async function saveDisplayName(
  accountId: string,
  raw: string,
): Promise<ProfileResult<string>> {
  const name = normalizeDisplayName(raw)
  const invalid = displayNameError(name)
  if (invalid) return { ok: false, message: invalid }
  try {
    const { data, error } = await supabase
      .from('account_profiles')
      .update({ display_name: name })
      .eq('account_id', accountId)
      .select('display_name')
    if (error) return { ok: false, message: error.message }
    if (!data || data.length !== 1) {
      return { ok: false, message: 'Your name was not saved. Sign in again and retry.' }
    }
    return { ok: true, data: data[0].display_name }
  } catch (cause) {
    return { ok: false, message: message(cause) }
  }
}
