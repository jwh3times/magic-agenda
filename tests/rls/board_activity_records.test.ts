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
 * Board Activity Records, starting with exports (#442).
 *
 * Every member may now export, and what keeps that auditable is the record each export writes:
 * immutable, Owner-visible, and stamped by the server with who did it — a client-supplied actor
 * would let anyone forge it.
 */

let owner: TestUser
let viewer: TestUser
let outsider: TestUser
let boardId: string

beforeAll(async () => {
  owner = await createTestUser()
  viewer = await createTestUser()
  outsider = await createTestUser()
  boardId = await currentBoardId(owner.id)
  await withPg((pg) =>
    pg.query(
      `insert into public.board_memberships (board_id, account_id, role) values ($1, $2, 'viewer')`,
      [boardId, viewer.id],
    ),
  )
  const { error } = await viewer.client
    .from('account_profiles')
    .update({ display_name: 'Vic Viewer' })
    .eq('account_id', viewer.id)
  if (error) throw new Error(error.message)
})

afterAll(async () => {
  await withPg((pg) =>
    pg.query(
      `update public.board_memberships set ended_at = now(), end_reason = 'removed'
        where account_id = $1 and ended_at is null`,
      [viewer.id],
    ),
  )
  for (const u of [viewer, outsider, owner]) if (u) await deleteTestUser(u)
})

const records = () =>
  withPg(async (pg) => {
    const { rows } = await pg.query<{
      kind: string
      actor_account_id: string | null
      actor_display_name: string
    }>(
      `select kind, actor_account_id, actor_display_name from public.board_activity_records
        where board_id = $1 order by created_at`,
      [boardId],
    )
    return rows
  })

test('any current member can record their export, stamped with who they are', async () => {
  const { error } = await viewer.client.rpc('record_board_export', { p_board_id: boardId })
  expect(error).toBeNull()
  expect(await records()).toEqual([
    { kind: 'board-exported', actor_account_id: viewer.id, actor_display_name: 'Vic Viewer' },
  ])
})

test('the record keeps the Display Name as it was when the export happened', async () => {
  await viewer.client
    .from('account_profiles')
    .update({ display_name: 'Renamed' })
    .eq('account_id', viewer.id)
  const [first] = await records()
  expect(first.actor_display_name).toBe('Vic Viewer')
})

test('a non-member cannot record an export for a Board they are not on', async () => {
  const before = (await records()).length
  const { error } = await outsider.client.rpc('record_board_export', { p_board_id: boardId })
  expect(error?.message).toBe('membership-ended')
  expect((await records()).length).toBe(before)
})

test('only the Board’s Owners can read its activity', async () => {
  const read = async (client: TestUser['client']) =>
    (await client.from('board_activity_records').select('kind').eq('board_id', boardId)).data
  expect((await read(owner.client))?.length).toBeGreaterThan(0)
  expect(await read(viewer.client)).toEqual([])
  expect(await read(outsider.client)).toEqual([])
  expect(await read(anonClient())).toEqual([])
})

test('records are immutable, and nobody forges one directly', async () => {
  const insert = await owner.client
    .from('board_activity_records')
    .insert({ board_id: boardId, kind: 'board-exported', actor_account_id: viewer.id })
  expect(insert.error?.code).toBe('42501')
  const update = await owner.client
    .from('board_activity_records')
    .update({ actor_display_name: 'forged' })
    .eq('board_id', boardId)
  expect(update.error?.code).toBe('42501')
  const del = await owner.client.from('board_activity_records').delete().eq('board_id', boardId)
  expect(del.error?.code).toBe('42501')
})

test('anon and service_role cannot call the command', async () => {
  for (const client of [anonClient(), serviceClient()]) {
    const { error } = await client.rpc('record_board_export', { p_board_id: boardId })
    expect(error?.code).toBe('42501')
  }
})
