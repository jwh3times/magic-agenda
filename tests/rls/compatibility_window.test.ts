import { afterAll, beforeAll, expect, test } from 'vitest'
import { createTestUser, currentBoardId, deleteTestUser, withPg, type TestUser } from './helpers'

/**
 * The premise of Release A, asserted rather than argued.
 *
 * Retiring the compatibility layer is split across two releases because dropping a column that a
 * live client still SENDS is a hard failure — PostgREST answers `400 PGRST204`, and migrations land
 * at a different moment from the Cloudflare Pages build, so a long-open tab would break. Release A
 * therefore makes the columns unnecessary; Release B removes them.
 *
 * That only works if **both** client shapes write successfully against this schema at once: the
 * currently deployed client, which still sends `user_id`, `category`, and
 * `label_assignment_explicit`, and the new one, which sends none of them. If either fails, the
 * split has not bought anything and the release is unsafe.
 *
 * Delete this file with Release B — at that point the old shape is *supposed* to fail.
 */

let user: TestUser
let boardId: string

beforeAll(async () => {
  user = await createTestUser()
  boardId = await currentBoardId(user.id)
})

afterAll(async () => {
  if (user) await deleteTestUser(user)
})

test('the currently deployed client shape still writes', async () => {
  const { data, error } = await user.client
    .from('tasks')
    // Exactly what `taskToRow` sent before this release.
    .insert({
      user_id: user.id,
      board_id: boardId,
      title: 'old client',
      category: 'work',
      label_assignment_explicit: true,
      label_id: null,
      color: 'yellow',
      status: 'todo',
      order_index: 0,
    } as never)
    .select('id, user_id')
    .single()

  expect(error).toBeNull()
  expect((data as { user_id: string | null }).user_id).toBe(user.id)
})

test('the new client shape writes without any of the retired columns', async () => {
  const { data, error } = await user.client
    .from('tasks')
    .insert({
      board_id: boardId,
      title: 'new client',
      label_id: null,
      color: 'yellow',
      status: 'todo',
      order_index: 1,
    })
    .select('id')
    .single()

  expect(error).toBeNull()

  // `user_id` is nullable now, so omitting it is legal rather than defaulted. The other two still
  // have defaults, which is why they never needed a schema change.
  const row = await withPg(async (pg) => {
    const r = await pg.query<{
      user_id: string | null
      category: string
      label_assignment_explicit: boolean
    }>(`select user_id, category, label_assignment_explicit from public.tasks where id = $1`, [
      (data as { id: string }).id,
    ])
    return r.rows[0]
  })
  expect(row).toEqual({ user_id: null, category: 'work', label_assignment_explicit: false })
})

test('an Unlabeled Task stays Unlabeled — the bridge is gone, not merely unused', async () => {
  // The trap this release had to avoid. The new client omits `label_assignment_explicit`, so it
  // falls to `false` — exactly the signal `tasks_sync_legacy_category_label` read as "a stale
  // client omitted `label_id`". Had that trigger survived, it would have used `category`'s `'work'`
  // default to assign the Work Label to every Unlabeled Task ever created from here on.
  const { data, error } = await user.client
    .from('tasks')
    .insert({
      board_id: boardId,
      title: 'deliberately unlabeled',
      label_id: null,
      color: 'yellow',
      status: 'todo',
      order_index: 2,
    })
    .select('id, label_id')
    .single()

  expect(error).toBeNull()
  expect((data as { label_id: string | null }).label_id).toBeNull()
})
