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

/**
 * The Board this account's tasks belong to.
 *
 * Required since Board creation dropped `tasks_infer_board_id`: a task insert that omits
 * `board_id` no longer gets one filled in, it is refused by `tasks_insert_editor` — the seed
 * fixture is itself a pre-cutover client, and fails closed exactly like any other.
 *
 * Reads the Membership rather than `boards` directly, because that is the only thing RLS scopes to
 * this caller; `boards` is visible only *through* it. The account has exactly one Board, and the
 * ordering makes "the first one" stable if that ever stops being true.
 */
export async function testBoardId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client
    .from('board_memberships')
    .select('board_id')
    .is('ended_at', null)
    .order('joined_at', { ascending: true })
    .limit(1)
    .single()
  if (error || !data) throw new Error(`could not read the test board: ${error?.message}`)

  // This client carries no `Database` generic, so the row is `any`. Narrow rather than assert: if
  // the column is ever renamed, a checked failure here beats `undefined` reaching an insert and
  // surfacing as an RLS refusal three call sites away.
  const boardId: unknown = (data as Record<string, unknown>).board_id
  if (typeof boardId !== 'string') throw new Error('membership row carried no board_id')
  return boardId
}
