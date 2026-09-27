import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => {
  const capture: { rows: unknown[]; selectError: { message: string } | null; status: number } = {
    rows: [],
    selectError: null,
    status: 200,
  }
  const update = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }))
  const from = vi.fn()
  const realtime: { handler: ((p: unknown) => void) | null; filter: unknown } = {
    handler: null,
    filter: null,
  }
  const channel: Record<string, unknown> = {}
  channel.on = vi.fn((_e: string, filter: unknown, cb: (p: unknown) => void) => {
    realtime.handler = cb
    realtime.filter = filter
    return channel
  })
  channel.subscribe = vi.fn(() => channel)
  return { capture, update, from, realtime, channel }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    channel: vi.fn(() => h.channel),
    removeChannel: vi.fn(),
    from: h.from.mockImplementation(() => ({
      select: vi.fn(() => ({
        is: vi.fn(() => ({
          order: vi.fn(() =>
            Promise.resolve({
              data: h.capture.rows,
              error: h.capture.selectError,
              status: h.capture.status,
            }),
          ),
        })),
      })),
      update: h.update,
    })),
  },
}))

import { REVALIDATE_INTERVAL_MS, useBoardDirectory } from './useBoardDirectory'
import { readBoardSnapshot, writeBoardSnapshot } from '../data/snapshot'
import { NO_RECUR, type Task } from '../types/task'

const membershipRow = (boardId: string, over: Record<string, unknown> = {}) => ({
  id: `m-${boardId}`,
  board_id: boardId,
  role: 'owner',
  default_view: 'calendar',
  boards: { id: boardId, name: `Board ${boardId}` },
  ...over,
})

const task = (id: string): Task => ({
  id,
  title: id,
  description: '',
  labelId: null,
  assigneeId: null,
  color: 'yellow',
  checklist: [],
  status: 'todo',
  completedAt: null,
  reopenStatus: 'todo',
  archivedAt: null,
  day: '2026-08-14',
  atTime: null,
  pinned: false,
  order: 0,
  korder: 0,
  ...NO_RECUR,
})

beforeEach(() => {
  localStorage.clear()
  h.capture.rows = [membershipRow('b1')]
  h.capture.selectError = null
  h.capture.status = 200
  h.update.mockClear()
})

test('selects the account’s board and exposes its membership', async () => {
  const { result } = renderHook(() => useBoardDirectory('u1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.selectedBoardId).toBe('b1')
  expect(result.current.boards[0]).toMatchObject({ id: 'b1', role: 'owner', membershipId: 'm-b1' })
})

test('purges the snapshot of a board the server no longer returns', async () => {
  // The client-side half of revocation, wired end to end. Access ending is silent — the board just
  // stops coming back — so if this does not fire, the device keeps rendering content the account is
  // no longer entitled to, with no error anywhere to notice.
  writeBoardSnapshot('u1', 'b1', [task('kept')], [])
  writeBoardSnapshot('u1', 'revoked', [task('gone')], [])

  const { result } = renderHook(() => useBoardDirectory('u1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  expect(readBoardSnapshot('u1', 'b1')).not.toBeNull()
  expect(readBoardSnapshot('u1', 'revoked')).toBeNull()
})

test('a sessionless load purges nothing', async () => {
  // The case that makes the purge safe. A read with no session succeeds against RLS with `[]` and
  // no error, so treating it as "you are in no boards" would wipe every cached board on the
  // offline-boot path — destroying exactly the data that path exists to display.
  writeBoardSnapshot('u1', 'b1', [task('kept')], [])
  h.capture.rows = []

  const { result } = renderHook(() => useBoardDirectory('u1', false))
  await waitFor(() => expect(result.current.loading).toBe(false))

  expect(readBoardSnapshot('u1', 'b1')).not.toBeNull()
})

test('drops a board whose role this client does not recognise', async () => {
  // A client older than the schema. Showing the board while guessing at what may be done with it is
  // the mistake worth avoiding, so the fail-closed answer is to drop it entirely.
  h.capture.rows = [membershipRow('b1'), membershipRow('b2', { role: 'archivist' })]

  const { result } = renderHook(() => useBoardDirectory('u1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  expect(result.current.boards.map((b) => b.id)).toEqual(['b1'])
})

test('a failed load falls back to the remembered directory instead of erroring', async () => {
  const { result: first } = renderHook(() => useBoardDirectory('u1', true))
  await waitFor(() => expect(first.current.loading).toBe(false))

  h.capture.selectError = { message: 'FetchError: Failed to fetch' }
  h.capture.status = 0
  const { result } = renderHook(() => useBoardDirectory('u1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  expect(result.current.offline).toBe(true)
  expect(result.current.fallbackReason).toBe('network')
  expect(result.current.boards.map((b) => b.id)).toEqual(['b1'])
  expect(result.current.error).toBeNull()
})

test('an authentication failure keeps the directory snapshot without calling it offline', async () => {
  const { result: first } = renderHook(() => useBoardDirectory('u1', true))
  await waitFor(() => expect(first.current.loading).toBe(false))

  h.capture.selectError = { message: 'JWT expired' }
  h.capture.status = 401
  const { result } = renderHook(() => useBoardDirectory('u1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  expect(result.current.offline).toBe(true)
  expect(result.current.fallbackReason).toBe('auth')
  expect(result.current.boards.map((board) => board.id)).toEqual(['b1'])
  expect(result.current.error).toBe('JWT expired')
})

test('setDefaultView writes only the membership’s default_view', async () => {
  const { result } = renderHook(() => useBoardDirectory('u1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  await result.current.setDefaultView('b1', 'kanban')

  // The column-level grant is what stops this statement from touching `role`; asserting the payload
  // is what stops a future edit from quietly widening it past what the grant allows.
  expect(h.update).toHaveBeenCalledWith({ default_view: 'kanban' })
})

// ——— live revocation (#439) ———

const reads = () => h.from.mock.calls.length

test('subscribes to this Account’s own Membership rows', async () => {
  const { result } = renderHook(() => useBoardDirectory('u1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(h.realtime.filter).toMatchObject({
    table: 'board_memberships',
    filter: 'account_id=eq.u1',
  })
})

test('a revocation heard over Realtime drops the Board, names it, and never shows loading', async () => {
  h.capture.rows = [membershipRow('b1'), membershipRow('b2')]
  const { result } = renderHook(() => useBoardDirectory('u1', true))
  await waitFor(() => expect(result.current.boards).toHaveLength(2))
  const loadingSeen: boolean[] = []

  h.capture.rows = [membershipRow('b1')]
  act(() =>
    h.realtime.handler!({
      eventType: 'UPDATE',
      old: {},
      new: { id: 'm-b2', ended_at: '2026-09-26T12:00:00Z' },
    }),
  )
  loadingSeen.push(result.current.loading)
  await waitFor(() => expect(result.current.boards.map((b) => b.id)).toEqual(['b1']))
  // A background read must never flip `loading`: BoardPage would unmount the Board for a spinner.
  expect(loadingSeen).toEqual([false])
  expect(result.current.lostAccess).toBe('Board b2')

  act(() => result.current.dismissLostAccess())
  expect(result.current.lostAccess).toBeNull()
})

test('a load the user started never announces a Board as lost', async () => {
  h.capture.rows = [membershipRow('b1'), membershipRow('b2')]
  const { result } = renderHook(() => useBoardDirectory('u1', true))
  await waitFor(() => expect(result.current.boards).toHaveLength(2))
  h.capture.rows = [membershipRow('b1')]
  await act(() => result.current.reload())
  expect(result.current.boards).toHaveLength(1)
  expect(result.current.lostAccess).toBeNull()
})

test('a DELETE for a Membership this Account does not hold is ignored', async () => {
  // DELETE events fan out to every subscriber; a Board deleted anywhere must not cost a read here.
  const { result } = renderHook(() => useBoardDirectory('u1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const before = reads()
  act(() => h.realtime.handler!({ eventType: 'DELETE', old: { id: 'someone-elses' }, new: {} }))
  expect(reads()).toBe(before)

  act(() => h.realtime.handler!({ eventType: 'DELETE', old: { id: 'm-b1' }, new: {} }))
  await waitFor(() => expect(reads()).toBe(before + 1))
})

test('the heartbeat revalidates a visible tab in the background', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    const { result } = renderHook(() => useBoardDirectory('u1', true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const before = reads()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REVALIDATE_INTERVAL_MS)
    })
    expect(reads()).toBe(before + 1)
    expect(result.current.loading).toBe(false)
  } finally {
    vi.useRealTimers()
  }
})

test('the heartbeat stays quiet in a hidden tab', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    const { result } = renderHook(() => useBoardDirectory('u1', true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const before = reads()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REVALIDATE_INTERVAL_MS)
    })
    expect(reads()).toBe(before)
  } finally {
    vi.useRealTimers()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  }
})
