import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  anonClient,
  createTestUser,
  currentBoardId,
  serviceClient,
  withPg,
  type TestUser,
} from './helpers'

/**
 * The authorization boundary for Task attachments (#278), exercised against a real stack.
 *
 * This is the layer that matters for this feature. PR 1 ships no client code at all, so every
 * guarantee it makes is a database guarantee, and a unit test under jsdom could not reach any of
 * them. Three separate mechanisms are asserted here, and they fail differently:
 *
 *   - **`task_attachments` RLS** — who may read or write a row describing a file.
 *   - **`storage.objects` RLS** — who may read or write the file itself, keyed on the path prefix.
 *     A row and an object are two different things to authorize, and getting one right proves
 *     nothing about the other.
 *   - **The composite FK `task_attachments_task_same_board`** — the structural guarantee that a
 *     row's Board is its Task's Board, which the policies above all *assume* when they read
 *     `board_id`. If that assumption can be broken, the policies are decorative.
 */

let alice: TestUser
let bob: TestUser
let aliceBoardId: string
let bobBoardId: string
let aliceTaskId: string

beforeAll(async () => {
  alice = await createTestUser()
  bob = await createTestUser()
  aliceBoardId = await currentBoardId(alice.id)
  bobBoardId = await currentBoardId(bob.id)

  const { data, error } = await alice.client
    .from('tasks')
    .insert({ title: 'has attachments', board_id: aliceBoardId })
    .select('id')
    .single()
  if (error) throw new Error(`fixture insert failed: ${error.message}`)
  aliceTaskId = data.id
})

afterAll(async () => {
  if (alice) await deleteTestUserSafely(alice)
  if (bob) await deleteTestUserSafely(bob)
})

async function deleteTestUserSafely(user: TestUser) {
  const { deleteTestUser } = await import('./helpers')
  try {
    await deleteTestUser(user)
  } catch {
    // Guarded for the same reason boards.test.ts guards it: an unguarded delete during a failed
    // beforeAll throws a TypeError over the real error and leaks the account.
  }
}

/** Seed a real membership for bob on alice's board, bypassing the Data API (command-owned). */
async function grantBob(role: 'owner' | 'editor' | 'viewer') {
  await withPg((pg) =>
    pg.query(
      `insert into public.board_memberships (board_id, account_id, role) values ($1, $2, $3)`,
      [aliceBoardId, bob.id, role],
    ),
  )
}

/**
 * **End** bob's membership rather than deleting it -- the distinction this file got wrong once.
 * `revokeBob` DELETEs the row, so a caller has no membership at all and the policies deny on the
 * `account_id` join; only setting `ended_at` exercises the `ended_at is null` clause. A test that
 * uses the wrong one passes whether or not that clause exists.
 */
async function endBobMembership() {
  await withPg((pg) =>
    pg.query(
      `update public.board_memberships set ended_at = now(), end_reason = 'removed'
        where board_id = $1 and account_id = $2 and ended_at is null`,
      [aliceBoardId, bob.id],
    ),
  )
}

async function revokeBob() {
  await withPg((pg) =>
    pg.query(`delete from public.board_memberships where board_id = $1 and account_id = $2`, [
      aliceBoardId,
      bob.id,
    ]),
  )
}

const attachmentRow = (over: Record<string, unknown> = {}) => ({
  board_id: aliceBoardId,
  task_id: aliceTaskId,
  filename: 'diagram.png',
  mime_type: 'image/png',
  size_bytes: 2048,
  ...over,
})

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

type ReservedAttachment = {
  id: string
  board_id: string
  task_id: string
  storage_path: string
  filename: string
  mime_type: string
  size_bytes: number
  uploaded_by: string | null
  created_at: string
}

async function reserveAttachment(
  over: {
    accountId?: string
    id?: string
    boardId?: string
    taskId?: string
    filename?: string
    mimeType?: string
    sizeBytes?: number
  } = {},
) {
  const id = over.id ?? crypto.randomUUID()
  const boardId = over.boardId ?? aliceBoardId
  const taskId = over.taskId ?? aliceTaskId
  const result = await serviceClient()
    .rpc('reserve_attachment_upload', {
      p_account_id: over.accountId ?? alice.id,
      p_attachment_id: id,
      p_board_id: boardId,
      p_filename: over.filename ?? 'diagram.png',
      p_mime_type: over.mimeType ?? 'image/png',
      p_size_bytes: over.sizeBytes ?? pngBytes.byteLength,
      p_task_id: taskId,
    })
    .single()

  const data = result.data as unknown as ReservedAttachment | null

  return { data, error: result.error, id, boardId, taskId }
}

async function seedAttachment(over: Parameters<typeof reserveAttachment>[0] = {}) {
  const reserved = await reserveAttachment(over)
  if (reserved.error) throw new Error(`attachment reservation failed: ${reserved.error.message}`)

  const path = `${reserved.boardId}/${reserved.taskId}/${reserved.id}`
  const uploaded = await serviceClient()
    .storage.from('attachments')
    .upload(path, new Blob([pngBytes], { type: 'image/png' }), { contentType: 'image/png' })
  if (uploaded.error) throw new Error(`attachment upload failed: ${uploaded.error.message}`)

  if (!reserved.data) throw new Error('attachment reservation returned no row')
  return { ...reserved.data, path }
}

// ---------------------------------------------------------------------------
// task_attachments rows
// ---------------------------------------------------------------------------

test('an owner can reserve an attachment, and storage_path is derived', async () => {
  const { data, error } = await reserveAttachment()

  expect(error).toBeNull()
  // The path is generated, never supplied. This is what ties the row to exactly one object.
  expect(data?.storage_path).toBe(`${aliceBoardId}/${aliceTaskId}/${data?.id}`)

  await alice.client.from('task_attachments').delete().eq('id', data!.id)
})

test('the service upload command reserves quota and creates the authoritative row', async () => {
  const id = crypto.randomUUID()
  const { data, error } = await reserveAttachment({ id, sizeBytes: 2048 })

  expect(error).toBeNull()
  expect(data).toMatchObject({
    id,
    board_id: aliceBoardId,
    task_id: aliceTaskId,
    storage_path: `${aliceBoardId}/${aliceTaskId}/${id}`,
    filename: 'diagram.png',
    mime_type: 'image/png',
    size_bytes: 2048,
    uploaded_by: alice.id,
  })

  await alice.client.from('task_attachments').delete().eq('id', id)
})

test('upload cleanup removes only a reservation whose object never landed', async () => {
  const missingId = crypto.randomUUID()
  await serviceClient().rpc('reserve_attachment_upload', {
    p_account_id: alice.id,
    p_attachment_id: missingId,
    p_board_id: aliceBoardId,
    p_filename: 'missing.png',
    p_mime_type: 'image/png',
    p_size_bytes: 8,
    p_task_id: aliceTaskId,
  })
  const missingCancel = await serviceClient().rpc('cancel_attachment_upload', {
    p_account_id: alice.id,
    p_attachment_id: missingId,
  })
  expect(missingCancel.error).toBeNull()

  const landedId = crypto.randomUUID()
  const landedPath = `${aliceBoardId}/${aliceTaskId}/${landedId}`
  await serviceClient().rpc('reserve_attachment_upload', {
    p_account_id: alice.id,
    p_attachment_id: landedId,
    p_board_id: aliceBoardId,
    p_filename: 'landed.png',
    p_mime_type: 'image/png',
    p_size_bytes: 8,
    p_task_id: aliceTaskId,
  })
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], {
    type: 'image/png',
  })
  await serviceClient()
    .storage.from('attachments')
    .upload(landedPath, png, { contentType: 'image/png' })
  const landedCancel = await serviceClient().rpc('cancel_attachment_upload', {
    p_account_id: alice.id,
    p_attachment_id: landedId,
  })
  expect(landedCancel.error).toBeNull()

  const { data: rows } = await alice.client
    .from('task_attachments')
    .select('id')
    .in('id', [missingId, landedId])
  expect(rows?.map((row) => row.id)).toEqual([landedId])

  await alice.client.from('task_attachments').delete().eq('id', landedId)
  await serviceClient().storage.from('attachments').remove([landedPath])
})

test('the byte quota counts orphaned objects and in-flight reservations exactly once', async () => {
  const orphanId = crypto.randomUUID()
  const orphanPath = `${aliceBoardId}/${aliceTaskId}/${orphanId}`
  const orphan = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], {
    type: 'image/png',
  })
  const uploaded = await serviceClient()
    .storage.from('attachments')
    .upload(orphanPath, orphan, { contentType: 'image/png' })
  expect(uploaded.error).toBeNull()

  // 90 MiB + (10 MiB - the 8-byte orphan) leaves the Board at exactly 100 MiB. These rows model
  // reservations whose object upload has not completed yet, so a second concurrent command must
  // count them even though storage.objects does not.
  await withPg(async (pg) => {
    for (let i = 0; i < 10; i++) {
      const size = i === 9 ? 10 * 1024 * 1024 - 8 : 10 * 1024 * 1024
      await pg.query(
        `insert into public.task_attachments
           (id, board_id, task_id, filename, mime_type, size_bytes, uploaded_by)
         values ($1, $2, $3, $4, 'image/png', $5, $6)`,
        [crypto.randomUUID(), aliceBoardId, aliceTaskId, `reservation-${i}.png`, size, alice.id],
      )
    }
  })

  const refused = await serviceClient().rpc('reserve_attachment_upload', {
    p_account_id: alice.id,
    p_attachment_id: crypto.randomUUID(),
    p_board_id: aliceBoardId,
    p_filename: 'one-more.png',
    p_mime_type: 'image/png',
    p_size_bytes: 1,
    p_task_id: aliceTaskId,
  })
  expect(refused.error?.message).toBe('attachment_byte_quota_exceeded')

  await serviceClient().storage.from('attachments').remove([orphanPath])
  await withPg((pg) =>
    pg.query(`delete from public.task_attachments where board_id = $1`, [aliceBoardId]),
  )
})

test('the object quota refuses the 1,001st attachment on a Board', async () => {
  await withPg((pg) =>
    pg.query(
      `insert into public.task_attachments
         (id, board_id, task_id, filename, mime_type, size_bytes, uploaded_by)
       select gen_random_uuid(), $1, $2, 'tiny-' || n || '.png', 'image/png', 1, $3
         from generate_series(1, 1000) n`,
      [aliceBoardId, aliceTaskId, alice.id],
    ),
  )

  const refused = await serviceClient().rpc('reserve_attachment_upload', {
    p_account_id: alice.id,
    p_attachment_id: crypto.randomUUID(),
    p_board_id: aliceBoardId,
    p_filename: 'one-more.png',
    p_mime_type: 'image/png',
    p_size_bytes: 1,
    p_task_id: aliceTaskId,
  })
  expect(refused.error?.message).toBe('attachment_object_quota_exceeded')

  await withPg((pg) =>
    pg.query(`delete from public.task_attachments where board_id = $1`, [aliceBoardId]),
  )
})

test('concurrent reservations cannot both consume the final byte', async () => {
  await withPg(async (pg) => {
    for (let i = 0; i < 10; i++) {
      const size = i === 9 ? 10 * 1024 * 1024 - 1 : 10 * 1024 * 1024
      await pg.query(
        `insert into public.task_attachments
           (id, board_id, task_id, filename, mime_type, size_bytes, uploaded_by)
         values ($1, $2, $3, $4, 'image/png', $5, $6)`,
        [crypto.randomUUID(), aliceBoardId, aliceTaskId, `reserved-${i}.png`, size, alice.id],
      )
    }
  })

  const call = `select (public.reserve_attachment_upload(
    $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, 'image/png'::text, 1::bigint
  )).id`

  await withPg(async (first) => {
    await withPg(async (second) => {
      await first.query('begin')
      await second.query('begin')
      await first.query('set local role service_role')
      await second.query('set local role service_role')

      const firstId = crypto.randomUUID()
      const secondId = crypto.randomUUID()
      await first.query(call, [alice.id, firstId, aliceBoardId, aliceTaskId, 'first.png'])

      const secondResult = second
        .query(call, [alice.id, secondId, aliceBoardId, aliceTaskId, 'second.png'])
        .then(() => null)
        .catch((error: { message?: string }) => error.message ?? '')

      // Keep the first reservation uncommitted long enough for the second connection to reach the
      // same command. Without Board-scoped serialization it cannot see the first row and succeeds.
      await first.query('select pg_sleep(0.05)')
      await first.query('commit')

      expect(await secondResult).toBe('attachment_byte_quota_exceeded')
      await second.query('rollback')
    })
  })

  await withPg((pg) =>
    pg.query(`delete from public.task_attachments where board_id = $1`, [aliceBoardId]),
  )
})

test('storage_path cannot be supplied by the client', async () => {
  // A generated column rejects a write outright (428C9) rather than silently ignoring it. That
  // distinction matters: a silent ignore would let a caller believe they had pointed the row at
  // another Board's object.
  const { error } = await alice.client
    .from('task_attachments')
    .insert(attachmentRow({ storage_path: `${bobBoardId}/${aliceTaskId}/forged` }))
  expect(error).not.toBeNull()
})

test('a client cannot forge the size or MIME recorded for an existing object', async () => {
  const id = crypto.randomUUID()
  const path = `${aliceBoardId}/${aliceTaskId}/${id}`
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], {
    type: 'image/png',
  })
  const uploaded = await serviceClient()
    .storage.from('attachments')
    .upload(path, png, { contentType: 'image/png' })
  expect(uploaded.error).toBeNull()

  const forged = await alice.client.from('task_attachments').insert(
    attachmentRow({
      id,
      mime_type: 'application/pdf',
      size_bytes: 1,
    }),
  )
  expect(forged.error?.code).toBe('42501')

  const accurate = await alice.client
    .from('task_attachments')
    .insert(attachmentRow({ id, mime_type: 'image/png', size_bytes: 8 }))
  expect(accurate.error).toBeNull()

  await alice.client.from('task_attachments').delete().eq('id', id)
  await serviceClient().storage.from('attachments').remove([path])
})

test('a non-member cannot read or write attachments on another board', async () => {
  const seeded = await seedAttachment()

  const { data: read, error: readError } = await bob.client
    .from('task_attachments')
    .select('id')
    .eq('id', seeded.id)
  expect(readError).toBeNull()
  expect(read).toEqual([]) // filtered, not errored -- RLS denies by returning no rows

  const { error: writeError } = await bob.client.from('task_attachments').insert(attachmentRow())
  expect(writeError).not.toBeNull()
  expect(writeError?.code).toBe('42501')

  await alice.client.from('task_attachments').delete().eq('id', seeded.id)
  await serviceClient().storage.from('attachments').remove([seeded.path])
})

test('a viewer may read an attachment row but not create or delete one', async () => {
  const seeded = await seedAttachment()
  await grantBob('viewer')

  const { data: read } = await bob.client.from('task_attachments').select('id').eq('id', seeded.id)
  expect(read).toHaveLength(1) // Viewers read. That is what Viewer means.

  const { error: insertError } = await bob.client.from('task_attachments').insert(attachmentRow())
  expect(insertError?.code).toBe('42501')

  // DELETE denies by filtering rather than erroring, so assert the row survived.
  await bob.client.from('task_attachments').delete().eq('id', seeded.id)
  const { data: stillThere } = await alice.client
    .from('task_attachments')
    .select('id')
    .eq('id', seeded.id)
  expect(stillThere).toHaveLength(1)

  await revokeBob()
  await alice.client.from('task_attachments').delete().eq('id', seeded.id)
  await serviceClient().storage.from('attachments').remove([seeded.path])
})

test('an editor may reserve and delete attachments through the upload command', async () => {
  await grantBob('editor')

  const { data, error } = await reserveAttachment({
    accountId: bob.id,
    filename: 'from-editor.png',
  })
  expect(error).toBeNull()

  await bob.client.from('task_attachments').delete().eq('id', data!.id)
  const { data: gone } = await alice.client.from('task_attachments').select('id').eq('id', data!.id)
  expect(gone).toEqual([])

  await revokeBob()
})

test('a former member loses attachment access when their membership ends', async () => {
  // `ended_at is null` is the clause that carries this, in all four policies. Dropping it from any
  // one of them would leave every former member with access, and no other test here would notice.
  const seeded = await seedAttachment()
  await grantBob('editor')

  const { data: whileMember } = await bob.client
    .from('task_attachments')
    .select('id')
    .eq('id', seeded.id)
  expect(whileMember).toHaveLength(1) // sanity: the fixture actually granted access

  await endBobMembership()

  const { data: after } = await bob.client.from('task_attachments').select('id').eq('id', seeded.id)
  expect(after).toEqual([])

  await revokeBob()
  await alice.client.from('task_attachments').delete().eq('id', seeded.id)
  await serviceClient().storage.from('attachments').remove([seeded.path])
})

test('an anonymous client reads zero rows without an error', async () => {
  // Same load-bearing shape as `user_settings`: every policy names `authenticated`, so `anon` has
  // no applicable policy and is filtered rather than refused. A 42501 here would be a different
  // contract for any future client code that branches on it.
  const result = await anonClient().from('task_attachments').select('id')
  expect(result.error).toBeNull()
  expect(result.data).toEqual([])
})

// ---------------------------------------------------------------------------
// The composite FK -- the assumption every policy above rests on
// ---------------------------------------------------------------------------

test('an attachment cannot name a task from a different board', async () => {
  // Without `task_attachments_task_same_board`, this row would be accepted: the INSERT policy only
  // checks that `board_id` is one alice may edit, and it is -- it is her own board. The FK is what
  // makes "this task is in this board" true rather than merely claimed.
  const { data: bobTask } = await bob.client
    .from('tasks')
    .insert({ title: "bob's task", board_id: bobBoardId })
    .select('id')
    .single()

  const { error } = await reserveAttachment({ taskId: bobTask!.id })
  expect(error).not.toBeNull()
  expect(error?.code).toBe('23503') // foreign key violation, not a policy denial

  await bob.client.from('tasks').delete().eq('id', bobTask!.id)
})

test('deleting a task cascades its attachment rows', async () => {
  const { data: task } = await alice.client
    .from('tasks')
    .insert({ title: 'doomed', board_id: aliceBoardId })
    .select('id')
    .single()
  const { data: attachment, error: attachmentError } = await reserveAttachment({
    taskId: task!.id,
  })
  expect(attachmentError).toBeNull()

  await alice.client.from('tasks').delete().eq('id', task!.id)

  const { data: after } = await alice.client
    .from('task_attachments')
    .select('id')
    .eq('id', attachment!.id)
  expect(after).toEqual([])
})

// ---------------------------------------------------------------------------
// Content limits
// ---------------------------------------------------------------------------

test('the size and MIME limits are enforced by the database', async () => {
  const tooBig = await reserveAttachment({ sizeBytes: 10485761 }) // one byte over 10 MiB
  expect(tooBig.error?.code).toBe('23514')

  const zero = await reserveAttachment({ sizeBytes: 0 })
  expect(zero.error?.code).toBe('23514')

  const exactly = await reserveAttachment({ sizeBytes: 10485760 }) // the boundary itself is allowed
  expect(exactly.error).toBeNull()
  await alice.client.from('task_attachments').delete().eq('id', exactly.id)

  const badMime = await reserveAttachment({ mimeType: 'text/html' })
  expect(badMime.error?.code).toBe('23514')

  const emptyName = await reserveAttachment({ filename: '' })
  expect(emptyName.error?.code).toBe('23514')
})

// ---------------------------------------------------------------------------
// storage.objects -- the file itself, authorized separately from its row
// ---------------------------------------------------------------------------

test('the attachments bucket is private, with the declared limits', async () => {
  // `public = false` is the entire reason the object policies mean anything: a public bucket
  // serves the file from its URL alone, with no policy consulted.
  const rows = await withPg(async (pg) => {
    const res = await pg.query<{
      public: boolean
      file_size_limit: string
      allowed_mime_types: string[]
    }>(
      `select public, file_size_limit, allowed_mime_types
         from storage.buckets where id = 'attachments'`,
    )
    return res.rows
  })

  expect(rows).toHaveLength(1)
  expect(rows[0].public).toBe(false)
  expect(Number(rows[0].file_size_limit)).toBe(10485760)
  expect(rows[0].allowed_mime_types).toContain('image/png')
  expect(rows[0].allowed_mime_types).not.toContain('text/html')
})

test('storage object policies name authenticated and are scoped to this bucket', async () => {
  // Scoping matters as much as the predicate: an object policy that forgot `bucket_id` would
  // widen every other bucket in the project, present and future.
  const rows = await withPg(async (pg) => {
    const res = await pg.query<{ polname: string; roles: string; expr: string }>(
      `select p.polname,
              coalesce((select string_agg(r.rolname, ',' order by r.rolname)
                          from pg_roles r where r.oid = any(p.polroles)), 'PUBLIC') as roles,
              coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
              coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as expr
         from pg_policy p
         join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'storage' and c.relname = 'objects'
          and p.polname like 'attachments_%'
        order by p.polname`,
    )
    return res.rows
  })

  expect(rows.map((r) => r.polname)).toEqual([
    'attachments_delete_editor',
    'attachments_select_member',
  ])

  for (const row of rows) {
    expect(row.roles).toBe('authenticated')
    expect(row.expr).toContain("bucket_id = 'attachments'")
    expect(row.expr).toContain('board_memberships')
    // Compared as text. A `::uuid` cast would raise 22P02 on a malformed path, turning a denial
    // into an error and leaking whether a prefix parsed.
    expect(row.expr).not.toContain('::uuid')
  }
})

test('object access follows board membership, by path prefix', async () => {
  // Driven through the **real storage API** with real JWTs, not by writing `storage.objects`
  // directly. Two reasons, and the second was measured rather than assumed:
  //
  //   - It is the path production uses, so it exercises the policies the way a client will.
  //   - Supabase forbids direct DML on the storage tables with a trigger ("Direct deletion from
  //     storage tables is not allowed"), so the direct route cannot even clean up after itself.
  const alicePath = `${aliceBoardId}/${aliceTaskId}/${crypto.randomUUID()}`
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], {
    type: 'image/png',
  })

  const directUpload = await alice.client.storage
    .from('attachments')
    .upload(alicePath, png, { contentType: 'image/png' })
  expect(directUpload.error).not.toBeNull()

  // The upload command is the only writer. Its service-role adapter bypasses object RLS after the
  // authenticated reservation RPC has checked Membership and quota atomically.
  const upload = await serviceClient()
    .storage.from('attachments')
    .upload(alicePath, png, { contentType: 'image/png' })
  expect(upload.error).toBeNull()

  // A non-member cannot read the object, even knowing its exact path.
  const bobRead = await bob.client.storage.from('attachments').download(alicePath)
  expect(bobRead.error).not.toBeNull()
  expect(bobRead.data).toBeNull()

  // A Viewer may read it -- objects follow the same role split as rows.
  await grantBob('viewer')
  const viewerRead = await bob.client.storage.from('attachments').download(alicePath)
  expect(viewerRead.error).toBeNull()
  expect(viewerRead.data).not.toBeNull()

  // ...but may not write under that prefix, nor delete what is there.
  const viewerWrite = await bob.client.storage
    .from('attachments')
    .upload(`${aliceBoardId}/${aliceTaskId}/${crypto.randomUUID()}`, png, {
      contentType: 'image/png',
    })
  expect(viewerWrite.error).not.toBeNull()

  // End the membership rather than deleting it, so this actually exercises `ended_at is null` on
  // the object policies. With a DELETE the download would fail because bob has no membership at
  // all, and dropping that clause from all four storage policies would not fail a single test.
  await endBobMembership()
  const afterEnded = await bob.client.storage.from('attachments').download(alicePath)
  expect(afterEnded.error).not.toBeNull()

  await revokeBob()
  await alice.client.storage.from('attachments').remove([alicePath])
})

test('an editor cannot upload into a board they do not belong to', async () => {
  // The object-side mirror of `task_attachments_insert_editor`'s `with check`: being an Editor
  // somewhere is not being an Editor here. Bob is an Owner of his own Board and nothing on alice's.
  const forgedPath = `${aliceBoardId}/${aliceTaskId}/${crypto.randomUUID()}`
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })

  const result = await bob.client.storage
    .from('attachments')
    .upload(forgedPath, png, { contentType: 'image/png' })
  expect(result.error).not.toBeNull()

  // And the file really is absent, rather than written and merely reported as failed.
  const check = await alice.client.storage.from('attachments').download(forgedPath)
  expect(check.error).not.toBeNull()
})

// ---------------------------------------------------------------------------
// Claims the migration makes that would otherwise have no coverage
// ---------------------------------------------------------------------------

test('uploaded_by is stamped from the verified command account, not supplied by the client', async () => {
  // "Attribution is evidence about a write, never a client assertion." Two halves, both asserted:
  // the column is absent from the INSERT grant, and a trigger fills it. An earlier draft of this
  // migration granted the column and had no trigger, so a caller could attribute their upload to
  // any account at all -- including one with no membership on the Board.
  const { data, error } = await reserveAttachment()
  expect(error).toBeNull()
  expect(data?.uploaded_by).toBe(alice.id)

  // Naming it is refused by the grant rather than quietly ignored.
  const forged = await alice.client
    .from('task_attachments')
    .insert(attachmentRow({ uploaded_by: bob.id }))
  expect(forged.error).not.toBeNull()

  await alice.client.from('task_attachments').delete().eq('id', data!.id)
})

test('only filename is updatable; the rest of the row is immutable', async () => {
  // The column-level UPDATE grant is the whole guarantee here -- a different file is a different
  // attachment. Without coverage, widening that grant later would break nothing visible.
  const data = await seedAttachment()

  const rename = await alice.client
    .from('task_attachments')
    .update({ filename: 'renamed.png' })
    .eq('id', data.id)
  expect(rename.error).toBeNull()

  for (const patch of [
    { board_id: bobBoardId },
    { task_id: crypto.randomUUID() },
    { mime_type: 'application/pdf' },
    { size_bytes: 4096 },
  ]) {
    const result = await alice.client.from('task_attachments').update(patch).eq('id', data.id)
    expect(result.error).not.toBeNull() // refused by the grant, not by RLS
  }

  await alice.client.from('task_attachments').delete().eq('id', data.id)
  await serviceClient().storage.from('attachments').remove([data.path])
})

test('authenticated cannot TRUNCATE the table', async () => {
  // TRUNCATE bypasses RLS entirely, and `pg_default_acl` inheritance from `postgres` grants it
  // unless a migration revokes it. `labels`, `feature_flags`, and `user_roles` all carry that
  // revoke; this asserts the new table does too. Not reachable through PostgREST -- defence in
  // depth, and exactly the kind of inherited grant #384 was about.
  const granted = await withPg(async (pg) => {
    const res = await pg.query<{ can: boolean }>(
      `select has_table_privilege('authenticated', 'public.task_attachments', 'TRUNCATE') as can`,
    )
    return res.rows[0].can
  })
  expect(granted).toBe(false)

  for (const role of ['anon', 'service_role'] as const) {
    const other = await withPg(async (pg) => {
      const res = await pg.query<{ can: boolean }>(
        `select has_table_privilege($1, 'public.task_attachments', 'TRUNCATE') as can`,
        [role],
      )
      return res.rows[0].can
    })
    expect(other).toBe(false)
  }
})

test('an object path that is not <board>/<task>/<file> is refused', async () => {
  // The policies require exactly two folder segments, so the path shape the migration documents is
  // actually enforced rather than merely described. The no-slash case is the important one: it is
  // where `storage.foldername` returns NULL, and the whole text-comparison argument rests on that
  // failing closed rather than erroring.
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })

  for (const path of [
    'loose.png', // no folder at all -- foldername yields NULL
    `${aliceBoardId}/only-one-segment.png`, // board but no task
    `${aliceBoardId}/${aliceTaskId}/nested/deeper.png`, // too many segments
  ]) {
    const result = await alice.client.storage
      .from('attachments')
      .upload(path, png, { contentType: 'image/png' })
    expect(result.error).not.toBeNull()
  }
})

test('direct object moves are denied even to editors', async () => {
  // Object identity is immutable. The upload command is the only writer, so no authenticated
  // client receives UPDATE access to storage.objects.
  const path = `${aliceBoardId}/${aliceTaskId}/${crypto.randomUUID()}`
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
  await serviceClient().storage.from('attachments').upload(path, png, { contentType: 'image/png' })

  await grantBob('viewer')
  const viewerMove = await bob.client.storage
    .from('attachments')
    .move(path, `${aliceBoardId}/${aliceTaskId}/${crypto.randomUUID()}`)
  expect(viewerMove.error).not.toBeNull()
  await revokeBob()

  // Owners cannot move within their own Board or across Boards either.
  const withinBoard = await alice.client.storage
    .from('attachments')
    .move(path, `${aliceBoardId}/${aliceTaskId}/${crypto.randomUUID()}`)
  expect(withinBoard.error).not.toBeNull()

  const crossBoard = await alice.client.storage
    .from('attachments')
    .move(path, `${bobBoardId}/${aliceTaskId}/${crypto.randomUUID()}`)
  expect(crossBoard.error).not.toBeNull()

  await alice.client.storage.from('attachments').remove([path])
})

// ---------------------------------------------------------------------------
// Undo's restore (#404)
// ---------------------------------------------------------------------------
// Undo re-inserts the rows a Task delete cascaded away, keeping their ids so the generated
// `storage_path` lands back on the file that was never deleted. Two database facts have to hold
// for that to work, and neither is reachable from a unit test.

test('an attachment row re-inserted with its original id addresses the surviving object', async () => {
  const { data: task } = await alice.client
    .from('tasks')
    .insert({ title: 'deleted then undone', board_id: aliceBoardId })
    .select('id')
    .single()

  const id = crypto.randomUUID()
  const { data: original, error: insertError } = await reserveAttachment({
    id,
    taskId: task!.id,
  })
  expect(insertError).toBeNull()

  const png = new Blob([pngBytes], { type: 'image/png' })
  const uploaded = await serviceClient()
    .storage.from('attachments')
    .upload(original!.storage_path, png, { contentType: 'image/png' })
  expect(uploaded.error).toBeNull()

  // The delete cascades the row away. The client deliberately leaves the object alone -- that is
  // the decision in `attachments.ts` that makes this restorable at all.
  await alice.client.from('tasks').delete().eq('id', task!.id)

  // Undo: the Task row first, with its original id, then the attachment.
  await alice.client
    .from('tasks')
    .insert({ id: task!.id, title: 'restored', board_id: aliceBoardId })
  const { data: restored, error: restoreError } = await alice.client
    .from('task_attachments')
    .insert(attachmentRow({ id, task_id: task!.id, size_bytes: pngBytes.byteLength }))
    .select('storage_path')
    .single()
  expect(restoreError).toBeNull()
  // Identical, because `storage_path` is generated from the id we kept.
  expect(restored?.storage_path).toBe(original!.storage_path)

  // And the file is still there, so the restored row is not describing a hole.
  const signed = await alice.client.storage
    .from('attachments')
    .createSignedUrl(restored!.storage_path, 60)
  expect(signed.error).toBeNull()

  await alice.client.storage.from('attachments').remove([restored!.storage_path])
  await alice.client.from('tasks').delete().eq('id', task!.id)
})

test('restoring a row that never left is ignored, not refused', async () => {
  // An undo entry covers every id its action touched, not only the ones deleted, so a restore can
  // include rows that are still present. `ignoreDuplicates` is how that becomes a no-op -- and it
  // is the only shape available, because UPDATE on this table grants `filename` alone: the update
  // half of a real upsert would be refused on `board_id`, `task_id`, `mime_type`, `size_bytes`.
  const id = crypto.randomUUID()
  const seeded = await seedAttachment({ id })

  const ignored = await alice.client
    .from('task_attachments')
    .upsert([attachmentRow({ id, filename: 'renamed.png', size_bytes: pngBytes.byteLength })], {
      onConflict: 'id',
      ignoreDuplicates: true,
    })
  expect(ignored.error).toBeNull()

  // Ignored means ignored: the existing row is untouched, not overwritten with the captured copy.
  const { data: after } = await alice.client
    .from('task_attachments')
    .select('filename')
    .eq('id', id)
    .single()
  expect(after?.filename).toBe('diagram.png')

  // The same statement without `ignoreDuplicates` is the shape that must NOT be used: PostgREST
  // resolves it as an UPDATE, which the column grants refuse.
  const merged = await alice.client
    .from('task_attachments')
    .upsert([attachmentRow({ id, filename: 'renamed.png', size_bytes: pngBytes.byteLength })], {
      onConflict: 'id',
    })
  expect(merged.error).not.toBeNull()

  await alice.client.from('task_attachments').delete().eq('id', id)
  await serviceClient().storage.from('attachments').remove([seeded.path])
})
