import { afterAll, expect, test } from 'vitest'
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
 * Membership administration, at the database boundary (#438).
 *
 * `change_member_role`, `remove_member`, and `leave_board` are the only ways a Membership changes
 * after it exists. The property that matters most is the invariant none of them may break — a Board
 * always keeps at least one current Owner — and it is asserted under concurrency, since two
 * sequential calls would pass against a command that forgot the Board row lock.
 */

type Role = 'owner' | 'editor' | 'viewer'

const everyone: TestUser[] = []

async function user(): Promise<TestUser> {
  const created = await createTestUser()
  everyone.push(created)
  return created
}

/** A Board owned by a fresh Account, with fresh members in the given roles. */
async function sharedBoard(...roles: Role[]) {
  const owner = await user()
  const boardId = await currentBoardId(owner.id)
  const members: TestUser[] = []
  for (const role of roles) {
    const member = await user()
    await withPg((pg) =>
      pg.query(
        `insert into public.board_memberships (board_id, account_id, role) values ($1, $2, $3)`,
        [boardId, member.id, role],
      ),
    )
    members.push(member)
  }
  return { owner, boardId, members }
}

async function membershipOf(accountId: string, boardId: string) {
  return withPg(async (pg) => {
    const { rows } = await pg.query<{
      id: string
      role: Role
      ended_at: string | null
      end_reason: string | null
    }>(
      `select id, role, ended_at, end_reason from public.board_memberships
        where account_id = $1 and board_id = $2 order by created_at desc limit 1`,
      [accountId, boardId],
    )
    return rows[0]
  })
}

async function currentOwners(boardId: string): Promise<number> {
  return withPg(async (pg) => {
    const { rows } = await pg.query<{ n: string }>(
      `select count(*) as n from public.board_memberships
        where board_id = $1 and ended_at is null and role = 'owner'`,
      [boardId],
    )
    return Number(rows[0].n)
  })
}

const changeRole = (as: TestUser, membershipId: string, role: string) =>
  as.client.rpc('change_member_role', { p_membership_id: membershipId, p_role: role })
const remove = (as: TestUser, membershipId: string) =>
  as.client.rpc('remove_member', { p_membership_id: membershipId })
const leave = (as: TestUser, boardId: string) =>
  as.client.rpc('leave_board', { p_board_id: boardId })

afterAll(async () => {
  // End every non-Owner Membership first, so no Owner is refused deletion for stranding co-members.
  await withPg((pg) =>
    pg.query(
      `update public.board_memberships set ended_at = now(), end_reason = 'removed'
        where account_id = any($1) and ended_at is null and role <> 'owner'`,
      [everyone.map((u) => u.id)],
    ),
  )
  for (const created of everyone) await deleteTestUser(created)
})

test('an Owner changes a member’s role', async () => {
  const { owner, boardId, members } = await sharedBoard('viewer')
  const [viewer] = members
  const target = await membershipOf(viewer.id, boardId)

  expect((await changeRole(owner, target.id, 'editor')).error).toBeNull()
  expect((await membershipOf(viewer.id, boardId)).role).toBe('editor')
  // Promoting to Owner is a role change like any other.
  expect((await changeRole(owner, target.id, 'owner')).error).toBeNull()
  expect(await currentOwners(boardId)).toBe(2)
})

test('Editors and Viewers can change nothing; a non-member learns nothing', async () => {
  const { owner, boardId, members } = await sharedBoard('editor', 'viewer')
  const [editor, viewer] = members
  const outsider = await user()
  const ownerRow = await membershipOf(owner.id, boardId)
  const viewerRow = await membershipOf(viewer.id, boardId)

  for (const caller of [editor, viewer]) {
    expect((await changeRole(caller, viewerRow.id, 'owner')).error?.message).toBe('not-owner')
    expect((await remove(caller, ownerRow.id)).error?.message).toBe('not-owner')
  }
  // Same answer as a Membership that does not exist: the outsider cannot probe ids.
  expect((await changeRole(outsider, viewerRow.id, 'editor')).error?.message).toBe(
    'membership-ended',
  )
  expect((await remove(outsider, viewerRow.id)).error?.message).toBe('membership-ended')
  expect((await remove(owner, '00000000-0000-4000-8000-000000000000')).error?.message).toBe(
    'membership-ended',
  )

  // Nothing changed.
  expect((await membershipOf(viewer.id, boardId)).role).toBe('viewer')
  expect((await membershipOf(owner.id, boardId)).ended_at).toBeNull()
})

test('an unknown role is refused before anything else', async () => {
  const { owner, boardId, members } = await sharedBoard('viewer')
  const target = await membershipOf(members[0].id, boardId)
  expect((await changeRole(owner, target.id, 'admin')).error?.message).toBe('invalid-role')
})

test('the last Owner cannot demote themselves, be removed, or leave', async () => {
  const { owner, boardId } = await sharedBoard('editor')
  const ownerRow = await membershipOf(owner.id, boardId)

  expect((await changeRole(owner, ownerRow.id, 'editor')).error?.message).toBe('last-owner')
  expect((await remove(owner, ownerRow.id)).error?.message).toBe('last-owner')
  expect((await leave(owner, boardId)).error?.message).toBe('last-owner')
  expect(await currentOwners(boardId)).toBe(1)
})

test('the sole member of a Private Board cannot leave it either', async () => {
  // Leaving would strand the Board unreachable by every policy; deleting it is the way out.
  const owner = await user()
  const boardId = await currentBoardId(owner.id)
  expect((await leave(owner, boardId)).error?.message).toBe('last-owner')
})

test('with a second Owner, an Owner may leave or remove themselves, recorded as leaving', async () => {
  const { owner, boardId, members } = await sharedBoard('owner', 'owner')
  const [second, third] = members

  expect((await leave(second, boardId)).error).toBeNull()
  expect(await membershipOf(second.id, boardId)).toMatchObject({ end_reason: 'left' })

  const ownRow = await membershipOf(third.id, boardId)
  expect((await remove(third, ownRow.id)).error).toBeNull()
  expect(await membershipOf(third.id, boardId)).toMatchObject({ end_reason: 'left' })

  expect(await currentOwners(boardId)).toBe(1)
  expect((await membershipOf(owner.id, boardId)).ended_at).toBeNull()
})

test('two Owners demoting each other at once cannot both succeed', async () => {
  const { owner, boardId, members } = await sharedBoard('owner')
  const [second] = members
  const ownerRow = await membershipOf(owner.id, boardId)
  const secondRow = await membershipOf(second.id, boardId)

  const results = await Promise.all([
    changeRole(owner, secondRow.id, 'editor'),
    changeRole(second, ownerRow.id, 'editor'),
  ])
  const refused = results.filter((r) => r.error)
  expect(refused).toHaveLength(1)
  // The loser is refused either as no longer an Owner or as the last one, depending on order.
  expect(['not-owner', 'last-owner']).toContain(refused[0].error?.message)
  expect(await currentOwners(boardId)).toBe(1)
})

test('two Owners leaving at once cannot both succeed', async () => {
  const { owner, boardId, members } = await sharedBoard('owner', 'editor')
  const [second] = members

  const results = await Promise.all([leave(owner, boardId), leave(second, boardId)])
  expect(results.filter((r) => r.error).map((r) => r.error?.message)).toEqual(['last-owner'])
  expect(await currentOwners(boardId)).toBe(1)
})

test('a removed member loses the Board, its Tasks, Labels, attachments, feed, and member list', async () => {
  const { owner, boardId, members } = await sharedBoard('editor')
  const [editor] = members

  const { data: task, error } = await owner.client
    .from('tasks')
    .insert(boardTaskInsert(boardId, { title: 'shared' }))
    .select('id')
    .single()
  expect(error).toBeNull()
  await withPg((pg) =>
    pg.query(
      `insert into public.task_attachments
         (board_id, task_id, filename, mime_type, size_bytes, uploaded_by)
       values ($1, $2, 'shared.png', 'image/png', 1024, $3)`,
      [boardId, task!.id, owner.id],
    ),
  )
  const token = await withPg(async (pg) => {
    const { rows } = await pg.query<{ ical_token: string }>(
      `select ical_token from public.board_memberships
        where board_id = $1 and account_id = $2 and ended_at is null`,
      [boardId, editor.id],
    )
    return rows[0].ical_token
  })

  const reads = async () => ({
    board: (await editor.client.from('boards').select('id').eq('id', boardId)).data?.length,
    tasks: (await editor.client.from('tasks').select('id').eq('board_id', boardId)).data?.length,
    labels: (await editor.client.from('labels').select('id').eq('board_id', boardId)).data?.length,
    attachments: (await editor.client.from('task_attachments').select('id').eq('board_id', boardId))
      .data?.length,
    feed: (await serviceClient().rpc('ical_feed', { p_token: token })).data !== null,
    members: (
      (await editor.client.rpc('board_members', { p_board_id: boardId })).data as unknown[] | null
    )?.length,
  })

  // Positive control: every read works while the Membership is current.
  const before = await reads()
  expect(before).toMatchObject({ board: 1, tasks: 1, attachments: 1, feed: true, members: 2 })
  expect(before.labels).toBeGreaterThan(0)

  const editorRow = await membershipOf(editor.id, boardId)
  expect((await remove(owner, editorRow.id)).error).toBeNull()
  expect(await membershipOf(editor.id, boardId)).toMatchObject({ end_reason: 'removed' })

  expect(await reads()).toEqual({
    board: 0,
    tasks: 0,
    labels: 0,
    attachments: 0,
    feed: false,
    members: 0,
  })
  // Removing an already-ended Membership is refused as such, not repeated.
  expect((await remove(owner, editorRow.id)).error?.message).toBe('member-ended')
})

test('anon and service_role cannot call any of the three', async () => {
  const { boardId, owner } = await sharedBoard()
  const row = await membershipOf(owner.id, boardId)
  for (const client of [anonClient(), serviceClient()]) {
    for (const call of [
      client.rpc('change_member_role', { p_membership_id: row.id, p_role: 'editor' }),
      client.rpc('remove_member', { p_membership_id: row.id }),
      client.rpc('leave_board', { p_board_id: boardId }),
    ]) {
      expect((await call).error?.code).toBe('42501')
    }
  }
})
