import { createClient, type User } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from './cors.ts'

/** Extract the token from a `Bearer <jwt>` Authorization header value, or null. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : null
}

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * Resolve the calling user from the request's JWT, or return a 401 Response.
 * Verified in-function (defense in depth) even though the platform gateway also
 * checks the JWT when verify_jwt = true. The service-role key must only ever be
 * used AFTER this check succeeds.
 */
export async function requireUser(req: Request): Promise<User | Response> {
  const jwt = bearerToken(req.headers.get('Authorization'))
  if (!jwt) return unauthorized('Missing bearer token')
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  )
  const { data, error } = await supabase.auth.getUser(jwt)
  if (error || !data.user) return unauthorized('Invalid or expired token')
  return data.user
}
