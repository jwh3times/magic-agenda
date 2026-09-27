import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  boardTaskInsert,
  createTestUser,
  currentBoardId,
  deleteTestUser,
  serviceClient,
  withPg,
  type TestUser,
} from './helpers'

/**
 * Who a Task's reminder goes to (#441).
 *
 * On a Board with more than one current member, `reminder_candidate_rows` offers a Task to its
 * Assignee, or — unassigned — to members who opted in for that Board. A single-member Board is
 * unchanged. Each case is asserted on the same Board and Tasks, so the difference between two
 * members' rows is the rule itself and nothing about the fixture.
 */

let owner: TestUser
let editor: TestUser
let solo: TestUser
let boardId: string
let editorMembershipId: string
const taskIds: Record<string, string> = {}

async function enableReminders(u: TestUser) {
  const { error } = await u.client
    .from('user_settings')
    .update({ timezone: 'America/New_York', reminder_lead_minutes: 15 })
    .eq('user_id', u.id)
  if (error) throw new Error(error.message)
}

/** The Task ids offered to one account, among this file's Tasks. */
async function offeredTo(accountId: string): Promise<string[]> {
  const { data, error } = await serviceClient().rpc('reminder_candidate_rows')
  if (error) throw new Error(error.message)
  const ours = new Set(Object.values(taskIds))
  return (data as { account_id: string; task_id: string }[])
    .filter((row) => row.account_id === accountId && ours.has(row.task_id))
    .map((row) => row.task_id)
    .sort()
}

const ids = (...names: string[]) => names.map((n) => taskIds[n]).sort()

beforeAll(async () => {
  owner = await createTestUser()
  editor = await createTestUser()
  solo = await createTestUser()
  boardId = await currentBoardId(owner.id)
  const { rows } = await withPg((pg) =>
    pg.query<{ id: string }>(
      `insert into public.board_memberships (board_id, account_id, role)
       values ($1, $2, 'editor') returning id`,
      [boardId, editor.id],
    ),
  )
  editorMembershipId = rows[0].id
  for (const u of [owner, editor, solo]) await enableReminders(u)

  const add = async (name: string, as: TestUser, board: string, assignee: string | null) => {
    const { data, error } = await as.client
      .from('tasks')
      .insert(
        boardTaskInsert(board, {
          title: name,
          day: '2026-10-01',
          at_time: '09:00',
          assignee_account_id: assignee,
        }),
      )
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    taskIds[name] = data.id
  }
  await add('ownerTask', owner, boardId, owner.id)
  await add('editorTask', owner, boardId, editor.id)
  await add('unassigned', owner, boardId, null)
  await add('soloTask', solo, await currentBoardId(solo.id), null)
})

afterAll(async () => {
  await withPg((pg) =>
    pg.query(
      `update public.board_memberships set ended_at = now(), end_reason = 'removed'
        where id = $1 and ended_at is null`,
      [editorMembershipId],
    ),
  )
  for (const u of [editor, solo, owner]) if (u) await deleteTestUser(u)
})

test('a single-member Board is unchanged: every timed Task, assigned or not', async () => {
  expect(await offeredTo(solo.id)).toEqual(ids('soloTask'))
})

test('on a shared Board, each member hears about the Tasks assigned to them', async () => {
  expect(await offeredTo(owner.id)).toEqual(ids('ownerTask'))
  expect(await offeredTo(editor.id)).toEqual(ids('editorTask'))
})

test('an unassigned Task reaches only members who opted in for that Board', async () => {
  const { error } = await editor.client
    .from('board_memberships')
    .update({ remind_unassigned: true })
    .eq('id', editorMembershipId)
  expect(error).toBeNull()
  try {
    expect(await offeredTo(editor.id)).toEqual(ids('editorTask', 'unassigned'))
    // The owner did not opt in, and still hears only their own.
    expect(await offeredTo(owner.id)).toEqual(ids('ownerTask'))
  } finally {
    await editor.client
      .from('board_memberships')
      .update({ remind_unassigned: false })
      .eq('id', editorMembershipId)
  }
})

test('a member can set their own opt-in and nobody else’s', async () => {
  const { rows } = await withPg((pg) =>
    pg.query<{ id: string }>(
      `select id from public.board_memberships where board_id = $1 and account_id = $2`,
      [boardId, owner.id],
    ),
  )
  await editor.client
    .from('board_memberships')
    .update({ remind_unassigned: true })
    .eq('id', rows[0].id)
  const after = await withPg(async (pg) => {
    const { rows: r } = await pg.query<{ remind_unassigned: boolean }>(
      'select remind_unassigned from public.board_memberships where id = $1',
      [rows[0].id],
    )
    return r[0].remind_unassigned
  })
  expect(after).toBe(false)
})
