import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'

const h = vi.hoisted(() => {
  const capture: { handler: ((event: string, session: unknown) => void) | null } = {
    handler: null,
  }
  return {
    capture,
    getSession: vi.fn(() => Promise.resolve({ data: { session: null } })),
    onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
      capture.handler = cb
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    }),
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: h.getSession,
      onAuthStateChange: h.onAuthStateChange,
      signOut: vi.fn(),
    },
  },
}))

import { AuthProvider, useAuth } from './AuthProvider'

beforeEach(() => {
  sessionStorage.clear()
  h.capture.handler = null
})

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>

test('PASSWORD_RECOVERY raises the recovery flag and SIGNED_OUT clears it', async () => {
  const { result } = renderHook(() => useAuth(), { wrapper })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.passwordRecovery).toBe(false)

  act(() => h.capture.handler!('PASSWORD_RECOVERY', { user: { id: 'u1' } }))
  expect(result.current.passwordRecovery).toBe(true)

  act(() => h.capture.handler!('SIGNED_OUT', null))
  expect(result.current.passwordRecovery).toBe(false)
})

test('the recovery flag survives a remount (page reload) via sessionStorage', async () => {
  const first = renderHook(() => useAuth(), { wrapper })
  await waitFor(() => expect(first.result.current.loading).toBe(false))
  act(() => h.capture.handler!('PASSWORD_RECOVERY', { user: { id: 'u1' } }))
  expect(first.result.current.passwordRecovery).toBe(true)
  first.unmount()

  const second = renderHook(() => useAuth(), { wrapper })
  expect(second.result.current.passwordRecovery).toBe(true)

  act(() => second.result.current.clearPasswordRecovery())
  expect(second.result.current.passwordRecovery).toBe(false)
  expect(sessionStorage.getItem('ma-password-recovery')).toBeNull()
})
