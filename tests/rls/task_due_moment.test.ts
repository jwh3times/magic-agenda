import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createTestUser, currentBoardId, deleteTestUser, withPg, type TestUser } from './helpers'

let user: TestUser
let boardId: string

beforeAll(async () => {
  user = await createTestUser()
  boardId = await currentBoardId(user.id)
})

afterAll(async () => {
  if (user) await deleteTestUser(user)
})

test('Due Time requires Scheduled Day on INSERT and UPDATE', async () => {
  const invalidId = randomUUID()
  const invalidInsert = await user.client.from('tasks').insert({
    id: invalidId,
    board_id: boardId,
    title: 'Invalid Inbox Due Time',
    day: null,
    at_time: '09:00',
  })
  expect(invalidInsert.error?.code).toBe('23514')

  const inserted = await user.client
    .from('tasks')
    .insert({
      board_id: boardId,
      title: 'Scheduled with Due Time',
      day: '2026-09-15',
      at_time: '09:00',
    })
    .select('*')
    .single()
  expect(inserted.error).toBeNull()

  const invalidUpdate = await user.client
    .from('tasks')
    .update({ day: null })
    .eq('id', inserted.data!.id)
  expect(invalidUpdate.error?.code).toBe('23514')

  const unchanged = await user.client.from('tasks').select('*').eq('id', inserted.data!.id).single()
  expect(unchanged.error).toBeNull()
  expect(unchanged.data).toEqual(inserted.data)

  const atomicInboxMove = await user.client
    .from('tasks')
    .update({ day: null, at_time: null })
    .eq('id', inserted.data!.id)
    .select('day, at_time')
    .single()
  expect(atomicInboxMove.error).toBeNull()
  expect(atomicInboxMove.data).toEqual({ day: null, at_time: null })
})

test('untimed Scheduled and Inbox Tasks remain valid', async () => {
  const inserted = await user.client
    .from('tasks')
    .insert([
      { board_id: boardId, title: 'Scheduled untimed', day: '2026-09-15' },
      { board_id: boardId, title: 'Inbox untimed', day: null },
    ])
    .select('title, day, at_time')
  expect(inserted.error).toBeNull()
  expect(inserted.data).toEqual([
    { title: 'Scheduled untimed', day: '2026-09-15', at_time: null },
    { title: 'Inbox untimed', day: null, at_time: null },
  ])
})

test('the Due Time constraint is validated after legacy cleanup', async () => {
  const result = await withPg((pg) =>
    pg.query<{ convalidated: boolean }>(
      `select convalidated
         from pg_constraint
        where conrelid = 'public.tasks'::regclass
          and conname = 'tasks_due_time_requires_scheduled_day'`,
    ),
  )
  expect(result.rows).toEqual([{ convalidated: true }])
})
