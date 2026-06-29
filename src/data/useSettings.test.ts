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
  const maybeSingle = vi.fn(() =>
    Promise.resolve({ data: { theme: 'cork', default_view: 'calendar' }, error: null }),
  )
  return { upsertThen, upsert, maybeSingle }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: h.maybeSingle })) })),
      upsert: h.upsert,
    })),
  },
}))

import { useSettings } from './useSettings'

beforeEach(() => {
  h.upsertThen.mockClear()
  h.upsert.mockClear()
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
