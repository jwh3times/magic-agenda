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
  const { result } = renderHook(() => useSettings('user-1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    result.current.saveTheme('brutal')
  })

  // The upsert must actually be executed (its `.then` invoked) — that is what sends
  // the request. `void <builder>` constructs the lazy thenable but never fires it.
  await waitFor(() => expect(h.upsertThen).toHaveBeenCalled())
  expect(h.upsert).toHaveBeenCalledWith(
    {
      user_id: 'user-1',
      theme: 'brutal',
      default_view: 'calendar',
      week_start: 0,
      timezone: null,
    },
    { onConflict: 'user_id' },
  )
})

test('a settings change from another device is applied', async () => {
  const { result } = renderHook(() => useSettings('user-1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    h.capture.handler!({
      eventType: 'UPDATE',
      new: { user_id: 'user-1', theme: 'glass', default_view: 'week' },
      old: {},
    })
  })
  expect(result.current.settings).toEqual({
    theme: 'glass',
    defaultView: 'week',
    weekStart: 0,
    timezone: null,
  })
})

test('a remote settings event arriving right after a local save is suppressed', async () => {
  const { result } = renderHook(() => useSettings('user-1', true))
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
  expect(result.current.settings).toEqual({
    theme: 'brutal',
    defaultView: 'calendar',
    weekStart: 0,
    timezone: null,
  })
})

test('a failed load falls back to the snapshot, not to DEFAULTS', async () => {
  localStorage.setItem(
    'ma-snapshot-settings',
    JSON.stringify({ v: 2, userId: 'u1', settings: { theme: 'glass', defaultView: 'kanban' } }),
  )
  h.capture.result = { data: null, error: { message: 'FetchError: Failed to fetch' } }
  const { result } = renderHook(() => useSettings('u1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.settings).toEqual({ theme: 'glass', defaultView: 'kanban' })
})

test('a failed load with no snapshot falls back to DEFAULTS', async () => {
  h.capture.result = { data: null, error: { message: 'FetchError: Failed to fetch' } }
  const { result } = renderHook(() => useSettings('u1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.settings).toEqual({
    theme: 'cork',
    defaultView: 'calendar',
    weekStart: 0,
    timezone: null,
  })
})

test('a genuinely empty row still means DEFAULTS, and is snapshotted', async () => {
  h.capture.result = { data: null, error: null }
  const { result } = renderHook(() => useSettings('u1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.settings).toEqual({
    theme: 'cork',
    defaultView: 'calendar',
    weekStart: 0,
    timezone: null,
  })
  expect(JSON.parse(localStorage.getItem('ma-snapshot-settings')!).settings.theme).toBe('cork')
})

test('saving a theme updates the snapshot', async () => {
  const { result } = renderHook(() => useSettings('u1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  act(() => result.current.saveTheme('brutal'))
  expect(JSON.parse(localStorage.getItem('ma-snapshot-settings')!).settings.theme).toBe('brutal')
})

// FIX 1 bite-proof: an empty row with no error is what an unauthenticated `select` under RLS
// also looks like. `hasSession: false` models a resolved userId (e.g. from a stale `ma-last-user`)
// with no real session behind it — that must not be treated as "confirmed no settings row" and
// must not clobber whatever snapshot is already on disk.
test('an empty row with no session does not overwrite the existing snapshot', async () => {
  localStorage.setItem(
    'ma-snapshot-settings',
    JSON.stringify({ v: 1, userId: 'u1', settings: { theme: 'brutal', defaultView: 'kanban' } }),
  )
  h.capture.result = { data: null, error: null }
  const { result } = renderHook(() => useSettings('u1', false))
  await waitFor(() => expect(result.current.loading).toBe(false))
  // The hook still renders something sane locally (DEFAULTS) rather than hanging...
  expect(result.current.settings).toEqual({
    theme: 'cork',
    defaultView: 'calendar',
    weekStart: 0,
    timezone: null,
  })
  // ...but the on-disk snapshot, which the next offline boot reads, must be untouched.
  expect(JSON.parse(localStorage.getItem('ma-snapshot-settings')!).settings).toEqual({
    theme: 'brutal',
    defaultView: 'kanban',
  })
})

test('saveWeekStart and saveTimezone persist to the new columns', async () => {
  const { result } = renderHook(() => useSettings('user-1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    result.current.saveWeekStart(1)
  })
  expect(h.upsert).toHaveBeenLastCalledWith(
    expect.objectContaining({ user_id: 'user-1', week_start: 1 }),
    { onConflict: 'user_id' },
  )

  act(() => {
    result.current.saveTimezone('Europe/London')
  })
  // The second save must carry the first one forward — both come off the same `ref.current`.
  expect(h.upsert).toHaveBeenLastCalledWith(
    expect.objectContaining({ user_id: 'user-1', week_start: 1, timezone: 'Europe/London' }),
    { onConflict: 'user_id' },
  )
  expect(result.current.settings).toMatchObject({ weekStart: 1, timezone: 'Europe/London' })
})

test('a row missing the new columns loads as the defaults', async () => {
  // The deploy window: the Pages build can be live for a moment before the migration lands.
  h.capture.result = { data: { theme: 'brutal', default_view: 'week' }, error: null }
  const { result } = renderHook(() => useSettings('user-1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.settings).toEqual({
    theme: 'brutal',
    defaultView: 'week',
    weekStart: 0,
    timezone: null,
  })
})

test('a realtime change carries week start and timezone to other devices', async () => {
  const { result } = renderHook(() => useSettings('user-1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    h.capture.handler?.({
      new: {
        theme: 'cork',
        default_view: 'calendar',
        week_start: 6,
        timezone: 'Asia/Tokyo',
      },
    })
  })
  expect(result.current.settings).toMatchObject({ weekStart: 6, timezone: 'Asia/Tokyo' })
})
