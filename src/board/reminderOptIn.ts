import { supabase } from '../lib/supabase'

/**
 * The caller's per-Board opt-in to reminders for **unassigned** Tasks (#441).
 *
 * On a Board more than one person is on, reminders go to a Task's Assignee; an unassigned Task
 * reminds only the members who opted in here. It is a Membership Preference, like Default View:
 * each member reads and writes only their own row (`board_memberships_select_own` / `_update_own`
 * plus the column grant), so this touches nothing another member can see.
 *
 * Read on demand rather than carried in the Board Directory, which is snapshotted for offline boot
 * and has no use for it.
 */
export async function readRemindUnassigned(membershipId: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase
      .from('board_memberships')
      .select('remind_unassigned')
      .eq('id', membershipId)
      .maybeSingle()
    if (error || !data) return null
    return data.remind_unassigned
  } catch {
    return null
  }
}

/** Resolves to an error message, or null on success. */
export async function writeRemindUnassigned(
  membershipId: string,
  value: boolean,
): Promise<string | null> {
  try {
    const { error } = await supabase
      .from('board_memberships')
      .update({ remind_unassigned: value })
      .eq('id', membershipId)
    return error ? error.message : null
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause)
  }
}
