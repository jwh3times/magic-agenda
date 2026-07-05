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
 * caller's own id. Postgres `on delete cascade` (init.sql) removes the user's
 * tasks and settings rows.
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
  if (error) return json({ error: 'Deletion failed' }, 500)
  return json({ ok: true })
}
