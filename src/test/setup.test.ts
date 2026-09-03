import { expect, test, vi } from 'vitest'

test('tests can replace and restore the shared localStorage polyfill', () => {
  const original = globalThis.localStorage
  const replacement = { replacement: true }

  try {
    vi.stubGlobal('localStorage', replacement)
    expect(globalThis.localStorage).toBe(replacement)
  } finally {
    vi.unstubAllGlobals()
  }

  expect(globalThis.localStorage).toBe(original)
})
