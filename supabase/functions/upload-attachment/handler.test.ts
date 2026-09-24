import { assertEquals } from 'jsr:@std/assert@1'
import {
  createHandler,
  type AttachmentRow,
  UploadAttachmentRefusal,
  type UploadAttachmentGateway,
} from './handler.ts'

const BOARD = '11111111-1111-4111-8111-111111111111'
const TASK = '22222222-2222-4222-8222-222222222222'

const attachment: AttachmentRow = {
  id: '33333333-3333-4333-8333-333333333333',
  board_id: BOARD,
  task_id: TASK,
  storage_path: `${BOARD}/${TASK}/33333333-3333-4333-8333-333333333333`,
  filename: 'diagram.png',
  mime_type: 'image/png',
  size_bytes: 8,
  uploaded_by: '44444444-4444-4444-8444-444444444444',
  created_at: '2026-09-24T12:00:00Z',
}

const gateway: UploadAttachmentGateway = {
  upload: () => Promise.resolve(attachment),
}

const authenticate = () => Promise.resolve({ id: '44444444-4444-4444-8444-444444444444' })

Deno.test('an authenticated multipart upload returns the authoritative attachment', async () => {
  const body = new FormData()
  body.set('boardId', BOARD)
  body.set('taskId', TASK)
  body.set(
    'file',
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'diagram.png', {
      type: 'image/png',
    }),
  )

  const response = await createHandler({ authenticate, gateway })(
    new Request('http://localhost/', { method: 'POST', body }),
  )

  assertEquals(response.status, 200)
  assertEquals(await response.json(), { ok: true, attachment })
})

Deno.test('a Board byte-quota refusal is returned as a stable domain result', async () => {
  const refusing: UploadAttachmentGateway = {
    upload: () =>
      Promise.reject(
        new UploadAttachmentRefusal('This Board has reached its 100 MiB attachment limit.'),
      ),
  }
  const body = new FormData()
  body.set('boardId', BOARD)
  body.set('taskId', TASK)
  body.set(
    'file',
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'tiny.png', {
      type: 'image/png',
    }),
  )

  const response = await createHandler({ authenticate, gateway: refusing })(
    new Request('http://localhost/', { method: 'POST', body }),
  )

  assertEquals(response.status, 200)
  assertEquals(await response.json(), {
    ok: false,
    error: 'This Board has reached its 100 MiB attachment limit.',
  })
})

Deno.test('the command refuses a file whose bytes are not an allowed type', async () => {
  let calls = 0
  const observing: UploadAttachmentGateway = {
    upload: () => {
      calls++
      return Promise.resolve(attachment)
    },
  }
  const body = new FormData()
  body.set('boardId', BOARD)
  body.set('taskId', TASK)
  body.set(
    'file',
    new File(['not really an image'], 'forged.png', {
      type: 'image/png',
    }),
  )

  const response = await createHandler({ authenticate, gateway: observing })(
    new Request('http://localhost/', { method: 'POST', body }),
  )

  assertEquals(await response.json(), {
    ok: false,
    error: 'That file is not a PNG, JPEG, GIF, WebP, or PDF.',
  })
  assertEquals(calls, 0)
})
