import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The second local account, `E2E_INVITEE_EMAIL`, driven through the Data API as itself.
 *
 * Pre-confirmed by `scripts/e2e-local-setup.ts` because a UI sign-up cannot complete on this stack
 * (see `invitation.spec.ts`). Anon key plus its own password, never the service-role key — the same
 * rule as `testClient()`.
 */
export interface InviteeSession {
  client: SupabaseClient
  accountId: string
  email: string
  password: string
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is unset; scripts/e2e-local-setup.ts provides it.`)
  return value
}

export async function inviteeSession(): Promise<InviteeSession> {
  const email = required('E2E_INVITEE_EMAIL')
  const password = required('E2E_INVITEE_PASSWORD')
  const client = createClient(required('E2E_SUPABASE_URL'), required('E2E_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken: 'XXXX.DUMMY.TOKEN.XXXX' },
  })
  if (error) throw new Error(`E2E invitee sign-in failed: ${error.message}`)
  const accountId = data.user?.id
  if (!accountId) throw new Error('the invitee has no account id')
  return { client, accountId, email, password }
}

/** Sets the invitee's own Account name; `''` leaves it unnamed, which the join prompt checks. */
export async function nameInvitee(invitee: InviteeSession, displayName: string): Promise<void> {
  const { error } = await invitee.client
    .from('account_profiles')
    .update({ display_name: displayName })
    .eq('account_id', invitee.accountId)
  if (error) throw new Error(`could not name the invitee: ${error.message}`)
}

/**
 * Puts the invitee on the Owner's Board as a member, without any UI: the Owner (`testClient()`)
 * creates an invitation and the invitee accepts it, both through the same commands the app calls.
 * The caller passes its Owner client in rather than this signing in again, because sign-ins are
 * rate limited per IP (`fixtures/seedBoard.ts`).
 *
 * For specs that need a second member to exist rather than specs about joining — those drive the
 * invitation through the browser. Pair every call with `leaveAsInvitee`, or the other specs meet a
 * shared Board ("Assigned to me" and the Assignee picker appear only on one).
 */
export async function joinAsInvitee(
  owner: SupabaseClient,
  boardId: string,
  invitee: InviteeSession,
  role: 'editor' | 'viewer',
): Promise<void> {
  const created = await owner.rpc('create_invitation', {
    p_board_id: boardId,
    p_email: invitee.email,
    p_role: role,
  })
  if (created.error) throw new Error(`could not invite the invitee: ${created.error.message}`)
  // Untyped client (no Database generic): narrow rather than trust `any`.
  const token: unknown = created.data
  if (typeof token !== 'string') throw new Error('create_invitation returned no token')
  const accepted = await invitee.client.rpc('accept_invitation', { p_token: token })
  if (accepted.error) throw new Error(`the invitee could not join: ${accepted.error.message}`)
}

/** Ends the invitee's Membership of the main account's Board, if it has one. */
export async function leaveAsInvitee(invitee: InviteeSession, boardId: string): Promise<void> {
  // A refusal here means there was no Membership to end, which is the state this restores.
  await invitee.client.rpc('leave_board', { p_board_id: boardId })
}
