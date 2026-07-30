import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * A user-scoped client for the dedicated E2E account.
 *
 * Anon key plus the account's own credentials -- NEVER the service-role key. That key bypasses
 * RLS entirely, and putting it in CI would be a categorical downgrade of the boundary this whole
 * test effort exists to protect. Everything here is therefore subject to the same policies a real
 * browser is.
 */
function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is unset. E2E needs E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY, E2E_TEST_EMAIL and ` +
        'E2E_TEST_PASSWORD -- see the Prerequisites section of the plan.',
    )
  }
  return value
}

export async function testClient(): Promise<SupabaseClient> {
  const client = createClient(required('E2E_SUPABASE_URL'), required('E2E_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({
    email: required('E2E_TEST_EMAIL'),
    password: required('E2E_TEST_PASSWORD'),
  })
  if (error) throw new Error(`E2E test account sign-in failed: ${error.message}`)
  return client
}

export async function testUserId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) throw new Error(`could not read the test user: ${error?.message}`)
  return data.user.id
}
