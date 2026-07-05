import { requireUser } from '../_shared/auth.ts'
import { corsHeaders } from '../_shared/cors.ts'

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const user = await requireUser(req)
  if (user instanceof Response) return user
  return new Response(JSON.stringify({ message: `Hello ${user.email ?? user.id}` }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
