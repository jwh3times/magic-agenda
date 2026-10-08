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
 * `collect_attachment_orphans`, the command behind the daily attachment sweep.
 *
 * The Edge Function that calls it is tested under Deno with a fake store; what can only be tested
 * here is the decision itself: which objects it offers for removal, and when. The property that
 * matters most is the one a unit test cannot reach -- an object is never offered by the call that
 * first sees it without a row, because Undo may be about to put that row back.
 */

let alice: TestUser
let boardId: string

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const uploadedPaths: string[] = []

beforeAll(async () => {
  alice = await createTestUser()
  boardId = await currentBoardId(alice.id)
})

afterAll(async () => {
  if (uploadedPaths.length > 0) {
    await serviceClient().storage.from('attachments').remove(uploadedPaths)
  }
  // Clears the marks this file left, so a later file's first call starts clean.
  await collect(0)
  if (alice) await deleteTestUser(alice)
})

async function collect(graceSeconds: number): Promise<string[]> {
  const { data, error } = await serviceClient().rpc('collect_attachment_orphans', {
    p_grace_seconds: graceSeconds,
    p_limit: 100000,
  })
  if (error) throw new Error(`collect failed: ${error.message}`)
  return data ?? []
}

/** A Task with one attachment whose object really exists, made the way the upload command does. */
async function seedTaskWithAttachment() {
  const { data: task, error: taskError } = await alice.client
    .from('tasks')
    .insert({ title: 'has a file', board_id: boardId })
    .select('id')
    .single()
  if (taskError) throw new Error(`task insert failed: ${taskError.message}`)

  const id = crypto.randomUUID()
  const reserved = await serviceClient().rpc('reserve_attachment_upload', {
    p_account_id: alice.id,
    p_attachment_id: id,
    p_board_id: boardId,
    p_filename: 'diagram.png',
    p_mime_type: 'image/png',
    p_size_bytes: pngBytes.byteLength,
    p_task_id: task.id,
  })
  if (reserved.error) throw new Error(`reservation failed: ${reserved.error.message}`)

  const path = `${boardId}/${task.id}/${id}`
  const uploaded = await serviceClient()
    .storage.from('attachments')
    .upload(path, new Blob([pngBytes], { type: 'image/png' }), { contentType: 'image/png' })
  if (uploaded.error) throw new Error(`upload failed: ${uploaded.error.message}`)
  uploadedPaths.push(path)

  return { taskId: task.id, attachmentId: id, path }
}

async function isMarked(path: string): Promise<boolean> {
  return withPg(async (pg) => {
    const { rows } = await pg.query(
      'select 1 from app_private.attachment_orphan_marks where storage_path = $1',
      [path],
    )
    return rows.length > 0
  })
}

test('an object whose row exists is never offered or marked', async () => {
  const seeded = await seedTaskWithAttachment()
  expect(await collect(0)).not.toContain(seeded.path)
  expect(await collect(0)).not.toContain(seeded.path)
  expect(await isMarked(seeded.path)).toBe(false)
})

test('a row-less object is marked by one call and offered only by a later one', async () => {
  const seeded = await seedTaskWithAttachment()
  await alice.client.from('tasks').delete().eq('id', seeded.taskId)

  // The call that first sees it must not offer it, even with no grace period at all: this is the
  // window in which Undo re-inserts the row.
  expect(await collect(0)).not.toContain(seeded.path)
  expect(await isMarked(seeded.path)).toBe(true)

  // Still inside the grace period: withheld.
  expect(await collect(3600)).not.toContain(seeded.path)

  // Past it: offered, and offered again until something removes the object.
  expect(await collect(0)).toContain(seeded.path)
  expect(await collect(0)).toContain(seeded.path)
})

test('restoring the row withdraws the mark', async () => {
  const seeded = await seedTaskWithAttachment()
  await alice.client.from('tasks').delete().eq('id', seeded.taskId)
  await collect(0)
  expect(await isMarked(seeded.path)).toBe(true)

  // Undo: the Task with its original id, then the attachment row with its original id.
  await alice.client
    .from('tasks')
    .insert({ id: seeded.taskId, title: 'restored', board_id: boardId })
  const restored = await alice.client.from('task_attachments').insert({
    id: seeded.attachmentId,
    board_id: boardId,
    task_id: seeded.taskId,
    filename: 'diagram.png',
    mime_type: 'image/png',
    size_bytes: pngBytes.byteLength,
  })
  expect(restored.error).toBeNull()

  expect(await collect(0)).not.toContain(seeded.path)
  expect(await isMarked(seeded.path)).toBe(false)
})

test('a mark is forgotten once its object is gone', async () => {
  const seeded = await seedTaskWithAttachment()
  await alice.client.from('tasks').delete().eq('id', seeded.taskId)
  await collect(0)
  expect(await collect(0)).toContain(seeded.path)

  // What the Edge Function does with an offered path.
  const removed = await serviceClient().storage.from('attachments').remove([seeded.path])
  expect(removed.error).toBeNull()

  expect(await collect(0)).not.toContain(seeded.path)
  expect(await isMarked(seeded.path)).toBe(false)
})

test('only service_role may run the command, and it validates its arguments', async () => {
  for (const client of [anonClient(), alice.client]) {
    const result = await client.rpc('collect_attachment_orphans', {
      p_grace_seconds: 0,
      p_limit: 10,
    })
    expect(result.error?.code).toBe('42501')
  }

  for (const args of [
    { p_grace_seconds: -1, p_limit: 10 },
    { p_grace_seconds: 0, p_limit: 0 },
  ]) {
    const result = await serviceClient().rpc('collect_attachment_orphans', args)
    expect(result.error?.code).toBe('22023')
  }
})

test('the marks table is unreachable by every API role', async () => {
  const grants = await withPg(async (pg) => {
    const { rows } = await pg.query<{ role: string; granted: boolean }>(
      `select r as role,
              has_table_privilege(r, 'app_private.attachment_orphan_marks',
                                  'select, insert, update, delete, truncate') as granted
         from unnest(array['anon', 'authenticated', 'service_role']) r`,
    )
    return rows
  })
  expect(grants.every((g) => !g.granted)).toBe(true)
})

test('the sweep is scheduled daily against the sweep-attachments function', async () => {
  const job = await withPg(async (pg) => {
    const { rows } = await pg.query<{ schedule: string; command: string }>(
      `select schedule, command from cron.job where jobname = 'sweep-attachments'`,
    )
    return rows[0]
  })
  expect(job.schedule).toBe('47 3 * * *')
  expect(job.command).toContain("'/sweep-attachments'")
  expect(job.command).toContain('reminder_cron_secret')
})
