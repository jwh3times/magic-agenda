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
    status: ((s: string) => void) | null
    result: { data: unknown; error: unknown }
  } = {
    handler: null,
    status: null,
    result: { data: { theme: 'cork', default_view: 'calendar' }, error: null },
  }
  const maybeSingle = vi.fn(() => Promise.resolve(capture.result))
  const channel: Record<string, unknown> = {}
  channel.on = vi.fn((_e: string, _f: unknown, cb: (p: unknown) => void) => {
    capture.handler = cb
    return channel
  })
  // Hands the status callback to the test rather than swallowing it: until useSettings was moved
  // onto useSyncedTable it passed no callback at all, which is how the missing reconnect path
  // (#130) stayed invisible.
  channel.subscribe = vi.fn((cb?: (s: string) => void) => {
    capture.status = cb ?? null
    return channel
  })
  const channelFn = vi.fn(() => channel)
  return {
    upsertThen,
    upsert,
    maybeSingle,
    capture,
    channel,
    channelFn,
    channelCount: () => channelFn.mock.calls.length,
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: h.maybeSingle })) })),
      upsert: h.upsert,
    })),
    channel: h.channelFn,
    removeChannel: vi.fn(),
  },
}))

import { useSettings } from './useSettings'
import { readSettingsSnapshot } from './snapshot'

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
    weekStart: 0,
    timezone: null,
  })
})

test('a failed load falls back to the snapshot, not to DEFAULTS', async () => {
  localStorage.setItem(
    'ma-snapshot-settings',
    JSON.stringify({
      v: 7,
      userId: 'u1',
      settings: { theme: 'glass', weekStart: 1, timezone: 'Europe/London' },
    }),
  )
  h.capture.result = { data: null, error: { message: 'FetchError: Failed to fetch' } }
  const { result } = renderHook(() => useSettings('u1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.settings).toEqual({
    theme: 'glass',
    weekStart: 1,
    timezone: 'Europe/London',
  })
})

test('a failed load with no snapshot falls back to DEFAULTS', async () => {
  h.capture.result = { data: null, error: { message: 'FetchError: Failed to fetch' } }
  const { result } = renderHook(() => useSettings('u1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.settings).toEqual({
    theme: 'cork',
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
    weekStart: 0,
    timezone: null,
  })
  expect(readSettingsSnapshot('u1')?.settings.theme).toBe('cork')
})

test('saving a theme updates the snapshot', async () => {
  const { result } = renderHook(() => useSettings('u1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  act(() => result.current.saveTheme('brutal'))
  expect(readSettingsSnapshot('u1')?.settings.theme).toBe('brutal')
})

// FIX 1 bite-proof: an empty row with no error is what an unauthenticated `select` under RLS
// also looks like. `hasSession: false` models a resolved userId (e.g. from a stale `ma-last-user`)
// with no real session behind it — that must not be treated as "confirmed no settings row" and
// must not clobber whatever snapshot is already on disk.
test('an empty row with no session does not overwrite the existing snapshot', async () => {
  localStorage.setItem(
    'ma-snapshot-settings',
    JSON.stringify({
      v: 7,
      userId: 'u1',
      settings: { theme: 'brutal', weekStart: 1, timezone: 'Europe/London' },
    }),
  )
  h.capture.result = { data: null, error: null }
  const { result } = renderHook(() => useSettings('u1', false))
  await waitFor(() => expect(result.current.loading).toBe(false))
  // The hook still renders something sane locally (DEFAULTS) rather than hanging...
  expect(result.current.settings).toEqual({
    theme: 'cork',
    weekStart: 0,
    timezone: null,
  })
  // ...but the on-disk snapshot, which the next offline boot reads, must be untouched.
  expect(readSettingsSnapshot('u1')?.settings).toEqual({
    theme: 'brutal',
    weekStart: 1,
    timezone: 'Europe/London',
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
        week_start: 6,
        timezone: 'Asia/Tokyo',
      },
    })
  })
  expect(result.current.settings).toMatchObject({ weekStart: 6, timezone: 'Asia/Tokyo' })
})

// ——— #130: the reconnect path useSettings never had ———

test('a settings channel error reloads and resubscribes instead of dying silently', async () => {
  // Before the shared sync module, useSettings' entire subscription tail was `.subscribe()` —
  // no status callback, no backoff, no catch-up. A channel that errored after a phone slept was
  // dead for the rest of the session while the board kept syncing, so cross-device theme and
  // week-start changes just stopped arriving with nothing on screen to say so.
  vi.useFakeTimers()
  try {
    const { result } = renderHook(() => useSettings('user-1', true))
    await vi.waitFor(() => expect(result.current.loading).toBe(false))
    const loadsBefore = h.maybeSingle.mock.calls.length

    expect(h.capture.status).not.toBeNull() // a status callback is now registered at all
    act(() => h.capture.status!('CHANNEL_ERROR'))

    expect(h.maybeSingle.mock.calls.length).toBe(loadsBefore + 1) // reloaded immediately
    act(() => void vi.advanceTimersByTime(1000))
    expect(h.channelCount()).toBeGreaterThan(1) // and resubscribed on a fresh channel
  } finally {
    vi.useRealTimers()
  }
})

test('settings catch up when the network returns', async () => {
  const { result } = renderHook(() => useSettings('user-1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const loadsBefore = h.maybeSingle.mock.calls.length

  act(() => void window.dispatchEvent(new Event('online')))

  await waitFor(() => expect(h.maybeSingle.mock.calls.length).toBe(loadsBefore + 1))
})

test('a signed-out visitor opens no settings channel and fires no query', () => {
  const before = h.maybeSingle.mock.calls.length
  renderHook(() => useSettings('', false))
  expect(h.maybeSingle.mock.calls.length).toBe(before)
  act(() => void window.dispatchEvent(new Event('online')))
  expect(h.maybeSingle.mock.calls.length).toBe(before)
})

test('a theme saved while offline still reaches the snapshot', async () => {
  // A load failure means the snapshot gate says "we learned nothing from the server" — but a
  // user's own save is not a load result. It is a deliberate choice, and it has to survive the
  // next boot even though the upsert behind it just failed. Nearly regressed while unifying the
  // gate: routing `persist` through canPersistSnapshot would silently drop this.
  localStorage.removeItem('ma-snapshot-settings')
  h.capture.result = { data: null, error: { message: 'FetchError: Failed to fetch' } }
  const { result } = renderHook(() => useSettings('u-offline', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => result.current.saveTheme('brutal'))

  expect(readSettingsSnapshot('u-offline')?.settings.theme).toBe('brutal')
})
