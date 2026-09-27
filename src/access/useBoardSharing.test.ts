import { renderHook } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ isAdmin: false, flag: false }))

vi.mock('./useRole', () => ({ useRole: () => ({ isAdmin: h.isAdmin }) }))
vi.mock('./useFlags', () => ({
  useFlags: () => ({ isEnabled: (key: string) => key === 'board-sharing' && h.flag }),
}))

const { useBoardSharing } = await import('./useBoardSharing')

beforeEach(() => {
  h.isAdmin = false
  h.flag = false
})

test('hidden from an ordinary account while the flag is off', () => {
  expect(renderHook(() => useBoardSharing()).result.current).toBe(false)
})

test('shown to an administrator before the flag exists — the first rollout stage (#443)', () => {
  h.isAdmin = true
  expect(renderHook(() => useBoardSharing()).result.current).toBe(true)
})

test('shown to everyone once the flag is enabled — the second stage', () => {
  h.flag = true
  expect(renderHook(() => useBoardSharing()).result.current).toBe(true)
})
