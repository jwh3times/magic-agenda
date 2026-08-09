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

test('suppresses an echo inside the TTL and re-admits it after', () => {
  // The expiry half was never tested: the old suppression test only proved the inside-TTL case,
  // so a registry that never expired would have passed.
  vi.useFakeTimers()
  const { result } = renderHook(() => useOwnWrites())
  act(() => result.current.markWrites(['a']))
  expect(result.current.isOwnWrite('a')).toBe(true)

  vi.advanceTimersByTime(OWN_WRITE_TTL_MS - 1)
  expect(result.current.isOwnWrite('a')).toBe(true)

  vi.advanceTimersByTime(2)
  expect(result.current.isOwnWrite('a')).toBe(false)
})

test('ignores null and undefined ids, and never claims an unknown id', () => {
  const { result } = renderHook(() => useOwnWrites())
  act(() => result.current.markWrites(['a', null, undefined]))
  expect(result.current.isOwnWrite('a')).toBe(true)
  expect(result.current.isOwnWrite('other')).toBe(false)
})

test('sweeps expired entries so the registry cannot grow unbounded', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useOwnWrites())
  act(() => result.current.markWrites(['old']))
  vi.advanceTimersByTime(OWN_WRITE_TTL_MS + 1)
  act(() => result.current.markWrites(['new']))
  expect(result.current.isOwnWrite('old')).toBe(false)
  expect(result.current.isOwnWrite('new')).toBe(true)
})

// ——— the channel ———

function mount(over: Partial<Parameters<typeof useSyncedTable>[0]> = {}) {
  const reload = vi.fn()
  const onChange = vi.fn()
  const view = renderHook(() => {
    const { markWrites, isOwnWrite } = useOwnWrites()
    useSyncedTable({
      userId: 'u1',
      table: 'tasks',
      primaryKey: 'id',
      reload,
      onChange,
      isOwnWrite,
      ...over,
    })
    return { markWrites }
  })
  return { ...view, reload, onChange }
}

test('opens a per-user channel scoped to that user’s rows', () => {
  mount()
  expect(h.capture.channelNames).toEqual(['tasks-u1'])
  expect(h.capture.filters[0]).toMatchObject({
    event: '*',
    schema: 'public',
    table: 'tasks',
    filter: 'user_id=eq.u1',
  })
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
