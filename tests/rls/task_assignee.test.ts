import { afterAll, expect, test } from 'vitest'
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
 * Task Assignee at the database boundary (#440).
 *
 * The rule: an assignee is a **current** member of the Task's Board, and ending a Membership clears
 * that person's assignments on that Board in the same transaction. Both halves are triggers,
 * because a foreign key cannot say "current"; both are asserted here beside a success that proves
 * the fixture could have succeeded.
 */

const everyone: TestUser[] = []
async function user(): Promise<TestUser> {
  const created = await createTestUser()
  everyone.push(created)
  return created
}

async function sharedBoard(...roles: string[]) {
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

async function newTask(as: TestUser, boardId: string, assignee: string | null = null) {
  return as.client
    .from('tasks')
    .insert(boardTaskInsert(boardId, { title: 'work', assignee_account_id: assignee }))
    .select('id, assignee_account_id')
    .single()
}

const assigneeOf = (taskId: string) =>
  withPg(async (pg) => {
    const { rows } = await pg.query<{ assignee_account_id: string | null }>(
      'select assignee_account_id from public.tasks where id = $1',
      [taskId],
    )
    return rows[0].assignee_account_id
  })

afterAll(async () => {
  await withPg((pg) =>
    pg.query(
      `update public.board_memberships set ended_at = now(), end_reason = 'removed'
        where account_id = any($1) and ended_at is null and role <> 'owner'`,
      [everyone.map((u) => u.id)],
    ),
  )
  for (const created of everyone) await deleteTestUser(created).catch(() => {})
})

test('a current member can be assigned, on insert and on update, and unassigned', async () => {
  const { owner, boardId, members } = await sharedBoard('editor')
  const [editor] = members
  const created = await newTask(owner, boardId, editor.id)
  expect(created.error).toBeNull()
  expect(created.data?.assignee_account_id).toBe(editor.id)

  const plain = await newTask(owner, boardId)
  const { error } = await editor.client
    .from('tasks')
    .update({ assignee_account_id: owner.id })
    .eq('id', plain.data!.id)
  expect(error).toBeNull()
  expect(await assigneeOf(plain.data!.id)).toBe(owner.id)

  await editor.client.from('tasks').update({ assignee_account_id: null }).eq('id', plain.data!.id)
  expect(await assigneeOf(plain.data!.id)).toBeNull()
})

test('someone who is not a current member of the Board cannot be assigned', async () => {
  const { owner, boardId } = await sharedBoard()
  const stranger = await user()
  const former = await user()
  await withPg((pg) =>
    pg.query(
      `insert into public.board_memberships (board_id, account_id, role, ended_at, end_reason)
       values ($1, $2, 'editor', now(), 'removed')`,
      [boardId, former.id],
    ),
  )
  for (const who of [stranger, former]) {
    const refused = await newTask(owner, boardId, who.id)
    expect(refused.error?.message).toBe('assignee-not-member')
  }
  const task = await newTask(owner, boardId)
  const { error } = await owner.client
    .from('tasks')
    .update({ assignee_account_id: stranger.id })
    .eq('id', task.data!.id)
  expect(error?.message).toBe('assignee-not-member')
  expect(await assigneeOf(task.data!.id)).toBeNull()
})

test('removing a member clears their assignments on that Board, and only that Board', async () => {
  const { owner, boardId, members } = await sharedBoard('editor')
  const [editor] = members
  // The editor is also assigned on their own Board, which must be untouched.
  const ownBoard = await currentBoardId(editor.id)
  const ownTask = await newTask(editor, ownBoard, editor.id)
  const shared = await newTask(owner, boardId, editor.id)
  const ownerTask = await newTask(owner, boardId, owner.id)

  const { rows } = await withPg((pg) =>
    pg.query<{ id: string }>(
      `select id from public.board_memberships
        where board_id = $1 and account_id = $2 and ended_at is null`,
      [boardId, editor.id],
    ),
  )
  expect(
    (await owner.client.rpc('remove_member', { p_membership_id: rows[0].id })).error,
  ).toBeNull()

  expect(await assigneeOf(shared.data!.id)).toBeNull()
  expect(await assigneeOf(ownerTask.data!.id)).toBe(owner.id)
  expect(await assigneeOf(ownTask.data!.id)).toBe(editor.id)
})

test('leaving a Board clears your assignments there too', async () => {
  const { owner, boardId, members } = await sharedBoard('viewer')
  const [viewer] = members
  const task = await newTask(owner, boardId, viewer.id)
  expect(task.error).toBeNull()
  expect((await viewer.client.rpc('leave_board', { p_board_id: boardId })).error).toBeNull()
  expect(await assigneeOf(task.data!.id)).toBeNull()
})

test('a Viewer cannot change an assignment, because a Viewer cannot write Tasks', async () => {
  const { owner, boardId, members } = await sharedBoard('viewer')
  const [viewer] = members
  const task = await newTask(owner, boardId)
  await viewer.client
    .from('tasks')
    .update({ assignee_account_id: viewer.id })
    .eq('id', task.data!.id)
  expect(await assigneeOf(task.data!.id)).toBeNull()
})

test('server-side materialization carries the definition’s assignee to new Occurrences', async () => {
  const { owner, boardId, members } = await sharedBoard('editor')
  const [editor] = members
  const today = new Date().toISOString().slice(0, 10)
  const definition = await owner.client
    .from('tasks')
    .insert(
      boardTaskInsert(boardId, {
        title: 'standup',
        recur_freq: 'daily',
        day: today,
        assignee_account_id: editor.id,
      }),
    )
    .select('id')
    .single()
  expect(definition.error).toBeNull()

  const occurrenceId = crypto.randomUUID()
  const { data, error } = await serviceClient().rpc('insert_materialized_occurrences', {
    p_rows: [
      {
        id: occurrenceId,
        board_id: boardId,
        title: 'standup',
        description: '',
        label_id: null,
        color: 'yellow',
        checklist: [],
        status: 'todo',
        completed_at: null,
        reopen_status: 'todo',
        archived_at: null,
        day: today,
        at_time: null,
        pinned: false,
        order_index: 0,
        korder: 0,
        recur_freq: 'none',
        recur_interval: 1,
        recur_weekdays: [],
        recur_count: null,
        recur_until: null,
        recur_parent_id: definition.data!.id,
        recur_skip: [],
        recur_origin_day: today,
        assignee_account_id: editor.id,
      },
    ],
  })
  expect(error).toBeNull()
  expect(data).toBe(1)
  expect(await assigneeOf(occurrenceId)).toBe(editor.id)
})
