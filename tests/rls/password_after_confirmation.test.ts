import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { afterAll, expect, test } from 'vitest'
import { serviceClient, stack, withPg } from './helpers'

/**
 * A password stored before an address was confirmed does not survive the confirmation
 * (`20261008160000_password_chosen_after_confirmation.sql`).
 *
 * These go through the real auth server rather than updating `auth.users` by hand, because the
 * thing under test is an interaction: which statements GoTrue issues when it confirms, and
 * whether the trigger sees them. `generateLink` is the one way to create a self-service sign-up
 * here without sending mail -- it stores the password, stamps `confirmation_sent_at`, and returns
 * the token the emailed link would have carried.
 */

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } }
const CAPTCHA = { captchaToken: 'XXXX.DUMMY.TOKEN.XXXX' }
const created: string[] = []

const anon = () => createClient(stack().apiUrl, stack().anonKey, NO_SESSION)
const newEmail = () => `rls-${randomUUID()}@example.test`
const newPassword = () => `Aa1!${randomUUID().replace(/-/g, '').slice(0, 16)}`

afterAll(async () => {
  for (const id of created) await serviceClient().auth.admin.deleteUser(id)
})

async function storedPassword(id: string): Promise<string | null> {
  return withPg(async (pg) => {
    const { rows } = await pg.query<{ encrypted_password: string | null }>(
      'select encrypted_password from auth.users where id = $1',
      [id],
    )
    return rows[0].encrypted_password
  })
}

/** A self-service sign-up that has not been confirmed, with the token its email would carry. */
async function pendingSignUp(email: string, password: string) {
  const { data, error } = await serviceClient().auth.admin.generateLink({
    type: 'signup',
    email,
    password,
  })
  if (error) throw new Error(`generateLink failed: ${error.message}`)
  created.push(data.user.id)
  return { id: data.user.id, tokenHash: data.properties.hashed_token }
}

test('a password set by whoever registered first stops working when the owner confirms', async () => {
  const email = newEmail()
  const strangersPassword = newPassword()
  const pending = await pendingSignUp(email, strangersPassword)

  // Before confirmation the password is stored. This is what makes the assertions below mean
  // something: the same column is empty afterwards.
  expect(await storedPassword(pending.id)).not.toBeNull()

  // The owner opens the emailed link.
  const owner = anon()
  const confirmed = await owner.auth.verifyOtp({ token_hash: pending.tokenHash, type: 'signup' })
  expect(confirmed.error).toBeNull()
  expect(confirmed.data.session).not.toBeNull()

  expect(await storedPassword(pending.id)).toBeNull()
  const stranger = await anon().auth.signInWithPassword({
    email,
    password: strangersPassword,
    options: CAPTCHA,
  })
  expect(stranger.error).not.toBeNull()
  expect(stranger.data.session).toBeNull()

  // The owner, signed in from the link, chooses a password, and that one works.
  const ownersPassword = newPassword()
  const set = await owner.auth.updateUser({ password: ownersPassword })
  expect(set.error).toBeNull()
  const signedIn = await anon().auth.signInWithPassword({
    email,
    password: ownersPassword,
    options: CAPTCHA,
  })
  expect(signedIn.error).toBeNull()
})

test('an account an operator creates as confirmed keeps its password', async () => {
  // `createUser({ email_confirm: true })` also confirms with an UPDATE, in the same request. Its
  // password was set by an operator, not an unverified stranger, and it never sends a
  // confirmation -- which is the clause that spares it. Every other RLS test depends on this.
  const email = newEmail()
  const password = newPassword()
  const { data, error } = await serviceClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  expect(error).toBeNull()
  created.push(data.user!.id)

  expect(await storedPassword(data.user!.id)).not.toBeNull()
  const signedIn = await anon().auth.signInWithPassword({ email, password, options: CAPTCHA })
  expect(signedIn.error).toBeNull()
})

test('a later update to a confirmed account leaves its password alone', async () => {
  const email = newEmail()
  const pending = await pendingSignUp(email, newPassword())
  const owner = anon()
  await owner.auth.verifyOtp({ token_hash: pending.tokenHash, type: 'signup' })
  const password = newPassword()
  await owner.auth.updateUser({ password })

  // Any other write to the row: the trigger is for the first confirmation only.
  const touched = await owner.auth.updateUser({ data: { note: 'unrelated' } })
  expect(touched.error).toBeNull()
  expect(await storedPassword(pending.id)).not.toBeNull()
})

test('the trigger function cannot be called through the Data API', async () => {
  const result = await serviceClient().rpc('discard_unverified_password' as never)
  expect(result.error).not.toBeNull()
})
