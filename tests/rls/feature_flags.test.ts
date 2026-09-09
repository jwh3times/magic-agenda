import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  anonClient,
  currentBoardId,
  createTestUser,
  deleteTestUser,
  serviceClient,
  withPg,
  type TestUser,
} from './helpers'

let admin: TestUser
let member: TestUser
const key = `test-${randomUUID()}`

beforeAll(async () => {
  admin = await createTestUser()
  member = await createTestUser()
  await withPg(async (pg) => {
    await pg.query("insert into public.user_roles(user_id, role) values ($1, 'admin')", [admin.id])
    await pg.query('insert into public.feature_flags(key) values ($1)', [key])
  })
})
afterAll(async () => {
  await withPg(async (pg) => {
    await pg.query('delete from public.feature_flags where key = $1', [key])
  })
  await deleteTestUser(admin)
  await deleteTestUser(member)
})

test('roles are self-readable only, with no self-serve assignment even for admins', async () => {
  expect((await admin.client.from('user_roles').select('*')).data).toEqual([
    { user_id: admin.id, role: 'admin' },
  ])
  expect((await member.client.from('user_roles').select('*')).data).toEqual([])
  expect((await anonClient().from('user_roles').select('*')).data).toEqual([])
  for (const client of [member.client, admin.client, serviceClient()]) {
    expect(
      (await client.from('user_roles').upsert({ user_id: member.id, role: 'admin' })).error,
    ).not.toBeNull()
    expect(
      (await client.from('user_roles').update({ role: 'admin' }).eq('user_id', member.id)).error,
    ).not.toBeNull()
    expect((await client.from('user_roles').delete().eq('user_id', admin.id)).error).not.toBeNull()
  }
})

test('flags are readable by authenticated users, but not anonymous visitors', async () => {
  const read = await member.client.from('feature_flags').select('*').eq('key', key)
  expect(read.error).toBeNull()
  expect(read.data).toEqual([{ key, enabled: false, description: '' }])
  expect((await anonClient().from('feature_flags').select('*')).data).toEqual([])
})

test('non-admin writes fail closed; JWT user metadata cannot grant administration', async () => {
  await member.client.auth.updateUser({ data: { role: 'admin', is_admin: true } })
  expect(
    (await member.client.from('feature_flags').insert({ key: `${key}-forged` })).error,
  ).not.toBeNull()
  expect(
    (await member.client.from('feature_flags').update({ enabled: true }).eq('key', key).select())
      .data,
  ).toEqual([])
  expect((await member.client.from('feature_flags').delete().eq('key', key).select()).data).toEqual(
    [],
  )
  expect(
    (await admin.client.from('feature_flags').select('enabled').eq('key', key).single()).data
      ?.enabled,
  ).toBe(false)
})

test('admin can manage flags; revocation applies to the same signed-in client immediately', async () => {
  const extra = `${key}-admin`
  try {
    expect((await admin.client.from('feature_flags').insert({ key: extra })).error).toBeNull()
    const updated = await admin.client
      .from('feature_flags')
      .update({ enabled: true, description: 'rollout' })
      .eq('key', extra)
      .select()
      .single()
    expect(updated.error).toBeNull()
    expect(updated.data?.enabled).toBe(true)
    expect(
      (await admin.client.from('feature_flags').delete().eq('key', extra).select()).data,
    ).toHaveLength(1)
    await withPg(async (pg) => {
      await pg.query('delete from public.user_roles where user_id = $1', [admin.id])
    })
    expect((await admin.client.from('feature_flags').insert({ key: extra })).error).not.toBeNull()
    expect(
      (await admin.client.from('feature_flags').update({ enabled: true }).eq('key', key).select())
        .data,
    ).toEqual([])
    expect(
      (await admin.client.from('feature_flags').delete().eq('key', key).select()).data,
    ).toEqual([])
  } finally {
    await withPg(async (pg) => {
      await pg.query('delete from public.feature_flags where key = $1', [extra])
      await pg.query("insert into public.user_roles values ($1, 'admin') on conflict do nothing", [
        admin.id,
      ])
    })
  }
})

test('the policy helper cannot be reached as a Data API RPC', async () => {
  const { apiUrl, anonKey } = (await import('./helpers')).stack()
  const session = await admin.client.auth.getSession()
  const result = await fetch(`${apiUrl}/rest/v1/rpc/is_admin`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${session.data.session!.access_token}`,
      'Content-Profile': 'app_private',
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  expect(result.status).toBe(406)
  expect(await result.json()).toMatchObject({ code: 'PGRST106' })
})

test('account deletion removes its role', async () => {
  const departing = await createTestUser()
  await withPg(async (pg) => {
    await pg.query("insert into public.user_roles values ($1, 'admin')", [departing.id])
  })
  await deleteTestUser(departing)
  const rows = await withPg(
    async (pg) =>
      (
        await pg.query<{ user_id: string }>(
          'select user_id from public.user_roles where user_id = $1',
          [departing.id],
        )
      ).rows,
  )
  expect(rows).toEqual([])
})

test('administration grants no access to another account’s Board', async () => {
  const boardId = await currentBoardId(member.id)
  const result = await admin.client.from('boards').select('id').eq('id', boardId)
  expect(result.error).toBeNull()
  expect(result.data).toEqual([])
})

test('flag keys and service-role writes stay outside the API grant', async () => {
  expect(
    (
      await admin.client
        .from('feature_flags')
        .update({ key: `${key}-renamed` })
        .eq('key', key)
    ).error,
  ).not.toBeNull()
  expect(
    (
      await serviceClient()
        .from('feature_flags')
        .insert({ key: `${key}-service` })
    ).error,
  ).not.toBeNull()
})
