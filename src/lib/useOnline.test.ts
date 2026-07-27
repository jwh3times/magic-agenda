import { renderHook, act } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { useOnline } from './useOnline'

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true })
}

afterEach(() => setOnLine(true))

test('reports online by default', () => {
  const { result } = renderHook(() => useOnline())
  expect(result.current).toBe(true)
})

test('reacts to the offline and online events', () => {
  const { result } = renderHook(() => useOnline())
  act(() => {
    setOnLine(false)
    window.dispatchEvent(new Event('offline'))
  })
  expect(result.current).toBe(false)
  act(() => {
    setOnLine(true)
    window.dispatchEvent(new Event('online'))
  })
  expect(result.current).toBe(true)
})
