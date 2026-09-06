import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, expect, test } from 'vitest'
import { checklistBytes, TASK_LIMITS } from '../../src/data/taskLimits'
import type { Database } from '../../src/types/database.types'
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

const item = { id: 'i', text: '', done: false }
const exactBytes = [
  { ...item, text: 'x'.repeat(TASK_LIMITS.checklistBytes - checklistBytes([item])) },
]
type Insert = Database['public']['Tables']['tasks']['Insert']
const invalid: [string, Partial<Insert>][] = [
  ['title', { title: 'x'.repeat(501) }],
  ['description', { description: 'x'.repeat(20001) }],
  ['checklist count', { checklist: Array.from({ length: 201 }, () => item) }],
  ['checklist object', { checklist: {} }],
  ['checklist scalar', { checklist: true }],
  ['checklist bytes', { checklist: [{ ...exactBytes[0], text: exactBytes[0].text + 'x' }] }],
  ['zero interval', { recur_interval: 0 }],
  ['negative interval', { recur_interval: -1 }],
  ['large interval', { recur_interval: 367 }],
]

test.each(invalid)(
  'database rejects oversized or malformed %s on INSERT and UPDATE',
  async (_, values) => {
    const id = randomUUID()
    const denied = await user.client
      .from('tasks')
      .insert({ id, board_id: boardId, title: 'valid', ...values })
    expect(denied.error?.code).toBe('23514')
    const missing = await user.client.from('tasks').select('id').eq('id', id)
    expect(missing.error).toBeNull()
    expect(missing.data).toEqual([])
    const inserted = await user.client
      .from('tasks')
      .insert({ id, board_id: boardId, title: 'valid' })
      .select('*')
      .single()
    expect(inserted.error).toBeNull()
    const update = await user.client.from('tasks').update(values).eq('id', id)
    expect(update.error?.code).toBe('23514')
    const after = await user.client.from('tasks').select('*').eq('id', id).single()
    expect(after.error).toBeNull()
    expect(after.data).toEqual(inserted.data)
  },
)

test('exact content boundaries and multibyte titles are accepted', async () => {
  const inserted = await user.client
    .from('tasks')
    .insert({
      board_id: boardId,
      title: '🎉'.repeat(500),
      description: 'x'.repeat(20000),
      checklist: Array.from({ length: 200 }, () => item),
      recur_interval: 366,
    })
    .select('id')
    .single()
  expect(inserted.error).toBeNull()
  const updated = await user.client
    .from('tasks')
    .update({ checklist: exactBytes, recur_interval: 1 })
    .eq('id', inserted.data!.id)
  expect(updated.error).toBeNull()
})

test('browser checklist byte calculation matches PostgreSQL including Unicode and JSON escaping', async () => {
  for (const checklist of [
    [],
    [item],
    exactBytes,
    [{ id: 'é', text: '🎉 "quoted" \\ \n \t', done: true }, item],
  ]) {
    const result = await withPg((pg) =>
      pg.query<{ bytes: number }>('select octet_length($1::jsonb::text) as bytes', [
        JSON.stringify(checklist),
      ]),
    )
    expect(checklistBytes(checklist)).toBe(result.rows[0].bytes)
  }
})
