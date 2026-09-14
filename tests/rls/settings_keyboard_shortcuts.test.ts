import { beforeAll, afterAll, expect, test } from 'vitest'
import { createTestUser, deleteTestUser, type TestUser } from './helpers'

/**
 * The `keyboard_shortcuts` Account Preference, added a release ahead of the client that reads it
 * (#269).
 *
 * The deployed-client test is the load-bearing one, and it is why this file exists a release early.
 * `useSettings` upserts every settings field it knows on each save, and the currently-deployed client
 * knows `theme`, `week_start`, and `timezone` only. Every one of those writes must keep succeeding
 * across the merge that adds the column, and must not quietly switch shortcuts off for an account
 * that turned them on -- or production settings saves break for the whole window before the client
 * deploys, with nothing in this repository changed in between.
 */
let alice: TestUser
let bob: TestUser
beforeAll(async () => {
  alice = await createTestUser()
  bob = await createTestUser()
})
afterAll(async () => {
  if (alice) await deleteTestUser(alice)
  if (bob) await deleteTestUser(bob)
})

async function readOwn(user: TestUser) {
  const { data, error } = await user.client
    .from('user_settings')
    .select('keyboard_shortcuts')
    .eq('user_id', user.id)
    .single()
  expect(error).toBeNull()
  return data!.keyboard_shortcuts
}

test('a new account starts with shortcuts on', async () => {
  // The signup trigger inserts `(user_id)` only, so this is the column default doing the work.
  expect(await readOwn(alice)).toBe(true)
})

test("the deployed client's upsert still succeeds and leaves the preference alone", async () => {
  // Exactly the payload `useSettings.persist` sends today, which names none of the new column.
  const payload = { user_id: alice.id, theme: 'brutal', week_start: 1, timezone: 'Europe/London' }

  const onFirst = await alice.client
    .from('user_settings')
    .upsert(payload, { onConflict: 'user_id' })
  expect(onFirst.error).toBeNull()
  expect(await readOwn(alice)).toBe(true)

  // And once the preference is off, the same old-shape upsert must not turn it back on: an update
  // leaves an unnamed column as stored rather than resetting it to the default.
  const off = await alice.client
    .from('user_settings')
    .update({ keyboard_shortcuts: false })
    .eq('user_id', alice.id)
  expect(off.error).toBeNull()
  const again = await alice.client
    .from('user_settings')
    .upsert({ ...payload, theme: 'glass' }, { onConflict: 'user_id' })
  expect(again.error).toBeNull()
  expect(await readOwn(alice)).toBe(false)

  const restore = await alice.client
    .from('user_settings')
    .update({ keyboard_shortcuts: true })
    .eq('user_id', alice.id)
  expect(restore.error).toBeNull()
})

test('an account can turn its shortcuts off and back on', async () => {
  const off = await bob.client
    .from('user_settings')
    .update({ keyboard_shortcuts: false })
    .eq('user_id', bob.id)
  expect(off.error).toBeNull()
  expect(await readOwn(bob)).toBe(false)

  const on = await bob.client
    .from('user_settings')
    .update({ keyboard_shortcuts: true })
    .eq('user_id', bob.id)
  expect(on.error).toBeNull()
  expect(await readOwn(bob)).toBe(true)
})

test('the preference cannot be set to null', async () => {
  const denied = await bob.client
    .from('user_settings')
    .update({ keyboard_shortcuts: null as unknown as boolean })
    .eq('user_id', bob.id)
  expect(denied.error?.code).toBe('23502')
  // Positive control: the row is still readable and unchanged, so the refusal above is the NOT NULL
  // constraint and not a policy or grant that denies every write.
  expect(await readOwn(bob)).toBe(true)
})

test("an account cannot change another account's preference", async () => {
  const attempt = await bob.client
    .from('user_settings')
    .update({ keyboard_shortcuts: false })
    .eq('user_id', alice.id)
    .select('user_id')
  // RLS narrows an UPDATE to rows the caller owns, so this matches nothing rather than erroring.
  expect(attempt.error).toBeNull()
  expect(attempt.data).toEqual([])
  expect(await readOwn(alice)).toBe(true)

  // Positive control: the same statement against bob's own row does change it, so the empty result
  // above is RLS scoping and not an update that could never have matched.
  const own = await bob.client
    .from('user_settings')
    .update({ keyboard_shortcuts: false })
    .eq('user_id', bob.id)
    .select('user_id')
  expect(own.error).toBeNull()
  expect(own.data).toEqual([{ user_id: bob.id }])
  expect(await readOwn(bob)).toBe(false)
})
