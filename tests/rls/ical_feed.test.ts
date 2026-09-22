import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  anonClient,
  boardTaskInsert,
  createTestUser,
  currentBoardId,
  deleteTestUser,
  serviceClient,
  withPg,
  type TestUser,
} from './helpers'

/**
 * The calendar feed's authorization, at the database boundary (#277).
 *
 * The token is a capability: whoever holds the URL reads that Board. So the properties that matter
 * are all refusals — an unknown token, an ended Membership, a rotated-away token, and every API
 * role other than the one the `ical` function holds — and each is asserted beside a success that
 * proves the fixture could have succeeded. Without that half, a command that returned NULL for
 * everything would pass every refusal here.
 */

interface FeedTask {
  id: string
  title: string
  description: string | null
  day: string
  at_time: string | null
}

interface Feed {
  board_name: string
  timezone: string | null
  tasks: FeedTask[]
}

let alice: TestUser
let bob: TestUser
let aliceBoardId: string

async function tokenOf(accountId: string, boardId: string): Promise<string> {
  return withPg(async (pg) => {
    const result = await pg.query<{ ical_token: string }>(
      `select ical_token from public.board_memberships
        where account_id = $1 and board_id = $2 and ended_at is null`,
      [accountId, boardId],
    )
    return result.rows[0].ical_token
  })
}

async function feed(token: string): Promise<Feed | null> {
  const { data, error } = await serviceClient().rpc('ical_feed', { p_token: token })
  if (error) throw new Error(`ical_feed failed: ${error.message}`)
  return data as Feed | null
}

beforeAll(async () => {
  alice = await createTestUser()
  bob = await createTestUser()
  aliceBoardId = await currentBoardId(alice.id)
})

afterAll(async () => {
  for (const user of [alice, bob]) {
    if (user) await deleteTestUser(user)
  }
})

test('every Membership carries its own token', async () => {
  const bobBoardId = await currentBoardId(bob.id)
  const aliceToken = await tokenOf(alice.id, aliceBoardId)
  const bobToken = await tokenOf(bob.id, bobBoardId)
  expect(aliceToken).toMatch(/^[0-9a-f-]{36}$/)
  expect(bobToken).toMatch(/^[0-9a-f-]{36}$/)
  expect(aliceToken).not.toBe(bobToken)
})

test('the feed carries scheduled, unarchived Tasks — and nothing hidden or unscheduled', async () => {
  const settings = await alice.client
    .from('user_settings')
    .update({ timezone: 'America/New_York' })
    .eq('user_id', alice.id)
  expect(settings.error).toBeNull()

  const insert = async (values: Parameters<typeof boardTaskInsert>[1]) => {
    const { data, error } = await alice.client
      .from('tasks')
      .insert(boardTaskInsert(aliceBoardId, values))
      .select('id')
      .single()
    if (error) throw new Error(`fixture insert failed: ${error.message}`)
    return data.id
  }

  const untimed = await insert({ title: 'untimed', day: '2026-10-01', description: 'notes' })
  const timed = await insert({ title: 'timed', day: '2026-10-01', at_time: '14:30' })
  const completed = await insert({ title: 'completed', day: '2026-10-02' })
  const archived = await insert({ title: 'archived', day: '2026-10-03' })
  const inbox = await insert({ title: 'inbox' })
  const definition = await insert({ title: 'series', day: '2026-10-04', recur_freq: 'daily' })
  const occurrence = await insert({
    title: 'series',
    day: '2026-10-04',
    recur_parent_id: definition,
    recur_origin_day: '2026-10-04',
  })

  // Status and archive go through the lifecycle trigger, as the app's own writes do.
  expect(
    (await alice.client.from('tasks').update({ status: 'done' }).eq('id', completed)).error,
  ).toBeNull()
  expect(
    (await alice.client.from('tasks').update({ status: 'done' }).eq('id', archived)).error,
  ).toBeNull()
  expect(
    (
      await alice.client
        .from('tasks')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', archived)
    ).error,
  ).toBeNull()

  const result = await feed(await tokenOf(alice.id, aliceBoardId))
  expect(result).not.toBeNull()
  expect(result!.timezone).toBe('America/New_York')
  expect(typeof result!.board_name).toBe('string')

  const ids = result!.tasks.map((t) => t.id)
  expect(ids).toEqual(expect.arrayContaining([untimed, timed, completed, occurrence]))
  expect(ids).not.toContain(archived)
  expect(ids).not.toContain(inbox)
  expect(ids).not.toContain(definition)
  expect(ids).toHaveLength(4)

  // Exactly the serializer's fields, in the shapes it expects — and nothing that identifies the
  // account behind the token.
  expect(result!.tasks.find((t) => t.id === untimed)).toEqual({
    id: untimed,
    title: 'untimed',
    description: 'notes',
    day: '2026-10-01',
    at_time: null,
  })
  expect(result!.tasks.find((t) => t.id === timed)?.at_time).toBe('14:30')
  expect(Object.keys(result!).sort()).toEqual(['board_name', 'tasks', 'timezone'])

  await alice.client.from('tasks').delete().eq('board_id', aliceBoardId)
})

test('an unknown token reads nothing', async () => {
  // The success half first: the same call with a real token is not NULL.
  expect(await feed(await tokenOf(alice.id, aliceBoardId))).not.toBeNull()
  expect(await feed('00000000-0000-4000-8000-000000000000')).toBeNull()
})

test('ending a Membership revokes its feed, with no rotation needed', async () => {
  // This is why the token lives on the Membership rather than on the Board.
  await withPg((pg) =>
    pg.query(
      `insert into public.board_memberships (board_id, account_id, role)
       values ($1, $2, 'viewer')`,
      [aliceBoardId, bob.id],
    ),
  )
  try {
    const bobToken = await tokenOf(bob.id, aliceBoardId)
    const whileMember = await feed(bobToken)
    expect(whileMember).not.toBeNull() // sanity: a current Viewer reads the Board's feed

    await withPg((pg) =>
      pg.query(
        `update public.board_memberships set ended_at = now(), end_reason = 'removed'
          where board_id = $1 and account_id = $2 and ended_at is null`,
        [aliceBoardId, bob.id],
      ),
    )
    expect(await feed(bobToken)).toBeNull()

    // And alice's own feed of the same Board is untouched: revoking one member is not revoking all.
    expect(await feed(await tokenOf(alice.id, aliceBoardId))).not.toBeNull()
  } finally {
    await withPg((pg) =>
      pg.query(`delete from public.board_memberships where board_id = $1 and account_id = $2`, [
        aliceBoardId,
        bob.id,
      ]),
    )
  }
})

test('rotating a token revokes the old URL and issues a working new one', async () => {
  const before = await tokenOf(alice.id, aliceBoardId)

  const { data: rotated, error } = await alice.client.rpc('rotate_ical_token', {
    p_board_id: aliceBoardId,
  })
  expect(error).toBeNull()
  expect(rotated).toMatch(/^[0-9a-f-]{36}$/)
  expect(rotated).not.toBe(before)
  expect(await tokenOf(alice.id, aliceBoardId)).toBe(rotated)

  expect(await feed(before)).toBeNull()
  expect(await feed(rotated as string)).not.toBeNull()
})

test("nobody can rotate another account's token", async () => {
  const before = await tokenOf(alice.id, aliceBoardId)

  // bob is not a member of alice's Board: the command finds no row of his to rotate.
  const { data, error } = await bob.client.rpc('rotate_ical_token', { p_board_id: aliceBoardId })
  expect(error).toBeNull()
  expect(data).toBeNull()
  expect(await tokenOf(alice.id, aliceBoardId)).toBe(before)

  const anon = await anonClient().rpc('rotate_ical_token', { p_board_id: aliceBoardId })
  expect(anon.error?.code).toBe('42501')
  expect(await tokenOf(alice.id, aliceBoardId)).toBe(before)
})

test('only service_role can read a feed', async () => {
  // The token alone must not be a Data API credential: the `ical` function is the one reader, so
  // caching headers and the capability statement in its docstring stay the whole story.
  const token = await tokenOf(alice.id, aliceBoardId)

  const asAnon = await anonClient().rpc('ical_feed', { p_token: token })
  expect(asAnon.error?.code).toBe('42501')

  const asMember = await alice.client.rpc('ical_feed', { p_token: token })
  expect(asMember.error?.code).toBe('42501')

  expect(await feed(token)).not.toBeNull()
})

test('a token is readable by its own account and by no other', async () => {
  // `ical_token` rides on the table-level SELECT grant, so its secrecy between accounts rests
  // entirely on `board_memberships_select_own`. The next test is the tripwire for that policy.
  const own = await alice.client.from('board_memberships').select('account_id, ical_token')
  expect(own.error).toBeNull()
  expect(own.data).toEqual([
    { account_id: alice.id, ical_token: await tokenOf(alice.id, aliceBoardId) },
  ])

  const theirs = await bob.client
    .from('board_memberships')
    .select('ical_token')
    .eq('board_id', aliceBoardId)
  expect(theirs.error).toBeNull()
  expect(theirs.data).toEqual([])
})

test('board_memberships is readable only through its own-rows policy', async () => {
  // A tripwire for #279. Shared Boards will want members to see each other's Memberships, and the
  // obvious co-member SELECT clause would hand every member every other member's `ical_token` —
  // a working read capability for a Board they may later be removed from, since the token does
  // not die with *their* Membership. If this fails because such a clause was added, withhold the
  // column first (column-scoped SELECT, or move the token behind a command), then update this.
  const policies = await withPg(async (pg) => {
    const result = await pg.query<{ policyname: string; qual: string }>(
      `select policyname, qual from pg_catalog.pg_policies
        where schemaname = 'public' and tablename = 'board_memberships' and cmd in ('SELECT', 'ALL')
        order by policyname`,
    )
    return result.rows
  })
  expect(policies).toEqual([
    {
      policyname: 'board_memberships_select_own',
      qual: '(account_id = ( SELECT auth.uid() AS uid))',
    },
  ])
})
