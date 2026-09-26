import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  anonClient,
  createTestUser,
  currentBoardId,
  deleteTestUser,
  serviceClient,
  withPg,
  type TestUser,
} from './helpers'

/**
 * The co-member read path, at the database boundary (#435).
 *
 * `board_members(p_board_id)` is the only way a member learns who else is on a Board. The base
 * tables stay own-rows only — `board_memberships` carries each member's calendar-feed capability
 * (`ical_token`), and `tests/rls/ical_feed.test.ts` pins that policy as a tripwire — so the list is
 * served by a definer that can name exactly the columns it returns.
 *
 * What the domain model allows, and what each test pins:
 * - every **current** member sees every other current member's Display Name and role;
 * - only an **Owner** sees members' email addresses;
 * - ended Memberships are not in the list, and an ended or non-member caller sees nothing at all.
 */

interface MemberRow {
  membership_id: string
  account_id: string
  role: string
  display_name: string
  joined_at: string
  email: string | null
}

let owner: TestUser
let editor: TestUser
let viewer: TestUser
let former: TestUser
let outsider: TestUser
let boardId: string

async function members(user: TestUser, id = boardId): Promise<MemberRow[]> {
  const { data, error } = await user.client.rpc('board_members', { p_board_id: id })
  if (error) throw new Error(`board_members failed: ${error.message}`)
  return data
}

beforeAll(async () => {
  owner = await createTestUser()
  editor = await createTestUser()
  viewer = await createTestUser()
  former = await createTestUser()
  outsider = await createTestUser()
  boardId = await currentBoardId(owner.id)

  await withPg(async (pg) => {
    for (const [member, role] of [
      [editor, 'editor'],
      [viewer, 'viewer'],
    ] as const) {
      await pg.query(
        `insert into public.board_memberships (board_id, account_id, role) values ($1, $2, $3)`,
        [boardId, member.id, role],
      )
    }
    await pg.query(
      `insert into public.board_memberships (board_id, account_id, role, ended_at, end_reason)
       values ($1, $2, 'editor', now(), 'removed')`,
      [boardId, former.id],
    )
  })

  const { error } = await editor.client
    .from('account_profiles')
    .update({ display_name: 'Eddie Editor' })
    .eq('account_id', editor.id)
  if (error) throw new Error(`display name seed failed: ${error.message}`)
})

afterAll(async () => {
  // Members before the Owner: account deletion refuses to strand a sole Owner's co-members.
  for (const user of [editor, viewer, former, outsider, owner]) {
    if (user) await deleteTestUser(user)
  }
})

test('every current member sees the same current members, Owner first', async () => {
  for (const caller of [owner, editor, viewer]) {
    const rows = await members(caller)
    expect(rows.map((row) => [row.account_id, row.role])).toEqual([
      [owner.id, 'owner'],
      [editor.id, 'editor'],
      [viewer.id, 'viewer'],
    ])
  }
})

test('the ended Membership is not in anyone’s list', async () => {
  const rows = await members(owner)
  expect(rows.map((row) => row.account_id)).not.toContain(former.id)
})

test('Display Names are visible to co-members, which the own-rows profile policy never allowed', async () => {
  const rows = await members(viewer)
  expect(rows.find((row) => row.account_id === editor.id)?.display_name).toBe('Eddie Editor')

  // The contrast that makes the path necessary: the table itself still answers own rows only.
  const direct = await viewer.client
    .from('account_profiles')
    .select('display_name')
    .eq('account_id', editor.id)
  expect(direct.error).toBeNull()
  expect(direct.data).toEqual([])
})

test('only an Owner sees email addresses', async () => {
  const asOwner = await members(owner)
  expect(asOwner.map((row) => row.email)).toEqual([owner.email, editor.email, viewer.email])

  for (const caller of [editor, viewer]) {
    const rows = await members(caller)
    expect(rows.map((row) => row.email)).toEqual([null, null, null])
  }
})

test('the result never carries the calendar-feed token, or any column beyond the six', async () => {
  const [row] = await members(owner)
  expect(Object.keys(row).sort()).toEqual(
    ['account_id', 'display_name', 'email', 'joined_at', 'membership_id', 'role'].sort(),
  )
})

test('an ended member and a non-member see nothing, and cannot tell the two apart', async () => {
  expect(await members(former)).toEqual([])
  expect(await members(outsider)).toEqual([])
  // Positive control: the outsider's own Board does answer, so the empty lists above are refusals.
  const own = await members(outsider, await currentBoardId(outsider.id))
  expect(own.map((row) => row.account_id)).toEqual([outsider.id])
})

test('a Board that does not exist answers the same empty list', async () => {
  expect(await members(owner, '00000000-0000-4000-8000-000000000000')).toEqual([])
})

test('anon and service_role cannot call it', async () => {
  for (const client of [anonClient(), serviceClient()]) {
    const { data, error } = await client.rpc('board_members', { p_board_id: boardId })
    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  }
})

test('the base table is still own-rows only: no co-member clause was added', async () => {
  const { data, error } = await editor.client
    .from('board_memberships')
    .select('account_id')
    .eq('board_id', boardId)
  expect(error).toBeNull()
  expect(data).toEqual([{ account_id: editor.id }])
})
