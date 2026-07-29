import { afterAll, beforeAll, expect, test } from 'vitest'
import { createTestUser, deleteTestUser, type TestUser } from './helpers'

let user: TestUser

beforeAll(async () => {
  user = await createTestUser()
})

afterAll(async () => {
  // Guarded: if beforeAll threw, an unguarded delete throws a TypeError over the real error.
  if (user) await deleteTestUser(user)
})

// The canary. If this fails with 42501 "permission denied", the Data API grants are missing --
// see supabase/migrations/20260729100000_explicit_data_api_grants.sql. That failure would
// otherwise masquerade as a broken policy in every other test in this suite.
test('an authenticated user can insert and read back their own task', async () => {
  const { error: insertError } = await user.client
    .from('tasks')
    .insert({ user_id: user.id, title: 'canary' })
  expect(insertError).toBeNull()

  const { data, error } = await user.client.from('tasks').select('id, title')
  expect(error).toBeNull()
  expect(data).toHaveLength(1)
  expect(data?.[0].title).toBe('canary')
})

test('the signup trigger seeded exactly one settings row', async () => {
  // on_auth_user_created fires on auth.users insert. schema.sql alone cannot restore this
  // trigger (it lives on an auth-schema table), so a restore that loses it would leave every
  // new signup with no settings row -- this is the test that would catch that.
  const { data, error } = await user.client.from('user_settings').select('user_id')
  expect(error).toBeNull()
  expect(data).toHaveLength(1)
  expect(data?.[0].user_id).toBe(user.id)
})
