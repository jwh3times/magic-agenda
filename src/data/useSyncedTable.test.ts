import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => {
  const capture: {
    payload: ((p: unknown) => void) | null
    status: ((s: string) => void) | null
    channelNames: string[]
    filters: unknown[]
  } = { payload: null, status: null, channelNames: [], filters: [] }
  const channel: Record<string, unknown> = {}
  channel.on = vi.fn((_e: string, filter: unknown, cb: (p: unknown) => void) => {
    capture.payload = cb
    capture.filters.push(filter)
    return channel
  })
  // Unlike the older per-hook mocks, this one does NOT auto-fire 'SUBSCRIBED': it hands the
  // status callback to the test, which is what makes the reconnect path reachable at all.
  channel.subscribe = vi.fn((cb?: (s: string) => void) => {
    capture.status = cb ?? null
    return channel
  })
  const channelFn = vi.fn((name: string) => {
    capture.channelNames.push(name)
    return channel
  })
  const removeChannel = vi.fn()
  return { capture, channel, channelFn, removeChannel }
})

vi.mock('../lib/supabase', () => ({
  supabase: { channel: h.channelFn, removeChannel: h.removeChannel },
}))

import {
  backoffDelay,
  rowIdOf,
  useOwnWrites,
  useSyncedTable,
  OWN_WRITE_TTL_MS,
} from './useSyncedTable'
import type { ChangePayload } from './useSyncedTable'

beforeEach(() => {
  h.capture.payload = null
  h.capture.status = null
  h.capture.channelNames = []
  h.capture.filters = []
  h.channelFn.mockClear()
  h.removeChannel.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

// ——— pure helpers ———

test('backoffDelay doubles and caps at 30s', () => {
  expect(backoffDelay(0)).toBe(1000)
  expect(backoffDelay(1)).toBe(2000)
  expect(backoffDelay(4)).toBe(16_000)
  expect(backoffDelay(5)).toBe(30_000) // 32s clamped
  expect(backoffDelay(50)).toBe(30_000)
})

test('rowIdOf reads `old` for DELETE and `new` otherwise', () => {
  // Not cosmetic: a DELETE payload carries ONLY the primary key (replica identity DEFAULT), so
  // `new` is empty and reading it would make every delete look like another client's write.
  const del = { eventType: 'DELETE', old: { id: 'a' }, new: {} } as unknown as ChangePayload
  const ins = { eventType: 'INSERT', old: {}, new: { id: 'b' } } as unknown as ChangePayload
  expect(rowIdOf(del, 'id')).toBe('a')
  expect(rowIdOf(ins, 'id')).toBe('b')
})

test('rowIdOf honours the table’s own primary key', () => {
  // tasks.id vs user_settings.user_id — the reason this could not stay inline in one hook.
  const p = { eventType: 'UPDATE', old: {}, new: { user_id: 'u1' } } as unknown as ChangePayload
  expect(rowIdOf(p, 'user_id')).toBe('u1')
  expect(rowIdOf(p, 'id')).toBeNull()
})

test('rowIdOf returns null rather than guessing on a malformed payload', () => {
  expect(rowIdOf({ eventType: 'INSERT', new: null } as unknown as ChangePayload, 'id')).toBeNull()
  expect(
    rowIdOf({ eventType: 'INSERT', new: { id: 42 } } as unknown as ChangePayload, 'id'),
  ).toBeNull()
})

// ——— the own-write registry ———

const update = (id: string, revision?: number) =>
  ({
    eventType: 'UPDATE',
    old: {},
    new: revision === undefined ? { id } : { id, revision },
  }) as unknown as ChangePayload
const deletion = (id: string) =>
  ({ eventType: 'DELETE', old: { id }, new: {} }) as unknown as ChangePayload

/** Screens payloads against one registry, recording everything it delivers, now or later. */
function registry() {
  const view = renderHook(() => useOwnWrites())
  const delivered: ChangePayload[] = []
  const screen = (p: ChangePayload) => {
    const id = rowIdOf(p, 'id')!
    const suppressed = view.result.current.screenEcho(p, id, (late) => delivered.push(late))
    if (!suppressed) delivered.push(p)
    return suppressed
  }
  return { ...view, delivered, screen }
}

const revisions = (payloads: ChangePayload[]) =>
  payloads.map((p) => (p.new as { revision?: number }).revision)

test('suppresses an echo inside the TTL and re-admits it after', () => {
  // The expiry half was never tested: the old suppression test only proved the inside-TTL case,
  // so a registry that never expired would have passed.
  vi.useFakeTimers()
  const { result, screen } = registry()
  act(() => result.current.markWrites(['a']))
  expect(screen(update('a'))).toBe(true)

  vi.advanceTimersByTime(OWN_WRITE_TTL_MS - 1)
  expect(screen(update('a'))).toBe(true)

  vi.advanceTimersByTime(2)
  expect(screen(update('a'))).toBe(false)
})

test('ignores null and undefined ids, and never claims an unknown id', () => {
  const { result, screen } = registry()
  act(() => result.current.markWrites(['a', null, undefined]))
  expect(screen(update('a'))).toBe(true)
  expect(screen(update('other'))).toBe(false)
})

test('sweeps expired entries so the registry cannot grow unbounded', () => {
  vi.useFakeTimers()
  const { result, screen } = registry()
  act(() => result.current.markWrites(['old']))
  vi.advanceTimersByTime(OWN_WRITE_TTL_MS + 1)
  act(() => result.current.markWrites(['new']))
  expect(screen(update('old'))).toBe(false)
  expect(screen(update('new'))).toBe(true)
})

// ——— revision-aware suppression (#432) ———

test('once a write settles, a newer revision inside the TTL is another writer’s and is delivered', () => {
  // The caveat this replaces: id-keyed suppression dropped a genuine concurrent edit for 5s.
  const { result, screen, delivered } = registry()
  act(() => result.current.markWrites(['t1']))
  act(() => result.current.settleWrites([{ id: 't1', revision: 4 }]))

  expect(screen(update('t1', 4))).toBe(true) // our own echo
  expect(screen(update('t1', 3))).toBe(true) // older than what we wrote
  expect(screen(update('t1', 5))).toBe(false) // someone else, after us
  expect(revisions(delivered)).toEqual([5])
})

test('an echo that beats the write’s response is held, then dropped when it proves to be ours', () => {
  const { result, screen, delivered } = registry()
  act(() => result.current.markWrites(['t1']))
  expect(screen(update('t1', 7))).toBe(true)
  act(() => result.current.settleWrites([{ id: 't1', revision: 7 }]))
  expect(delivered).toEqual([])
})

test('a foreign edit held during the round trip is delivered once the write settles older', () => {
  const { result, screen, delivered } = registry()
  act(() => result.current.markWrites(['t1']))
  expect(screen(update('t1', 7))).toBe(true)
  expect(screen(update('t1', 6))).toBe(true)
  act(() => result.current.settleWrites([{ id: 't1', revision: 5 }]))
  // Only the newest: an UPDATE payload carries the whole row, so it supersedes the one before it.
  expect(revisions(delivered)).toEqual([7])
})

test('an abandoned write releases what it held, since a failed write produced no echo', () => {
  const { result, screen, delivered } = registry()
  act(() => result.current.markWrites(['t1']))
  screen(update('t1', 3))
  act(() => result.current.abandonWrites(['t1']))
  expect(revisions(delivered)).toEqual([3])
  // Nothing of ours is outstanding any more, so nothing more is suppressed.
  expect(screen(update('t1', 4))).toBe(false)
})

test('overlapping writes to one row stay pending until every one settles', () => {
  const { result, screen, delivered } = registry()
  act(() => result.current.markWrites(['t1']))
  act(() => result.current.markWrites(['t1']))
  act(() => result.current.settleWrites([{ id: 't1', revision: 2 }]))
  // The second write's echo must not be mistaken for a foreign edit newer than the first.
  expect(screen(update('t1', 3))).toBe(true)
  act(() => result.current.settleWrites([{ id: 't1', revision: 3 }]))
  expect(delivered).toEqual([])
})

test('a DELETE is ours while a write is pending, and foreign once every write has settled', () => {
  // DELETE payloads carry only the primary key, so there is no revision to compare.
  const { result, screen } = registry()
  act(() => result.current.markWrites(['t1']))
  expect(screen(deletion('t1'))).toBe(true)
  act(() => result.current.settleWrites([{ id: 't1', revision: 2 }]))
  expect(screen(deletion('t1'))).toBe(false)
})

test('a table without a revision column keeps plain id suppression for the TTL', () => {
  // user_settings and labels: no revision, so settling has nothing to compare and changes nothing.
  const { result, screen } = registry()
  act(() => result.current.markWrites(['u1']))
  act(() => result.current.settleWrites([{ id: 'u1' }]))
  expect(screen(update('u1'))).toBe(true)
})

test('a write that never settles falls back to TTL suppression, dropping what it held', () => {
  vi.useFakeTimers()
  const { result, screen, delivered } = registry()
  act(() => result.current.markWrites(['t1']))
  expect(screen(update('t1', 9))).toBe(true)
  vi.advanceTimersByTime(OWN_WRITE_TTL_MS + 1)
  act(() => result.current.settleWrites([{ id: 't1', revision: 1 }]))
  expect(delivered).toEqual([])
})

// ——— the channel ———

function mount(over: Partial<Parameters<typeof useSyncedTable>[0]> = {}) {
  const reload = vi.fn()
  const onChange = vi.fn()
  const view = renderHook(() => {
    const { markWrites, settleWrites, screenEcho } = useOwnWrites()
    useSyncedTable({
      userId: 'u1',
      table: 'tasks',
      primaryKey: 'id',
      filterColumn: 'board_id',
      filterValue: 'b1',
      reload,
      onChange,
      screenEcho,
      ...over,
    })
    return { markWrites, settleWrites }
  })
  return { ...view, reload, onChange }
}

test('scopes the channel and the filter to the spec’s filter column', () => {
  // The filter used to be hardcoded to `user_id=eq.<userId>`. `tasks` is board-scoped now, so a
  // user-scoped subscription would deliver changes for every board the account belongs to —
  // including rows this client is not showing and, after the cutover, is not even loading.
  mount()
  expect(h.capture.channelNames).toEqual(['tasks-b1'])
  expect(h.capture.filters[0]).toMatchObject({
    event: '*',
    schema: 'public',
    table: 'tasks',
    filter: 'board_id=eq.b1',
  })
})

test('user_settings still scopes by user, because that is genuinely what scopes it', () => {
  // The filter is per-adapter, not "boards everywhere": Account Preferences really are account-wide.
  mount({
    table: 'user_settings',
    primaryKey: 'user_id',
    filterColumn: 'user_id',
    filterValue: 'u1',
  })
  expect(h.capture.channelNames).toEqual(['user_settings-u1'])
  expect(h.capture.filters[0]).toMatchObject({ table: 'user_settings', filter: 'user_id=eq.u1' })
})

test('opens no channel until the filter value resolves', () => {
  // The Board Directory settles asynchronously, so this hook mounts with no board selected. An
  // unfiltered subscription in that window would be the realtime twin of an unfiltered load.
  mount({ filterValue: '' })
  expect(h.channelFn).not.toHaveBeenCalled()
})

test('opens no channel and registers no catch-up while signed out', () => {
  const { reload } = mount({ userId: '' })
  expect(h.channelFn).not.toHaveBeenCalled()
  act(() => void window.dispatchEvent(new Event('online')))
  expect(reload).not.toHaveBeenCalled()
})

test('passes a remote change through but swallows this client’s own echo', () => {
  const { result, onChange } = mount()
  const payload = { eventType: 'UPDATE', old: {}, new: { id: 't1' } }

  act(() => h.capture.payload!(payload))
  expect(onChange).toHaveBeenCalledTimes(1)

  act(() => result.current.markWrites(['t1']))
  act(() => h.capture.payload!(payload))
  expect(onChange).toHaveBeenCalledTimes(1) // still 1 — suppressed
})

test('a payload with no usable id is passed through rather than dropped', () => {
  // Failing open is deliberate: dropping it would lose a real change, while passing it costs at
  // most a redundant reducer pass that returns the same state.
  const { onChange } = mount()
  act(() => h.capture.payload!({ eventType: 'INSERT', new: {} }))
  expect(onChange).toHaveBeenCalledTimes(1)
})

test('a channel error reloads immediately and resubscribes after the backoff', () => {
  // Previously unreachable: the per-hook mocks fired 'SUBSCRIBED' unconditionally, so no test in
  // the repo had ever executed this branch in either hook.
  vi.useFakeTimers()
  const { reload } = mount()
  expect(h.channelFn).toHaveBeenCalledTimes(1)

  act(() => h.capture.status!('CHANNEL_ERROR'))
  expect(reload).toHaveBeenCalledTimes(1) // immediate, not deferred to the backoff
  expect(h.channelFn).toHaveBeenCalledTimes(1) // not yet

  act(() => void vi.advanceTimersByTime(backoffDelay(0)))
  expect(h.channelFn).toHaveBeenCalledTimes(2) // fresh channel
  expect(h.removeChannel).toHaveBeenCalled() // old one torn down
})

test('backoff grows across consecutive failures and resets after a success', () => {
  vi.useFakeTimers()
  mount()

  act(() => h.capture.status!('TIMED_OUT'))
  act(() => void vi.advanceTimersByTime(backoffDelay(0)))
  act(() => h.capture.status!('CLOSED'))
  // Second failure waits longer than the first: at 1000ms nothing new has opened yet.
  act(() => void vi.advanceTimersByTime(backoffDelay(0)))
  expect(h.channelFn).toHaveBeenCalledTimes(2)
  act(() => void vi.advanceTimersByTime(backoffDelay(1) - backoffDelay(0)))
  expect(h.channelFn).toHaveBeenCalledTimes(3)

  // A successful subscribe resets the curve.
  act(() => h.capture.status!('SUBSCRIBED'))
  act(() => h.capture.status!('CHANNEL_ERROR'))
  act(() => void vi.advanceTimersByTime(backoffDelay(0)))
  expect(h.channelFn).toHaveBeenCalledTimes(4)
})

test('a held foreign edit is delivered through the channel when the write settles', () => {
  const { result, onChange } = mount()
  act(() => result.current.markWrites(['t1']))
  act(() => h.capture.payload!({ eventType: 'UPDATE', old: {}, new: { id: 't1', revision: 3 } }))
  expect(onChange).not.toHaveBeenCalled()
  act(() => result.current.settleWrites([{ id: 't1', revision: 2 }]))
  expect(onChange).toHaveBeenCalledTimes(1)
})

test('a held edit is not delivered to a channel that has since been torn down', () => {
  // Switching Boards replaces the channel; a late delivery would land on the wrong Board's state.
  const { result, onChange, unmount } = mount()
  act(() => result.current.markWrites(['t1']))
  act(() => h.capture.payload!({ eventType: 'UPDATE', old: {}, new: { id: 't1', revision: 3 } }))
  const { settleWrites } = result.current
  unmount()
  act(() => settleWrites([{ id: 't1', revision: 2 }]))
  expect(onChange).not.toHaveBeenCalled()
})

test('a backoff timer that fires after unmount does not resubscribe', () => {
  vi.useFakeTimers()
  const { unmount } = mount()
  act(() => h.capture.status!('CHANNEL_ERROR'))
  unmount()
  act(() => void vi.advanceTimersByTime(backoffDelay(0)))
  expect(h.channelFn).toHaveBeenCalledTimes(1)
})

test('catches up when the tab regains focus and when the network returns', () => {
  // Neither listener existed in useSettings at all, and useTasks' visibilitychange listener was
  // never dispatched by a test.
  const { reload } = mount()

  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
  act(() => void document.dispatchEvent(new Event('visibilitychange')))
  expect(reload).not.toHaveBeenCalled()

  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  act(() => void document.dispatchEvent(new Event('visibilitychange')))
  expect(reload).toHaveBeenCalledTimes(1)

  act(() => void window.dispatchEvent(new Event('online')))
  expect(reload).toHaveBeenCalledTimes(2)
})

test('removes the channel and its listeners on unmount', () => {
  const { unmount, reload } = mount()
  unmount()
  expect(h.removeChannel).toHaveBeenCalledTimes(1)
  act(() => void window.dispatchEvent(new Event('online')))
  expect(reload).not.toHaveBeenCalled()
})
