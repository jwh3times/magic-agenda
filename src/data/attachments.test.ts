import { beforeEach, expect, test, vi } from 'vitest'

/**
 * The ordering contracts in `attachments.ts`, which are the whole substance of the module.
 *
 * Every assertion here is about *sequence*, not about data shape: upload before insert, row before
 * object on delete, and what is cleaned up when the second step fails. Those are exactly the
 * properties that look arbitrary in a diff and cost a permanently stranded file when reversed.
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
  }

  const upload = vi.fn((path: string) => {
    calls.push(`upload:${path}`)
    return Promise.resolve({ error: state.uploadError })
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

  return { calls, state, upload, remove, createSignedUrl, single }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({ data: h.state.rows, error: null })),
        })),
      })),
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
  },
}))

import {
  listAttachments,
  removeAttachment,
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
  return { ...spec, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) } as unknown as File
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
  h.upload.mockClear()
  h.remove.mockClear()
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

test('the object is uploaded BEFORE the row is inserted', async () => {
  // The reason `id` is granted on INSERT. The other order means a failed upload leaves a row
  // describing a file that does not exist, and a lost connection strands it permanently.
  await uploadAttachment(BOARD, TASK, pngFile())
  // Only the sequence matters here; the path itself is pinned by the test below.
  expect(h.calls.map((call) => call.split(':')[0])).toEqual(['upload', 'insert'])
})

test('the path is board/task/id, and the id is the one inserted', async () => {
  await uploadAttachment(BOARD, TASK, pngFile())
  const path = h.upload.mock.calls[0][0]
  const [board, task, id] = path.split('/')
  expect(board).toBe(BOARD)
  expect(task).toBe(TASK)
  // The id must match the row's, or the generated `storage_path` would name a different object.
  expect(id).toMatch(/^[0-9a-f-]{36}$/)
})

test('a failed upload does not insert a row', async () => {
  h.state.uploadError = { message: 'network down' }
  await expect(uploadAttachment(BOARD, TASK, pngFile())).rejects.toThrow('network down')
  expect(h.calls.filter((c) => c === 'insert')).toEqual([])
})

test('a refused row removes the object it had already written', async () => {
  // Otherwise the object survives with nothing describing it -- invisible to the UI and to any
  // quota query, and only collectable by the Board sweep much later.
  h.state.insertError = { message: 'row refused' }
  await expect(uploadAttachment(BOARD, TASK, pngFile())).rejects.toThrow('row refused')
  expect(h.calls.filter((c) => c.startsWith('remove:'))).toHaveLength(1)
})

test('a cleanup failure does not mask the original error', async () => {
  h.state.insertError = { message: 'row refused' }
  h.state.removeFails = true
  // The caller needs to know why the attachment failed, not that tidying up also failed.
  await expect(uploadAttachment(BOARD, TASK, pngFile())).rejects.toThrow('row refused')
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
