import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  boardTaskInsert,
  createTestUser,
  currentBoardId,
  deleteTestUser,
  withPg,
  type TestUser,
} from './helpers'

/**
 * A Task stays in the Board it was created in.
 *
 * `tasks_update_editor` is satisfied by a caller who can edit both the old and the new Board, and
 * `board_id` has to stay in the UPDATE grant because every client write resends it. So nothing in
 * the policies stops one UPDATE from carrying a private Task into a shared Board, where its
 * members can read it. The trigger is what refuses that; these tests pin it for the one caller the
 * policies cannot stop, and pin that resending the unchanged value still works.
 */

let owner: TestUser
let other: TestUser
let privateBoard: string
let sharedBoard: string

beforeAll(async () => {
  owner = await createTestUser()
  other = await createTestUser()
  privateBoard = await currentBoardId(owner.id)
  sharedBoard = await currentBoardId(other.id)
  await withPg((pg) =>
    pg.query(
      `insert into public.board_memberships (board_id, account_id, role) values ($1, $2, 'editor')`,
      [sharedBoard, owner.id],
    ),
  )
})

afterAll(async () => {
  await withPg((pg) =>
    pg.query(
      `update public.board_memberships set ended_at = now(), end_reason = 'removed'
        where account_id = $1 and board_id = $2 and ended_at is null`,
      [owner.id, sharedBoard],
    ),
  )
  for (const u of [owner, other]) if (u) await deleteTestUser(u)
})

async function newPrivateTask(title: string) {
  const { data, error } = await owner.client
    .from('tasks')
    .insert(boardTaskInsert(privateBoard, { title }))
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id
}

test('an editor of both Boards cannot move a Task from one to the other', async () => {
  const id = await newPrivateTask('private')
  // The fixture is only meaningful if the caller really can write to the target Board.
  const probe = await owner.client
    .from('tasks')
    .insert(boardTaskInsert(sharedBoard, { title: 'allowed here' }))
    .select('id')
  expect(probe.error).toBeNull()

  const moved = await owner.client
    .from('tasks')
    .update({ board_id: sharedBoard, title: 'moved' })
    .eq('id', id)
    .select('id')
  expect(moved.error?.message).toBe('task-board-immutable')

  const { data } = await owner.client.from('tasks').select('board_id, title').eq('id', id)
  expect(data).toEqual([{ board_id: privateBoard, title: 'private' }])
  const seen = await other.client.from('tasks').select('id').eq('id', id)
  expect(seen.data).toEqual([])
})

test('a write that resends the unchanged Board still lands', async () => {
  const id = await newPrivateTask('before')
  const { data, error } = await owner.client
    .from('tasks')
    .update({ board_id: privateBoard, title: 'after' })
    .eq('id', id)
    .select('board_id, title')
  expect(error).toBeNull()
  expect(data).toEqual([{ board_id: privateBoard, title: 'after' }])
})
