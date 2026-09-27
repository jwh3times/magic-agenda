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
 * Compare-and-swap editor saves at the database boundary (#433).
 *
 * The client conditions an editor save on the revision it opened on: `update … where id = ? and
 * revision = ?`, never an upsert. These tests pin what that relies on — the server-stamped
 * revision advances on every write, a stale condition matches nothing and writes nothing, and an
 * UPDATE cannot recreate a Task someone deleted.
 */

let owner: TestUser
let editor: TestUser
let boardId: string

beforeAll(async () => {
  owner = await createTestUser()
  editor = await createTestUser()
  boardId = await currentBoardId(owner.id)
  await withPg((pg) =>
    pg.query(
      `insert into public.board_memberships (board_id, account_id, role) values ($1, $2, 'editor')`,
      [boardId, editor.id],
    ),
  )
})

afterAll(async () => {
  await withPg((pg) =>
    pg.query(
      `update public.board_memberships set ended_at = now(), end_reason = 'removed'
        where account_id = $1 and ended_at is null`,
      [editor.id],
    ),
  )
  for (const u of [editor, owner]) if (u) await deleteTestUser(u)
})

async function newTask(title: string) {
  const { data, error } = await owner.client
    .from('tasks')
    .insert(boardTaskInsert(boardId, { title }))
    .select('id, revision')
    .single()
  if (error) throw new Error(error.message)
  return data
}

const casSave = (as: TestUser, id: string, revision: number, title: string) =>
  as.client.from('tasks').update({ title }).eq('id', id).eq('revision', revision).select()

test('a save conditioned on the current revision lands and advances it', async () => {
  const task = await newTask('first')
  const { data, error } = await casSave(owner, task.id, task.revision, 'second')
  expect(error).toBeNull()
  expect(data).toHaveLength(1)
  expect(data![0].revision).toBe(task.revision + 1)
})

test('a stale save matches nothing and changes nothing', async () => {
  const task = await newTask('shared')
  // The editor saves first, from the same starting revision.
  const theirs = await casSave(editor, task.id, task.revision, 'theirs')
  expect(theirs.data).toHaveLength(1)

  const mine = await casSave(owner, task.id, task.revision, 'mine')
  expect(mine.error).toBeNull()
  expect(mine.data).toEqual([])
  const { data } = await owner.client.from('tasks').select('title, revision').eq('id', task.id)
  expect(data).toEqual([{ title: 'theirs', revision: task.revision + 1 }])

  // A deliberate overwrite against the revision now reported lands.
  const overwrite = await casSave(owner, task.id, task.revision + 1, 'mine')
  expect(overwrite.data).toHaveLength(1)
})

test('saving over a deleted Task cannot bring it back', async () => {
  const task = await newTask('doomed')
  const { error } = await editor.client.from('tasks').delete().eq('id', task.id)
  expect(error).toBeNull()

  const mine = await casSave(owner, task.id, task.revision, 'resurrected?')
  expect(mine.error).toBeNull()
  expect(mine.data).toEqual([])
  const { data } = await owner.client.from('tasks').select('id').eq('id', task.id)
  expect(data).toEqual([])
})
