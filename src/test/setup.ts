import '@testing-library/jest-dom'
import { afterEach } from 'vitest'

// localStorage polyfill: Node 26 + vitest 4's jsdom exposes Storage but no instance.
// Neither globalThis.localStorage nor window.localStorage is defined, though the
// Storage constructor exists. Methods are own properties (not on Storage.prototype),
// so tests must spy on the instance, not the prototype.
if (typeof globalThis.localStorage === 'undefined') {
  const store: Record<string, string> = {}
  const polyfill = new (class {
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

  // Tests must be able to replace storage (for quota/private-mode paths) and restore this baseline.
  Object.defineProperty(globalThis, 'localStorage', {
    value: polyfill,
    writable: true,
    configurable: true,
  })
}

// Isolate tests from persisted browser state (board view, auth recovery flag),
// so a view switch in one test can't change another test's initial view.
afterEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})
