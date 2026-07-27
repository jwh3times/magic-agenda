import { renderHook, act, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

// Supabase query builders are lazy thenables: the HTTP request only fires when
// `.then()` / `await` runs. We model that here — `upsertThen` records whether the
// builder was actually executed, not merely constructed.
const h = vi.hoisted(() => {
  const upsertThen = vi.fn()
  const upsert = vi.fn(() => ({
    then: (onFulfilled: (r: { data: null; error: null }) => unknown) => {
      upsertThen()
      return Promise.resolve({ data: null, error: null }).then(onFulfilled)
    },
  }))
  const capture: {
    handler: ((p: unknown) => void) | null
    result: { data: unknown; error: unknown }
  } = {
    handler: null,
    result: { data: { theme: 'cork', default_view: 'calendar' }, error: null },
  }
  const maybeSingle = vi.fn(() => Promise.resolve(capture.result))
  const channel: Record<string, unknown> = {}
  channel.on = vi.fn((_e: string, _f: unknown, cb: (p: unknown) => void) => {
    capture.handler = cb
    return channel
  })
  channel.subscribe = vi.fn(() => channel)
  return { upsertThen, upsert, maybeSingle, capture, channel }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: h.maybeSingle })) })),
      upsert: h.upsert,
    })),
    channel: vi.fn(() => h.channel),
    removeChannel: vi.fn(),
  },
}))

import { useSettings } from './useSettings'

beforeEach(() => {
  h.upsertThen.mockClear()
  h.upsert.mockClear()
  h.capture.result = { data: { theme: 'cork', default_view: 'calendar' }, error: null }
})

test('saveTheme fires the upsert request so the theme persists across reloads', async () => {
  const { result } = renderHook(() => useSettings('user-1'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    result.current.saveTheme('brutal')
  })

  // The upsert must actually be executed (its `.then` invoked) — that is what sends
  // the request. `void <builder>` constructs the lazy thenable but never fires it.
  await waitFor(() => expect(h.upsertThen).toHaveBeenCalled())
  expect(h.upsert).toHaveBeenCalledWith(
    { user_id: 'user-1', theme: 'brutal', default_view: 'calendar' },
    { onConflict: 'user_id' },
  )
})

test('a settings change from another device is applied', async () => {
  const { result } = renderHook(() => useSettings('user-1'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    h.capture.handler!({
      eventType: 'UPDATE',
      new: { user_id: 'user-1', theme: 'glass', default_view: 'week' },
      old: {},
    })
  })
  expect(result.current.settings).toEqual({ theme: 'glass', defaultView: 'week' })
})

test('a remote settings event arriving right after a local save is suppressed', async () => {
  const { result } = renderHook(() => useSettings('user-1'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    result.current.saveTheme('brutal')
  })
  act(() => {
    h.capture.handler!({
      eventType: 'UPDATE',
      new: { user_id: 'user-1', theme: 'glass', default_view: 'week' },
      old: {},
    })
  })
  expect(result.current.settings).toEqual({ theme: 'brutal', defaultView: 'calendar' })
})

test('a failed load falls back to the snapshot, not to DEFAULTS', async () => {
  localStorage.setItem(
    'ma-snapshot-settings',
    JSON.stringify({ v: 1, userId: 'u1', settings: { theme: 'glass', defaultView: 'kanban' } }),
  )
  h.capture.result = { data: null, error: { message: 'FetchError: Failed to fetch' } }
  const { result } = renderHook(() => useSettings('u1'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.settings).toEqual({ theme: 'glass', defaultView: 'kanban' })
})

test('a failed load with no snapshot falls back to DEFAULTS', async () => {
  h.capture.result = { data: null, error: { message: 'FetchError: Failed to fetch' } }
  const { result } = renderHook(() => useSettings('u1'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.settings).toEqual({ theme: 'cork', defaultView: 'calendar' })
})

test('a genuinely empty row still means DEFAULTS, and is snapshotted', async () => {
  h.capture.result = { data: null, error: null }
  const { result } = renderHook(() => useSettings('u1'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.settings).toEqual({ theme: 'cork', defaultView: 'calendar' })
  expect(JSON.parse(localStorage.getItem('ma-snapshot-settings')!).settings.theme).toBe('cork')
})

test('saving a theme updates the snapshot', async () => {
  const { result } = renderHook(() => useSettings('u1'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  act(() => result.current.saveTheme('brutal'))
  expect(JSON.parse(localStorage.getItem('ma-snapshot-settings')!).settings.theme).toBe('brutal')
})
