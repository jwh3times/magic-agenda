import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Client as PgClient } from 'pg'
import type { Database } from '../../src/types/database.types'

type TestSupabaseClient = SupabaseClient<Database>
type TaskInsert = Database['public']['Tables']['tasks']['Insert']

/**
 * A pre-Board client payload, intentionally missing the now-required `board_id`.
 *
 * Generated types correctly model the current NOT NULL schema and therefore reject this shape.
 * Tests that exercise the temporary `tasks_infer_board_id` compatibility trigger cross that
 * version boundary explicitly through this adapter instead of weakening the checked-in DB types.
 */
export function legacyTaskInsert(
  values: Omit<TaskInsert, 'board_id' | 'label_id' | 'label_assignment_explicit'>,
): TaskInsert {
  return values as TaskInsert
}

export interface Stack {
  apiUrl: string
  dbUrl: string
  anonKey: string
  serviceKey: string
}

export function stack(): Stack {
  const { SUPABASE_API_URL, SUPABASE_DB_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } =
    process.env
  if (!SUPABASE_API_URL || !SUPABASE_DB_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Stack config missing -- globalSetup did not run.')
  }
  return {
    apiUrl: SUPABASE_API_URL,
    dbUrl: SUPABASE_DB_URL,
    anonKey: SUPABASE_ANON_KEY,
    serviceKey: SUPABASE_SERVICE_ROLE_KEY,
  }
}

// No session persistence anywhere: each client is explicit about who it is, and a leaked
// session between tests would make an isolation failure look like a pass.
const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } }

/** Bypasses RLS. Only for creating and destroying test users -- never for assertions. */
export function serviceClient(): TestSupabaseClient {
  const s = stack()
  return createClient<Database>(s.apiUrl, s.serviceKey, NO_SESSION)
}

/** A signed-out client, exactly what a visitor to the landing page holds. */
export function anonClient(): TestSupabaseClient {
  const s = stack()
  return createClient<Database>(s.apiUrl, s.anonKey, NO_SESSION)
}

export interface TestUser {
  id: string
  email: string
  client: TestSupabaseClient
}

/**
 * Creates a confirmed user and returns a client signed in as them.
 *
 * The email is randomised per call so a crashed previous run cannot collide on a stack that is
 * still up. The password satisfies config.toml's `lower_upper_letters_digits_symbols` policy at
 * 10+ characters.
 */
export async function createTestUser(): Promise<TestUser> {
  const s = stack()
  const email = `rls-${randomUUID()}@example.test`
  const password = `Aa1!${randomUUID().replace(/-/g, '').slice(0, 16)}`

  const admin = serviceClient()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw new Error(`createTestUser failed: ${error.message}`)
  const id = data.user?.id
  if (!id) throw new Error('createTestUser returned no user id')

  const client = createClient<Database>(s.apiUrl, s.anonKey, NO_SESSION)
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`test user sign-in failed: ${signInError.message}`)

  return { id, email, client }
}

export async function deleteTestUser(user: TestUser): Promise<void> {
  await user.client.auth.signOut()
  const admin = serviceClient()
  const { error } = await admin.auth.admin.deleteUser(user.id)
  if (error) throw new Error(`deleteTestUser failed: ${error.message}`)
}

/** Direct SQL. PostgREST exposes only `public` and `graphql_public`, so pg_catalog needs this. */
export async function withPg<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
  const client = new PgClient({ connectionString: stack().dbUrl })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}
