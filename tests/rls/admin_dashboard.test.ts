import { createHmac, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  anonClient,
  boardTaskInsert,
  createTestUser,
  currentBoardId,
  deleteTestUser,
  withPg,
  type TestUser,
} from './helpers'

// The admin dashboard's privacy stance (#274) is enforced here, not in the route: aggregate
// counts only, reachable only by a live admin role on an `aal2` session whose verified factor
// predates the session.

let admin: TestUser
let member: TestUser
let passwordOnlyAdmin: TestUser
/** The admin's original session, raised to `aal2` by enrolling a factor from inside it. */
let midSessionAdmin: TestUser['client']

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) — what an authenticator app computes from the secret. */
function totp(base32Secret: string, now = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of base32Secret.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0')
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)))
  const mac = createHmac('sha1', key).update(counter).digest()
  const offset = mac[mac.length - 1] & 0x0f
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0')
}

async function expectAal2(client: TestUser['client']) {
  const level = await client.auth.mfa.getAuthenticatorAssuranceLevel()
  expect(level.data?.currentLevel).toBe('aal2')
}

/**
 * Enrols and verifies a TOTP factor from the user's existing password-only session. Verifying
 * raises THAT session to `aal2`, which is exactly what a stolen session could do for itself.
 */
async function enrolFactor(user: TestUser): Promise<{ factorId: string; secret: string }> {
  const enrolled = await user.client.auth.mfa.enroll({ factorType: 'totp' })
  if (enrolled.error) throw new Error(`enroll failed: ${enrolled.error.message}`)
  const { id, totp: factor } = enrolled.data as { id: string; totp: { secret: string } }
  const verified = await user.client.auth.mfa.challengeAndVerify({
    factorId: id,
    code: totp(factor.secret),
  })
  if (verified.error) throw new Error(`verify failed: ${verified.error.message}`)
  await expectAal2(user.client)
  return { factorId: id, secret: factor.secret }
}

/** A fresh sign-in (password, then code): a new session that began after the factor existed. */
async function signInWithFactor(
  user: TestUser,
  factor: { factorId: string; secret: string },
): Promise<TestUser['client']> {
  const client = anonClient()
  const signedIn = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
    options: { captchaToken: 'XXXX.DUMMY.TOKEN.XXXX' },
  })
  if (signedIn.error) throw new Error(`sign-in failed: ${signedIn.error.message}`)
  // The next time step, so GoTrue cannot refuse the code as a replay of the enrolment's.
  const verified = await client.auth.mfa.challengeAndVerify({
    factorId: factor.factorId,
    code: totp(factor.secret, Date.now() + 30_000),
  })
  if (verified.error) throw new Error(`step-up failed: ${verified.error.message}`)
  await expectAal2(client)
  return client
}

async function expectRefused(result: PromiseLike<{ data: unknown; error: unknown }>) {
  const { data, error } = await result
  expect(data).toBeNull()
  expect(error).toMatchObject({ code: '42501' })
}

async function grantAdmin(user: TestUser) {
  await withPg((pg) =>
    pg.query("insert into public.user_roles(user_id, role) values ($1, 'admin')", [user.id]),
  )
}

interface AdminUserRow {
  id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
  has_mfa: boolean
  is_admin: boolean
  owned_boards: number
  owned_tasks: number
  total_count: number
}

async function findAdminUserRow(client: TestUser['client'], id: string): Promise<AdminUserRow> {
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await client.rpc('admin_users', {
      page_limit: 100,
      page_offset: offset,
    })
    expect(error).toBeNull()
    const rows = (data ?? []) as AdminUserRow[]
    const row = rows.find((candidate) => candidate.id === id)
    if (row) return row
    if (rows.length < 100) throw new Error(`account ${id} not listed`)
  }
}

beforeAll(async () => {
  admin = await createTestUser()
  member = await createTestUser()
  passwordOnlyAdmin = await createTestUser()
  await grantAdmin(admin)
  await grantAdmin(passwordOnlyAdmin)
  const adminFactor = await enrolFactor(admin)
  midSessionAdmin = admin.client
  admin = { ...admin, client: await signInWithFactor(admin, adminFactor) }
  member = { ...member, client: await signInWithFactor(member, await enrolFactor(member)) }
})
afterAll(async () => {
  await midSessionAdmin.auth.signOut()
  await deleteTestUser(admin)
  await deleteTestUser(member)
  await deleteTestUser(passwordOnlyAdmin)
})

test('visitors, members, password-only admins, and self-minted factors are all refused', async () => {
  const refused = [
    anonClient(),
    member.client, // aal2, but no role
    passwordOnlyAdmin.client, // role, but no factor
    midSessionAdmin, // role and aal2, but the factor was enrolled from inside this session
  ]
  await expectAal2(midSessionAdmin)
  for (const client of refused) {
    await expectRefused(client.rpc('admin_stats'))
    await expectRefused(client.rpc('admin_users', { page_limit: 10, page_offset: 0 }))
  }
  expect((await admin.client.rpc('admin_stats')).error).toBeNull()
})

test('JWT user metadata cannot stand in for the role', async () => {
  const updated = await member.client.auth.updateUser({ data: { role: 'admin', is_admin: true } })
  expect(updated.error).toBeNull()
  // updateUser keeps the old access token; only a refresh puts the metadata into the JWT.
  const refreshed = await member.client.auth.refreshSession()
  expect(refreshed.error).toBeNull()
  const token = refreshed.data.session!.access_token
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as {
    aal: string
    user_metadata: Record<string, unknown>
  }
  expect(claims).toMatchObject({ aal: 'aal2', user_metadata: { role: 'admin', is_admin: true } })
  await expectRefused(member.client.rpc('admin_stats'))
})

test('stats are aggregate counts with a 30-day series, and track new Tasks exactly', async () => {
  const before = await admin.client.rpc('admin_stats')
  expect(before.error).toBeNull()
  const stats = before.data as Record<string, unknown>
  expect(Object.keys(stats).sort()).toEqual([
    'accounts',
    'accounts_with_mfa',
    'active_accounts_30d',
    'boards',
    'completed_tasks',
    'daily',
    'series',
    'tasks',
  ])
  expect(stats.accounts).toBeGreaterThanOrEqual(3)
  expect(stats.accounts_with_mfa).toBeGreaterThanOrEqual(2)
  const daily = stats.daily as { day: string; new_accounts: number; new_tasks: number }[]
  expect(daily).toHaveLength(30)
  expect(Object.keys(daily[0]).sort()).toEqual(['day', 'new_accounts', 'new_tasks'])
  expect(daily[29].day).toBe(new Date().toISOString().slice(0, 10))
  expect(daily[29].new_accounts).toBeGreaterThanOrEqual(3)

  const boardId = await currentBoardId(member.id)
  // One row per insert: PostgREST sends explicit NULLs for keys only some batch rows name.
  for (const values of [
    { title: 'counted' },
    { title: 'counted too', status: 'done' },
    { title: 'a Series definition', recur_freq: 'weekly', day: '2026-09-16' },
  ]) {
    const inserted = await member.client
      .from('tasks')
      .insert(boardTaskInsert(boardId, { id: randomUUID(), ...values }))
    expect(inserted.error).toBeNull()
  }

  const after = (await admin.client.rpc('admin_stats')).data as Record<string, unknown>
  expect(after.tasks).toBe((stats.tasks as number) + 2)
  expect(after.completed_tasks).toBe((stats.completed_tasks as number) + 1)
  expect(after.series).toBe((stats.series as number) + 1)
  expect((after.daily as typeof daily)[29].new_tasks).toBe(daily[29].new_tasks + 2)
})

test('the user list exposes identity, dates, and counts — never Task content', async () => {
  const boardId = await currentBoardId(member.id)
  const definition = randomUUID()
  for (const values of [
    { id: randomUUID(), title: 'private title' },
    { id: definition, title: 'series definition', recur_freq: 'weekly', day: '2026-09-16' },
  ]) {
    const inserted = await member.client.from('tasks').insert(boardTaskInsert(boardId, values))
    expect(inserted.error).toBeNull()
  }
  const taskCount = await withPg(
    async (pg) =>
      (
        await pg.query<{ n: number }>(
          `select count(*)::int as n from public.tasks
            where board_id = $1 and not (recur_freq <> 'none' and recur_parent_id is null)`,
          [boardId],
        )
      ).rows[0].n,
  )

  const row = await findAdminUserRow(admin.client, member.id)
  expect(Object.keys(row).sort()).toEqual([
    'created_at',
    'email',
    'has_mfa',
    'id',
    'is_admin',
    'last_sign_in_at',
    'owned_boards',
    'owned_tasks',
    'total_count',
  ])
  expect(row).toMatchObject({
    email: member.email,
    has_mfa: true,
    is_admin: false,
    owned_boards: 1,
    owned_tasks: taskCount,
  })
  expect(JSON.stringify(row)).not.toContain('private title')
  expect((await findAdminUserRow(admin.client, admin.id)).is_admin).toBe(true)
  expect((await findAdminUserRow(admin.client, passwordOnlyAdmin.id)).has_mfa).toBe(false)
})

test('paging is bounded and ordered newest first', async () => {
  for (const [page_limit, page_offset] of [
    [0, 0],
    [101, 0],
    [10, -1],
  ]) {
    expect(
      (await admin.client.rpc('admin_users', { page_limit, page_offset })).error,
    ).not.toBeNull()
  }
  const { data, error } = await admin.client.rpc('admin_users', { page_limit: 2, page_offset: 0 })
  expect(error).toBeNull()
  const rows = data as AdminUserRow[]
  expect(rows).toHaveLength(2)
  expect(rows[0].total_count).toBeGreaterThanOrEqual(3)
  expect(rows[0].created_at >= rows[1].created_at).toBe(true)
})

test('revoking the role applies to the same aal2 session immediately', async () => {
  try {
    await withPg((pg) => pg.query('delete from public.user_roles where user_id = $1', [admin.id]))
    await expectRefused(admin.client.rpc('admin_stats'))
  } finally {
    await grantAdmin(admin)
  }
  expect((await admin.client.rpc('admin_stats')).error).toBeNull()
})
