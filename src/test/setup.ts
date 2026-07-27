import '@testing-library/jest-dom'
import { afterEach, beforeEach } from 'vitest'

// localStorage polyfill for jsdom in Node.js
if (typeof globalThis.localStorage === 'undefined') {
  const store: Record<string, string> = {}
  globalThis.localStorage = new (class {
    getItem(key: string) {
      return store[key] || null
    }
    setItem(key: string, value: string) {
      store[key] = value
    }
    removeItem(key: string) {
      delete store[key]
    }
    clear() {
      Object.keys(store).forEach((key) => delete store[key])
    }
    key(index: number) {
      const keys = Object.keys(store)
      return keys[index] || null
    }
    get length() {
      return Object.keys(store).length
    }
  })() as Storage
}

// Isolate tests from persisted browser state (board view, auth recovery flag),
// so a view switch in one test can't change another test's initial view.
afterEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})
