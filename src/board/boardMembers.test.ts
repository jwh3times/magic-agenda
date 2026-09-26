import { beforeEach, expect, test, vi } from 'vitest'
import { boardFailure } from './outcome'

const rpc = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }))

const { fakeListBoardMembers, listBoardMembers, toBoardMembers } = await import('./boardMembers')
type BoardMember = import('./boardMembers').BoardMember

const row = (over: Record<string, unknown> = {}) => ({
  membership_id: 'm1',
  account_id: 'a1',
  role: 'owner',
  display_name: 'Ada',
  joined_at: '2026-09-26T10:00:00Z',
  email: 'ada@example.test',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
})

test('asks the board_members RPC for the named Board', async () => {
  rpc.mockResolvedValue({ data: [row()], error: null })
  await listBoardMembers('b1')
  expect(rpc).toHaveBeenCalledWith('board_members', { p_board_id: 'b1' })
})

test('maps rows to members in the server’s order', async () => {
  rpc.mockResolvedValue({
    data: [row(), row({ membership_id: 'm2', account_id: 'a2', role: 'viewer', email: null })],
    error: null,
  })
  expect(await listBoardMembers('b1')).toEqual({
    ok: true,
    value: [
      {
        membershipId: 'm1',
        accountId: 'a1',
        role: 'owner',
        displayName: 'Ada',
        joinedAt: '2026-09-26T10:00:00Z',
        email: 'ada@example.test',
      },
      {
        membershipId: 'm2',
        accountId: 'a2',
        role: 'viewer',
        displayName: 'Ada',
        joinedAt: '2026-09-26T10:00:00Z',
        email: null,
      },
    ],
  })
})

test('drops a role this client does not know rather than defaulting it', () => {
  // Defaulting would invent an authority level nobody granted.
  expect(toBoardMembers([row(), row({ membership_id: 'm9', role: 'admin' })])).toHaveLength(1)
})

test('an empty answer means the caller has no current Membership', async () => {
  // A current member always sees at least their own row.
  rpc.mockResolvedValue({ data: [], error: null })
  expect(await listBoardMembers('b1')).toEqual({
    ok: false,
    failure: boardFailure('membership-ended'),
  })
})

test('errors and throws are values, never rejections', async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } })
  expect(await listBoardMembers('b1')).toEqual({
    ok: false,
    failure: { reason: 'unknown', message: 'permission denied' },
  })
  rpc.mockRejectedValueOnce(new Error('Failed to fetch'))
  expect(await listBoardMembers('b1')).toEqual({
    ok: false,
    failure: { reason: 'unknown', message: 'Failed to fetch' },
  })
})

const member = (over: Partial<BoardMember>): BoardMember => ({
  membershipId: 'm1',
  accountId: 'a1',
  role: 'owner',
  displayName: '',
  joinedAt: '2026-09-26T10:00:00Z',
  email: 'a1@example.test',
  ...over,
})

test('the fake applies the server’s email rule and refuses a non-member', async () => {
  const members = [
    member({}),
    member({ membershipId: 'm2', accountId: 'a2', role: 'editor', email: 'a2@example.test' }),
  ]
  const asOwner = await fakeListBoardMembers(members, 'a1')('b1')
  const asEditor = await fakeListBoardMembers(members, 'a2')('b1')
  const asStranger = await fakeListBoardMembers(members, 'a3')('b1')
  expect(asOwner.ok && asOwner.value.map((m) => m.email)).toEqual([
    'a1@example.test',
    'a2@example.test',
  ])
  expect(asEditor.ok && asEditor.value.map((m) => m.email)).toEqual([null, null])
  expect(asStranger).toEqual({ ok: false, failure: boardFailure('membership-ended') })
})
