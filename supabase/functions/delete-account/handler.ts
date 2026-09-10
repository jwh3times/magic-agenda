import { createClient } from 'jsr:@supabase/supabase-js@2'
import { requireUser } from '../_shared/auth.ts'
import { corsHeaders } from '../_shared/cors.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

/**
 * Deletes the CALLING user's auth account. The service-role client is created
 * only after the caller's JWT is verified, and only ever deletes the verified
 * caller's own id.
 *
 * The content goes with it, but not by a foreign key from `auth.users` any more:
 * `handle_account_deletion` (20260813210400_account_deletion.sql) runs before the
 * delete, ends the account's Memberships and drops its Private Boards, and
 * `tasks.board_id`'s own cascade takes the Tasks and Labels from there. The old
 * `tasks.user_id` cascade named in this docstring stopped being the mechanism at
 * the authorization cutover, and the column itself is gone.
 *
 * TODO(#279): that trigger raises `restrict_violation` when the account is the
 * sole Owner of a Board somebody else is still a member of. No such Board can
 * exist until sharing ships, so today it is unreachable -- but once it can
 * happen, it surfaces here as a generic `Deletion failed` 500 telling the user
 * nothing they could act on. Map it to its own message then.
 */
export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const user = await requireUser(req)
  if (user instanceof Response) return user

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )
  const { error } = await admin.auth.admin.deleteUser(user.id)
  if (error) {
    // Irreversible endpoint: keep a server-side trail (function logs) while the
    // client only ever sees the generic message.
    console.error('delete-account: deleteUser failed', error)
    return json({ error: 'Deletion failed' }, 500)
  }
  return json({ ok: true })
}
