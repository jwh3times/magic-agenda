import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => {
  const query: Record<string, unknown> = {}
  const result = { data: [] as unknown[], error: null as { message: string } | null }
  for (const name of ['select', 'eq', 'gt']) query[name] = vi.fn(() => query)
  query.order = vi.fn(() => Promise.resolve(result))
  return { rpc: vi.fn(), from: vi.fn(() => query), query, result }
})

vi.mock('../lib/supabase', () => ({ supabase: { rpc: h.rpc, from: h.from } }))

const {
  acceptInvitation,
  classifyInvitationError,
  createInvitation,
  listPendingInvitations,
  previewInvitation,
} = await import('./invitations')

beforeEach(() => {
  vi.clearAllMocks()
  h.result.data = []
  h.result.error = null
})

test('create passes the server’s parameter names and returns the token', async () => {
  h.rpc.mockResolvedValue({ data: 'tok', error: null })
  expect(await createInvitation('b1', 'a@b.c', 'viewer')).toEqual({ ok: true, value: 'tok' })
  expect(h.rpc).toHaveBeenCalledWith('create_invitation', {
    p_board_id: 'b1',
    p_email: 'a@b.c',
    p_role: 'viewer',
  })
})

test.each([
  'membership-ended',
  'not-owner',
  'invalid-email',
  'invalid-role',
  'already-member',
  'already-invited',
  'too-many-pending',
  'rate-limited',
  'invitation-unavailable',
  'invitation-expired',
  'email-unverified',
  'email-mismatch',
])('the %s refusal becomes our own copy, never the raw token', (token) => {
  const failure = classifyInvitationError(token)
  expect(failure.reason).toBe(token)
  expect(failure.message).not.toBe(token)
  expect(failure.message.length).toBeGreaterThan(10)
})

test('anything else is unknown, with its text kept', () => {
  expect(classifyInvitationError('boom')).toEqual({ ok: false, reason: 'unknown', message: 'boom' })
})

test('a thrown call is a value, not a rejection', async () => {
  h.rpc.mockRejectedValue(new Error('Failed to fetch'))
  expect(await acceptInvitation('tok')).toEqual({
    ok: false,
    reason: 'unknown',
    message: 'Failed to fetch',
  })
})

test('the preview maps the server’s row', async () => {
  h.rpc.mockResolvedValue({
    data: [{ board_name: 'Team', inviter_name: 'Olive', role: 'viewer', expires_at: 'x' }],
    error: null,
  })
  expect(await previewInvitation('tok')).toEqual({
    ok: true,
    value: { boardName: 'Team', inviterName: 'Olive', role: 'viewer', expiresAt: 'x' },
  })
})

test('the pending list asks only for pending, unexpired rows, and drops emailless ones', async () => {
  h.result.data = [
    { id: 'i1', target_email: 'a@b.c', role: 'editor', expires_at: 'later' },
    { id: 'i2', target_email: null, role: 'editor', expires_at: 'later' },
  ]
  const now = new Date('2026-09-27T00:00:00Z')
  expect(await listPendingInvitations('b1', now)).toEqual({
    ok: true,
    value: [{ id: 'i1', email: 'a@b.c', role: 'editor', expiresAt: 'later' }],
  })
  expect(h.query.eq).toHaveBeenCalledWith('status', 'pending')
  expect(h.query.gt).toHaveBeenCalledWith('expires_at', now.toISOString())
})
