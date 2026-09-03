import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => {
  const capture: { rows: unknown[]; error: { message: string } | null; status: number } = {
    rows: [],
    error: null,
    status: 200,
  }
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => ({
          order: vi.fn(() =>
            Promise.resolve({ data: capture.rows, error: capture.error, status: capture.status }),
          ),
        })),
      })),
    })),
  }))
  // Labels joined the realtime publication in #188, so the hook now opens a channel. Same shape as
  // `useSettings.test.ts`: the mock hands the payload and status callbacks back to the test rather
  // than swallowing them, which is what makes a missing reconnect path visible.
  const realtime: { handler: ((p: unknown) => void) | null; status: ((s: string) => void) | null } =
    { handler: null, status: null }
  const channel: Record<string, unknown> = {}
  channel.on = vi.fn((_e: string, _f: unknown, cb: (p: unknown) => void) => {
    realtime.handler = cb
    return channel
  })
  channel.subscribe = vi.fn((cb?: (s: string) => void) => {
    realtime.status = cb ?? null
    return channel
  })
  const channelFn = vi.fn(() => channel)
  return { capture, from, realtime, channelFn, channelCount: () => channelFn.mock.calls.length }
})

vi.mock('../lib/supabase', () => ({
  supabase: { from: h.from, channel: h.channelFn, removeChannel: vi.fn() },
}))

import { readLabelSnapshot, writeLabelSnapshot } from '../data/snapshot'
import { useLabels } from './useLabels'

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  board_id: 'b1',
  name: `Label ${id}`,
  dot_color: '#2563eb',
  position: 0,
  ...over,
})

beforeEach(() => {
  localStorage.clear()
  h.capture.rows = [row('l1')]
  h.capture.error = null
  h.capture.status = 200
  h.from.mockClear()
  h.realtime.handler = null
  h.realtime.status = null
  h.channelFn.mockClear()
})

test('loads the selected Board’s labels and stores an offline snapshot', async () => {
  const { result } = renderHook(() => useLabels('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  expect(result.current.labels).toEqual([
    { id: 'l1', boardId: 'b1', name: 'Label l1', dotColor: '#2563eb', position: 0 },
  ])
  expect(result.current.offline).toBe(false)
  expect(readLabelSnapshot('u1', 'b1')?.labels).toEqual(result.current.labels)
})

test('falls back to the selected Board’s snapshot when loading fails', async () => {
  writeLabelSnapshot('u1', 'b1', [
    { id: 'cached', boardId: 'b1', name: 'Cached', dotColor: '#dc2626', position: 2 },
  ])
  h.capture.error = { message: 'FetchError: Failed to fetch' }
  h.capture.status = 0

  const { result } = renderHook(() => useLabels('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  expect(result.current.labels.map((label) => label.id)).toEqual(['cached'])
  expect(result.current.offline).toBe(true)
  expect(result.current.fallbackReason).toBe('network')
  expect(result.current.error).toBeNull()
})

test('an authentication failure keeps the Label snapshot without calling it offline', async () => {
  writeLabelSnapshot('u1', 'b1', [
    { id: 'cached', boardId: 'b1', name: 'Cached', dotColor: '#dc2626', position: 2 },
  ])
  h.capture.error = { message: 'JWT expired' }
  h.capture.status = 401

  const { result } = renderHook(() => useLabels('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  expect(result.current.labels.map((label) => label.id)).toEqual(['cached'])
  expect(result.current.offline).toBe(true)
  expect(result.current.fallbackReason).toBe('auth')
  expect(result.current.error).toBe('JWT expired')
})

test('a sessionless successful read never overwrites a Label snapshot', async () => {
  writeLabelSnapshot('u1', 'b1', [
    { id: 'cached', boardId: 'b1', name: 'Cached', dotColor: '#dc2626', position: 2 },
  ])
  h.capture.rows = []

  const { result } = renderHook(() => useLabels('u1', 'b1', false))
  await waitFor(() => expect(result.current.loading).toBe(false))

  expect(result.current.labels).toEqual([])
  expect(readLabelSnapshot('u1', 'b1')?.labels.map((label) => label.id)).toEqual(['cached'])
})

test('reloads labels when the browser comes back online', async () => {
  const { result } = renderHook(() => useLabels('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(h.from).toHaveBeenCalledTimes(1)

  h.capture.rows = [row('l2')]
  await act(() => {
    window.dispatchEvent(new Event('online'))
    return Promise.resolve()
  })
  await waitFor(() => expect(result.current.labels[0]?.id).toBe('l2'))
  expect(h.from).toHaveBeenCalledTimes(2)
})

test('a remote change is applied without a reload', async () => {
  const { result } = renderHook(() => useLabels('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(h.from).toHaveBeenCalledTimes(1)

  await act(() => {
    h.realtime.handler?.({
      eventType: 'INSERT',
      new: row('l2', { name: 'From elsewhere', position: 1 }),
      old: {},
    })
    return Promise.resolve()
  })

  expect(result.current.labels.map((l) => l.id)).toEqual(['l1', 'l2'])
  // The point of the channel: fresh without a round trip.
  expect(h.from).toHaveBeenCalledTimes(1)
})

test('a remote delete removes the definition, which is the edge #188 closed', async () => {
  const { result } = renderHook(() => useLabels('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(() => {
    // A DELETE payload carries only the primary key.
    h.realtime.handler?.({ eventType: 'DELETE', new: {}, old: { id: 'l1' } })
    return Promise.resolve()
  })

  // Before this, another surface kept offering a deleted Label until it was backgrounded, and the
  // save was then rejected by `tasks_label_same_board`.
  expect(result.current.labels).toEqual([])
})

test('the channel is Board-scoped, not account-scoped', async () => {
  const { result } = renderHook(() => useLabels('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  // An account-scoped subscription would deliver definitions for every Board the account belongs
  // to, including the ones this client is not showing.
  const [[topic]] = h.channelFn.mock.calls as unknown as [[string]]
  expect(topic).toContain('b1')
})

test('no channel is opened before the Board Directory resolves', async () => {
  const { result } = renderHook(() => useLabels('u1', '', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  // The realtime twin of an unfiltered load: an empty filter value must open nothing.
  expect(h.channelCount()).toBe(0)
})
