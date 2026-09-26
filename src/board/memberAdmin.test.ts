import { beforeEach, expect, test, vi } from 'vitest'
import { boardFailure } from './outcome'

const rpc = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }))

const { changeMemberRole, classifyMemberAdminError, leaveBoard, removeMember } =
  await import('./memberAdmin')

beforeEach(() => {
  vi.clearAllMocks()
  rpc.mockResolvedValue({ data: null, error: null })
})

test('each command calls its RPC with the server’s parameter names', async () => {
  await changeMemberRole('m1', 'editor')
  await removeMember('m2')
  await leaveBoard('b1')
  expect(rpc.mock.calls).toEqual([
    ['change_member_role', { p_membership_id: 'm1', p_role: 'editor' }],
    ['remove_member', { p_membership_id: 'm2' }],
    ['leave_board', { p_board_id: 'b1' }],
  ])
})

test('success is an ok outcome', async () => {
  expect(await leaveBoard('b1')).toEqual({ ok: true, value: undefined })
})

test.each(['last-owner', 'membership-ended', 'not-owner', 'member-ended'] as const)(
  'the %s refusal maps to its own reason and copy',
  async (token) => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: token } })
    expect(await removeMember('m1')).toEqual({ ok: false, failure: boardFailure(token) })
  },
)

test('anything else is unknown, with its text kept', () => {
  expect(classifyMemberAdminError('invalid-role')).toEqual({
    reason: 'unknown',
    message: 'invalid-role',
  })
})

test('a thrown call is a value, not a rejection', async () => {
  rpc.mockRejectedValueOnce(new Error('Failed to fetch'))
  expect(await changeMemberRole('m1', 'viewer')).toEqual({
    ok: false,
    failure: { reason: 'unknown', message: 'Failed to fetch' },
  })
})
