import { renderHook, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMediaQuery, useIsMobile } from './useMediaQuery'

type Listener = () => void

function stubMatchMedia(initialMatches: boolean) {
  const listeners = new Set<Listener>()
  const mql = {
    matches: initialMatches,
    addEventListener: (_: string, cb: Listener) => listeners.add(cb),
    removeEventListener: (_: string, cb: Listener) => listeners.delete(cb),
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql),
  )
  return {
    setMatches(next: boolean) {
      mql.matches = next
      listeners.forEach((cb) => cb())
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('useMediaQuery', () => {
  it('returns false when matchMedia is unavailable (jsdom default)', () => {
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it('reflects the current match state', () => {
    stubMatchMedia(true)
    const { result } = renderHook(() => useMediaQuery('(max-width: 760px)'))
    expect(result.current).toBe(true)
  })

  it('updates when the media query flips', () => {
    const media = stubMatchMedia(false)
    const { result } = renderHook(() => useMediaQuery('(max-width: 760px)'))
    expect(result.current).toBe(false)
    act(() => media.setMatches(true))
    expect(result.current).toBe(true)
    act(() => media.setMatches(false))
    expect(result.current).toBe(false)
  })
})
