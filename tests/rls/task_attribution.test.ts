import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { taskToRow } from '../../src/data/mappers'
import { makeMockTasks } from '../../src/data/mockTasks'
import { createTestUser, currentBoardId, deleteTestUser, withPg, type TestUser } from './helpers'

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
  for (const user of [editor, owner]) if (user) await deleteTestUser(user)
})

test('ordinary inserts, editor updates, and canonical upserts stamp the writer and advance revision', async () => {
  const task = { ...makeMockTasks()[0], id: randomUUID(), labelId: null }
  const payload = taskToRow(task, boardId)
  const { data: inserted, error: insertError } = await owner.client
    .from('tasks')
    .insert(payload)
    .select('*')
    .single()
  expect(insertError).toBeNull()
  expect(inserted).toMatchObject({
    author_id: owner.id,
    last_editor_id: owner.id,
    author_kind: 'author',
    revision: 1,
  })

  const { data: updated, error: updateError } = await editor.client
    .from('tasks')
    .update({ title: 'editor update' })
    .eq('id', task.id)
    .select('*')
    .single()
  expect(updateError).toBeNull()
  expect(updated).toMatchObject({
    author_id: owner.id,
    last_editor_id: editor.id,
    revision: 2,
    created_at: inserted!.created_at,
  })

  // The client sends every mapper column on reorder/import/save, including INSERT ON CONFLICT.
  const { data: upserted, error: upsertError } = await editor.client
    .from('tasks')
    .upsert({ ...payload, title: 'canonical upsert' }, { onConflict: 'id' })
    .select('*')
    .single()
  expect(upsertError).toBeNull()
  expect(upserted).toMatchObject({
    author_id: owner.id,
    last_editor_id: editor.id,
    revision: 3,
    created_at: inserted!.created_at,
  })

  const { data: fresh, error: freshError } = await editor.client
    .from('tasks')
    .upsert({ ...payload, id: randomUUID() })
    .select('*')
    .single()
  expect(freshError).toBeNull()
  expect(fresh).toMatchObject({ author_id: editor.id, last_editor_id: editor.id, revision: 1 })
})

const forgeries = [
  { author_id: '00000000-0000-0000-0000-000000000001' },
  { last_editor_id: '00000000-0000-0000-0000-000000000001' },
  { author_kind: 'transferred' },
  { revision: 9000 },
  { created_at: '2000-01-01T00:00:00Z' },
  { updated_at: '2000-01-01T00:00:00Z' },
]

test.each(forgeries)('editors cannot forge protected columns: %j', async (forgery) => {
  const id = randomUUID()
  const deniedInsert = await editor.client
    .from('tasks')
    .insert({ id, board_id: boardId, title: 'forged', ...forgery })
  expect(deniedInsert.status).toBe(403)
  expect(deniedInsert.error?.code).toBe('42501')
  const missing = await owner.client.from('tasks').select('id').eq('id', id)
  expect(missing.error).toBeNull()
  expect(missing.data).toEqual([])

  const inserted = await owner.client
    .from('tasks')
    .insert({ id, board_id: boardId, title: 'original' })
    .select('*')
    .single()
  expect(inserted.error).toBeNull()
  const deniedUpdate = await editor.client
    .from('tasks')
    .update({ title: 'forged update', ...forgery })
    .eq('id', id)
  expect(deniedUpdate.status).toBe(403)
  expect(deniedUpdate.error?.code).toBe('42501')
  const after = await owner.client.from('tasks').select('*').eq('id', id).single()
  expect(after.error).toBeNull()
  expect(after.data).toEqual(inserted.data)
})

test('deleting an author clears attribution and preserves content in another owner’s Board', async () => {
  const departing = await createTestUser()
  let deleted = false
  try {
    await withPg((pg) =>
      pg.query(
        `insert into public.board_memberships (board_id, account_id, role) values ($1, $2, 'editor')`,
        [boardId, departing.id],
      ),
    )
    const inserted = await departing.client
      .from('tasks')
      .insert({ board_id: boardId, title: 'survives author' })
      .select('*')
      .single()
    expect(inserted.error).toBeNull()
    expect(inserted.data?.author_id).toBe(departing.id)
    await deleteTestUser(departing)
    deleted = true
    const after = await owner.client.from('tasks').select('*').eq('id', inserted.data!.id).single()
    expect(after.error).toBeNull()
    expect(after.data).toMatchObject({
      title: 'survives author',
      board_id: boardId,
      author_id: null,
      last_editor_id: null,
    })
  } finally {
    if (!deleted) await deleteTestUser(departing)
  }
})

test('concurrent editor writes advance revision once each', async () => {
  const inserted = await owner.client
    .from('tasks')
    .insert({ board_id: boardId, title: 'concurrent edits' })
    .select('id')
    .single()
  expect(inserted.error).toBeNull()
  const id = inserted.data!.id
  const results = await Promise.all([
    owner.client.from('tasks').update({ title: 'owner edit' }).eq('id', id),
    editor.client.from('tasks').update({ description: 'editor edit' }).eq('id', id),
  ])
  for (const result of results) expect(result.error).toBeNull()
  const after = await owner.client.from('tasks').select('*').eq('id', id).single()
  expect(after.error).toBeNull()
  expect(after.data).toMatchObject({
    title: 'owner edit',
    description: 'editor edit',
    author_id: owner.id,
    revision: 3,
  })
})
