import { afterAll, beforeAll, expect, test } from 'vitest'
import { anonClient, createTestUser, currentBoardId, withPg, type TestUser } from './helpers'

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

// ---------------------------------------------------------------------------
// task_attachments rows
// ---------------------------------------------------------------------------

test('an owner can attach to their own task, and storage_path is derived', async () => {
  const { data, error } = await alice.client
    .from('task_attachments')
    .insert(attachmentRow())
    .select('id, storage_path, board_id, task_id')
    .single()

  expect(error).toBeNull()
  // The path is generated, never supplied. This is what ties the row to exactly one object.
  expect(data?.storage_path).toBe(`${aliceBoardId}/${aliceTaskId}/${data?.id}`)

  await alice.client.from('task_attachments').delete().eq('id', data!.id)
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

test('a non-member cannot read or write attachments on another board', async () => {
  const { data: seeded } = await alice.client
    .from('task_attachments')
    .insert(attachmentRow())
    .select('id')
    .single()

  const { data: read, error: readError } = await bob.client
    .from('task_attachments')
    .select('id')
    .eq('id', seeded!.id)
  expect(readError).toBeNull()
  expect(read).toEqual([]) // filtered, not errored -- RLS denies by returning no rows

  const { error: writeError } = await bob.client.from('task_attachments').insert(attachmentRow())
  expect(writeError).not.toBeNull()
  expect(writeError?.code).toBe('42501')

  await alice.client.from('task_attachments').delete().eq('id', seeded!.id)
})

test('a viewer may read an attachment row but not create or delete one', async () => {
  const { data: seeded } = await alice.client
    .from('task_attachments')
    .insert(attachmentRow())
    .select('id')
    .single()
  await grantBob('viewer')

  const { data: read } = await bob.client.from('task_attachments').select('id').eq('id', seeded!.id)
  expect(read).toHaveLength(1) // Viewers read. That is what Viewer means.

  const { error: insertError } = await bob.client.from('task_attachments').insert(attachmentRow())
  expect(insertError?.code).toBe('42501')

  // DELETE denies by filtering rather than erroring, so assert the row survived.
  await bob.client.from('task_attachments').delete().eq('id', seeded!.id)
  const { data: stillThere } = await alice.client
    .from('task_attachments')
    .select('id')
    .eq('id', seeded!.id)
  expect(stillThere).toHaveLength(1)

  await revokeBob()
  await alice.client.from('task_attachments').delete().eq('id', seeded!.id)
})

test('an editor may create and delete attachments', async () => {
  await grantBob('editor')

  const { data, error } = await bob.client
    .from('task_attachments')
    .insert(attachmentRow({ filename: 'from-editor.pdf', mime_type: 'application/pdf' }))
    .select('id')
    .single()
  expect(error).toBeNull()

  await bob.client.from('task_attachments').delete().eq('id', data!.id)
  const { data: gone } = await alice.client.from('task_attachments').select('id').eq('id', data!.id)
  expect(gone).toEqual([])

  await revokeBob()
})

test('a former member loses attachment access when their membership ends', async () => {
  // `ended_at is null` is the clause that carries this, in all four policies. Dropping it from any
  // one of them would leave every former member with access, and no other test here would notice.
  const { data: seeded } = await alice.client
    .from('task_attachments')
    .insert(attachmentRow())
    .select('id')
    .single()
  await grantBob('editor')

  const { data: whileMember } = await bob.client
    .from('task_attachments')
    .select('id')
    .eq('id', seeded!.id)
  expect(whileMember).toHaveLength(1) // sanity: the fixture actually granted access

  await endBobMembership()

  const { data: after } = await bob.client
    .from('task_attachments')
    .select('id')
    .eq('id', seeded!.id)
  expect(after).toEqual([])

  await revokeBob()
  await alice.client.from('task_attachments').delete().eq('id', seeded!.id)
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

  const { error } = await alice.client
    .from('task_attachments')
    .insert(attachmentRow({ task_id: bobTask!.id }))
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
  const { data: attachment } = await alice.client
    .from('task_attachments')
    .insert(attachmentRow({ task_id: task!.id }))
    .select('id')
    .single()

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
  const tooBig = await alice.client
    .from('task_attachments')
    .insert(attachmentRow({ size_bytes: 10485761 })) // one byte over 10 MiB
  expect(tooBig.error?.code).toBe('23514')

  const zero = await alice.client.from('task_attachments').insert(attachmentRow({ size_bytes: 0 }))
  expect(zero.error?.code).toBe('23514')

  const exactly = await alice.client
    .from('task_attachments')
    .insert(attachmentRow({ size_bytes: 10485760 })) // the boundary itself is allowed
    .select('id')
    .single()
  expect(exactly.error).toBeNull()
  await alice.client.from('task_attachments').delete().eq('id', exactly.data!.id)

  const badMime = await alice.client
    .from('task_attachments')
    .insert(attachmentRow({ mime_type: 'text/html' }))
  expect(badMime.error?.code).toBe('23514')

  const emptyName = await alice.client
    .from('task_attachments')
    .insert(attachmentRow({ filename: '' }))
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
    'attachments_insert_editor',
    'attachments_select_member',
    'attachments_update_editor',
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

  const upload = await alice.client.storage
    .from('attachments')
    .upload(alicePath, png, { contentType: 'image/png' })
  expect(upload.error).toBeNull() // an Owner may write under her own Board's prefix

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

test('uploaded_by is stamped from the session, not supplied by the client', async () => {
  // "Attribution is evidence about a write, never a client assertion." Two halves, both asserted:
  // the column is absent from the INSERT grant, and a trigger fills it. An earlier draft of this
  // migration granted the column and had no trigger, so a caller could attribute their upload to
  // any account at all -- including one with no membership on the Board.
  const { data, error } = await alice.client
    .from('task_attachments')
    .insert(attachmentRow())
    .select('id, uploaded_by')
    .single()
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
  const { data } = await alice.client
    .from('task_attachments')
    .insert(attachmentRow())
    .select('id')
    .single()

  const rename = await alice.client
    .from('task_attachments')
    .update({ filename: 'renamed.png' })
    .eq('id', data!.id)
  expect(rename.error).toBeNull()

  for (const patch of [
    { board_id: bobBoardId },
    { task_id: crypto.randomUUID() },
    { mime_type: 'application/pdf' },
    { size_bytes: 4096 },
  ]) {
    const result = await alice.client.from('task_attachments').update(patch).eq('id', data!.id)
    expect(result.error).not.toBeNull() // refused by the grant, not by RLS
  }

  await alice.client.from('task_attachments').delete().eq('id', data!.id)
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

test('a viewer cannot move an object, and an editor cannot move it across boards', async () => {
  // `attachments_update_editor` is justified as the thing that stops a file being renamed into
  // another Board's prefix. Nothing exercised it before.
  const path = `${aliceBoardId}/${aliceTaskId}/${crypto.randomUUID()}`
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
  await alice.client.storage.from('attachments').upload(path, png, { contentType: 'image/png' })

  await grantBob('viewer')
  const viewerMove = await bob.client.storage
    .from('attachments')
    .move(path, `${aliceBoardId}/${aliceTaskId}/${crypto.randomUUID()}`)
  expect(viewerMove.error).not.toBeNull()
  await revokeBob()

  // Alice may edit her own Board but has no membership on bob's, so the `with check` refuses the
  // destination even though the `using` side admits the source.
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
  const { data: original, error: insertError } = await alice.client
    .from('task_attachments')
    .insert(attachmentRow({ id, task_id: task!.id }))
    .select('storage_path')
    .single()
  expect(insertError).toBeNull()

  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
  const uploaded = await alice.client.storage
    .from('attachments')
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
    .insert(attachmentRow({ id, task_id: task!.id }))
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
  const { error: first } = await alice.client.from('task_attachments').insert(attachmentRow({ id }))
  expect(first).toBeNull()

  const ignored = await alice.client
    .from('task_attachments')
    .upsert([attachmentRow({ id, filename: 'renamed.png' })], {
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
    .upsert([attachmentRow({ id, filename: 'renamed.png' })], { onConflict: 'id' })
  expect(merged.error).not.toBeNull()

  await alice.client.from('task_attachments').delete().eq('id', id)
})
