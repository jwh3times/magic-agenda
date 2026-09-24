import { beforeEach, expect, test, vi } from 'vitest'

/**
 * The command and ordering contracts in `attachments.ts`, which are the substance of the module.
 *
 * Upload crosses one server command; deletion still removes the row before the object. These are
 * exactly the properties that look arbitrary in a diff and cost a permanently stranded file when
 * bypassed or reversed.
 */

const h = vi.hoisted(() => {
  const calls: string[] = []
  const state = {
    uploadError: null as { message: string } | null,
    insertError: null as { message: string } | null,
    deleteError: null as { message: string } | null,
    deleteMatches: true,
    removeFails: false,
    rows: [] as unknown[],
    insertedRow: null as Record<string, unknown> | null,
    /** Rows `captureTaskAttachments` pages through, keyed by nothing: it filters by task id. */
    captureRows: [] as Record<string, unknown>[],
    captureError: null as { message: string } | null,
    upsertError: null as { message: string } | null,
    countResult: { count: 2, error: null } as {
      count: number | null
      error: { message: string } | null
    },
    invokeResult: null as null | { ok: false; error: string },
    invokeError: null as null | { message: string },
  }

  /** `.select().in().order().range()` — the capture's paged read (#404). */
  const captureIn = vi.fn((_column: string, ids: string[]) => {
    calls.push(`capture:${ids.join(',')}`)
    return {
      order: () => ({
        range: (from: number, to: number) => {
          const matching = state.captureRows.filter((r) => ids.includes(r.task_id as string))
          return Promise.resolve(
            state.captureError
              ? { data: null, error: state.captureError }
              : { data: matching.slice(from, to + 1), error: null },
          )
        },
      }),
    }
  })

  const upsert = vi.fn((rows: Record<string, unknown>[], options: Record<string, unknown>) => {
    calls.push(`upsert:${rows.map((r) => r.id as string).join(',')}`)
    return Promise.resolve({ error: state.upsertError, options })
  })

  const upload = vi.fn((path: string) => {
    calls.push(`upload:${path}`)
    return Promise.resolve({ error: state.uploadError })
  })
  const invoke = vi.fn((_name: string, _options: { method: string; body: FormData }) => {
    calls.push('invoke')
    return Promise.resolve({
      data: state.invokeResult ?? { ok: true, attachment: state.insertedRow },
      error: state.invokeError,
    })
  })
  // storage-js RESOLVES its failures as `{ data: null, error }` -- including network errors, which
  // it wraps as StorageUnknownError -- and only throws for a non-StorageError. `shouldThrowOnError`
  // is not enabled on this client. An earlier version of these tests mocked a rejection, which
  // meant both "cleanup failed" tests passed against a path the real client cannot take.
  const remove = vi.fn((paths: string[]) => {
    calls.push(`remove:${paths.join(',')}`)
    return Promise.resolve({ error: state.removeFails ? { message: 'storage unavailable' } : null })
  })
  const createSignedUrl = vi.fn(() =>
    Promise.resolve({ data: { signedUrl: 'https://signed.example/x' }, error: null }),
  )

  const single = vi.fn(() => {
    calls.push('insert')
    return Promise.resolve(
      state.insertError
        ? { data: null, error: state.insertError }
        : { data: state.insertedRow, error: null },
    )
  })

  return { calls, state, upload, invoke, remove, createSignedUrl, single, captureIn, upsert }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() =>
          // Both a thenable and a builder: the Board count awaits `.eq()` directly, while
          // `listAttachments` chains `.order()` onto it.
          Object.assign(Promise.resolve(h.state.countResult), {
            order: vi.fn(() => Promise.resolve({ data: h.state.rows, error: null })),
          }),
        ),
        in: h.captureIn,
      })),
      upsert: h.upsert,
      insert: vi.fn(() => ({ select: vi.fn(() => ({ single: h.single })) })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => {
          h.calls.push('deleteRow')
          const result = {
            data: h.state.deleteMatches ? [{ id: 'a1' }] : [],
            error: h.state.deleteError,
          }
          // `.eq()` is awaited directly by the upload cleanup and chained with `.select()` by
          // removeAttachment, so it must be both a thenable and a builder.
          return Object.assign(Promise.resolve(result), {
            select: () => Promise.resolve(result),
          })
        }),
      })),
    })),
    storage: {
      from: vi.fn(() => ({
        upload: h.upload,
        remove: h.remove,
        createSignedUrl: h.createSignedUrl,
      })),
    },
    functions: { invoke: h.invoke },
  },
}))

import {
  captureTaskAttachments,
  countBoardAttachments,
  excludedAttachmentsNotice,
  listAttachments,
  removeAttachment,
  restoreAttachments,
  signedUrl,
  uploadAttachment,
  type Attachment,
} from './attachments'

const BOARD = '11111111-1111-4111-8111-111111111111'
const TASK = '22222222-2222-4222-8222-222222222222'

const row = (over: Record<string, unknown> = {}) => ({
  id: '33333333-3333-4333-8333-333333333333',
  task_id: TASK,
  board_id: BOARD,
  storage_path: `${BOARD}/${TASK}/33333333-3333-4333-8333-333333333333`,
  filename: 'diagram.png',
  mime_type: 'image/png',
  size_bytes: 2048,
  uploaded_by: 'someone',
  created_at: '2026-09-19T00:00:00Z',
  ...over,
})

const pngFile = (over: Partial<{ name: string; size: number; type: string }> = {}) => {
  const spec = { name: 'diagram.png', size: 2048, type: 'image/png', ...over }
  return new File([new Uint8Array(spec.size)], spec.name, { type: spec.type })
}

beforeEach(() => {
  h.calls.length = 0
  h.state.uploadError = null
  h.state.insertError = null
  h.state.deleteError = null
  h.state.deleteMatches = true
  h.state.removeFails = false
  h.state.rows = []
  h.state.insertedRow = row()
  h.state.captureRows = []
  h.state.captureError = null
  h.state.upsertError = null
  h.state.countResult = { count: 2, error: null }
  h.state.invokeResult = null
  h.state.invokeError = null
  h.upload.mockClear()
  h.invoke.mockClear()
  h.remove.mockClear()
  h.captureIn.mockClear()
  h.upsert.mockClear()
})

test('rows are mapped out of snake_case', async () => {
  h.state.rows = [row()]
  const [attachment] = await listAttachments(TASK)
  expect(attachment).toEqual({
    id: '33333333-3333-4333-8333-333333333333',
    taskId: TASK,
    boardId: BOARD,
    storagePath: `${BOARD}/${TASK}/33333333-3333-4333-8333-333333333333`,
    filename: 'diagram.png',
    mimeType: 'image/png',
    sizeBytes: 2048,
    uploadedBy: 'someone',
    createdAt: '2026-09-19T00:00:00Z',
  })
})

test('upload crosses the attachment command and returns its authoritative row', async () => {
  const file = pngFile()
  const attachment = await uploadAttachment(BOARD, TASK, file)

  expect(h.invoke).toHaveBeenCalledOnce()
  const [functionName, options] = h.invoke.mock.calls[0]
  expect(functionName).toBe('upload-attachment')
  expect(options.method).toBe('POST')
  const body = options.body
  expect(body.get('boardId')).toBe(BOARD)
  expect(body.get('taskId')).toBe(TASK)
  expect(body.get('file')).toBe(file)
  expect(attachment).toEqual({
    id: '33333333-3333-4333-8333-333333333333',
    taskId: TASK,
    boardId: BOARD,
    storagePath: `${BOARD}/${TASK}/33333333-3333-4333-8333-333333333333`,
    filename: 'diagram.png',
    mimeType: 'image/png',
    sizeBytes: 2048,
    uploadedBy: 'someone',
    createdAt: '2026-09-19T00:00:00Z',
  })
  expect(h.upload).not.toHaveBeenCalled()
})

test('a command refusal reaches the attachment UI as its domain message', async () => {
  h.state.invokeResult = {
    ok: false,
    error: 'This Board has reached its 100 MiB attachment limit.',
  }
  await expect(uploadAttachment(BOARD, TASK, pngFile())).rejects.toThrow('100 MiB')
})

test('a function transport failure is surfaced', async () => {
  h.state.invokeError = { message: 'network down' }
  await expect(uploadAttachment(BOARD, TASK, pngFile())).rejects.toThrow('network down')
})

test('an invalid file is refused without touching storage', async () => {
  await expect(uploadAttachment(BOARD, TASK, pngFile({ type: 'text/html' }))).rejects.toThrow(
    /PNG, JPEG/,
  )
  expect(h.upload).not.toHaveBeenCalled()
})

test('delete removes the row BEFORE the object, the opposite of Board deletion', async () => {
  // Deliberate and worth pinning: the Board survives here, so the caller keeps the membership that
  // authorizes the object delete and a leftover object stays deletable. Row first means the UI
  // never shows an attachment whose file is already gone.
  const attachment = {
    id: 'a1',
    storagePath: `${BOARD}/${TASK}/a1`,
  } as Attachment
  await removeAttachment(attachment)
  expect(h.calls).toEqual(['deleteRow', `remove:${BOARD}/${TASK}/a1`])
})

test('a failed row delete does not remove the object', async () => {
  h.state.deleteError = { message: 'refused' }
  await expect(
    removeAttachment({ id: 'a1', storagePath: `${BOARD}/${TASK}/a1` } as Attachment),
  ).rejects.toThrow('refused')
  expect(h.remove).not.toHaveBeenCalled()
})

test('a DELETE that matches no row is reported as a refusal, not a success', async () => {
  // RLS denies a DELETE by matching zero rows, not by erroring. Without `.select()` a Viewer's
  // remove would return success, the object removal would be refused and ignored, and the
  // attachment would silently reappear on the next load with no explanation.
  h.state.deleteMatches = false
  await expect(
    removeAttachment({ id: 'a1', storagePath: `${BOARD}/${TASK}/a1` } as Attachment),
  ).rejects.toThrow(/do not have permission/)
  expect(h.remove).not.toHaveBeenCalled()
})

test('a failed object removal is not surfaced', async () => {
  // The row is gone, which is what the user asked for. The orphan is accepted by the issue, and
  // storage-js reports this as a resolved `{ error }` rather than a rejection.
  h.state.removeFails = true
  await expect(
    removeAttachment({ id: 'a1', storagePath: `${BOARD}/${TASK}/a1` } as Attachment),
  ).resolves.toBeUndefined()
})

test('a signed URL failure degrades to null rather than throwing', async () => {
  h.createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'nope' } } as never)
  expect(await signedUrl('b/t/a')).toBeNull()
})

// ——— the undo capture and restore (#404) ———

const captureRow = (id: string, taskId: string) => row({ id, task_id: taskId })

test('a capture pages until a short page, because a full one may be the API cap', async () => {
  // The same trap `loadBoardTasks` pages around: PostgREST answers 200 with fewer rows than exist.
  h.state.captureRows = Array.from({ length: 1001 }, (_, i) =>
    captureRow(`id-${String(i).padStart(4, '0')}`, TASK),
  )
  const captured = await captureTaskAttachments([TASK])
  expect(captured).toHaveLength(1001)
  expect(h.captureIn).toHaveBeenCalledTimes(2)
})

test('a capture chunks its task ids, which travel in the URL', async () => {
  const ids = Array.from({ length: 51 }, (_, i) => `task-${i}`)
  h.state.captureRows = [captureRow('a1', 'task-50')]
  const captured = await captureTaskAttachments(ids)
  // Chunked, and every chunk asked for: the 51st id is in the second request, and its row is here.
  expect(h.captureIn).toHaveBeenCalledTimes(2)
  expect(captured.map((a) => a.id)).toEqual(['a1'])
})

test('a failed capture yields no rows rather than throwing', async () => {
  // The caller is mid-delete. A read that cannot answer must cost the undo its attachments, never
  // cost the user their delete.
  h.state.captureError = { message: 'read timed out' }
  await expect(captureTaskAttachments([TASK])).resolves.toEqual([])
})

test('an empty capture asks the server nothing', async () => {
  await captureTaskAttachments([])
  expect(h.captureIn).not.toHaveBeenCalled()
})

test('a restore re-inserts the captured id, so the row addresses the file that survived', async () => {
  const captured: Attachment[] = [
    {
      id: 'a1',
      taskId: TASK,
      boardId: BOARD,
      storagePath: `${BOARD}/${TASK}/a1`,
      filename: 'diagram.png',
      mimeType: 'image/png',
      sizeBytes: 2048,
      uploadedBy: 'someone',
      createdAt: '2026-09-19T00:00:00Z',
    },
  ]
  await restoreAttachments(captured)
  const [rows, options] = h.upsert.mock.calls[0]
  // `storage_path` is generated from `id`, so the original id is the whole point: a new one would
  // produce a row pointing at an object that was never written.
  expect(rows).toEqual([
    {
      id: 'a1',
      board_id: BOARD,
      task_id: TASK,
      filename: 'diagram.png',
      mime_type: 'image/png',
      size_bytes: 2048,
    },
  ])
  // Neither `storage_path` nor `uploaded_by` is sent: one is generated, the other is stamped.
  expect(Object.keys(rows[0])).not.toContain('storage_path')
  expect(Object.keys(rows[0])).not.toContain('uploaded_by')
  // ON CONFLICT DO NOTHING. An entry covers ids the action touched, not only the ones it deleted,
  // so a row that never left must be a no-op -- and UPDATE on this table grants `filename` alone,
  // which is why a real upsert could not be used even if a conflict were wanted.
  expect(options).toEqual({ onConflict: 'id', ignoreDuplicates: true })
})

test('an empty restore writes nothing', async () => {
  await restoreAttachments([])
  expect(h.upsert).not.toHaveBeenCalled()
})

test('a failed restore is surfaced, unlike a failed capture', async () => {
  // The Task is already back by this point. Silently dropping its attachments again would be the
  // bug this fix exists to remove.
  h.state.upsertError = { message: 'insert refused' }
  await expect(restoreAttachments([{ id: 'a1' } as Attachment])).rejects.toThrow('insert refused')
})

/**
 * The export dialog's attachment count (#398).
 *
 * The count is asked of the server rather than derived from rows, and these tests pin that: a
 * length would be a floor, because PostgREST caps a response at `max_rows` and still returns
 * success -- the trap `loadBoardTasks` pages around.
 */
test('the Board attachment count comes from the server, not from a row length', async () => {
  h.state.countResult = { count: 2, error: null }
  // Rows are deliberately left empty. A count read asks for no rows at all, so an implementation
  // that counted `data` would answer 0 here and pass a naive test that seeded rows to match.
  h.state.rows = []
  expect(await countBoardAttachments('b1')).toBe(2)
})

test('a failed count is null rather than a throw or a zero', async () => {
  // Zero would be a lie the export dialog then tells the user, and a throw would have to be caught
  // at a call site whose static copy is already true without the number.
  h.state.countResult = { count: null, error: { message: 'refused' } }
  expect(await countBoardAttachments('b1')).toBeNull()
})

test('a successful count with no count header is also null', async () => {
  // PostgREST omits the header unless asked; treating a missing count as 0 would be the same lie.
  h.state.countResult = { count: null, error: null }
  expect(await countBoardAttachments('b1')).toBeNull()
})

test('a response with no count header at all is null, not undefined', async () => {
  // supabase-js types `count` as `number | null`, so a `=== null` guard typechecks and still lets
  // `undefined` through — straight into the dialog copy as the word "undefined". The guard is
  // `typeof` for exactly this.
  h.state.countResult = {} as { count: number | null; error: { message: string } | null }
  expect(await countBoardAttachments('b1')).toBeNull()
})

test('the notice names the count, and stays silent when there is nothing to name', () => {
  expect(excludedAttachmentsNotice(3)).toContain('3 attachments')
  expect(excludedAttachmentsNotice(1)).toContain('1 attachment,')
  // Zero and unknown are both silence, for different reasons: nothing to lose, versus a static
  // sentence that is already true and that a guess would falsify.
  expect(excludedAttachmentsNotice(0)).toBeNull()
  expect(excludedAttachmentsNotice(null)).toBeNull()
  expect(excludedAttachmentsNotice(undefined as unknown as null)).toBeNull()
})
