import * as domMatchers from '@testing-library/jest-dom/matchers'
import { afterEach, expect } from 'vitest'

expect.extend(domMatchers)

// localStorage fallback, originally needed with Node 26 + Vitest 4's jsdom.
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

// jsdom implements no scrolling at all, so `Element.prototype.scrollIntoView` is simply absent.
// dnd-kit's KeyboardSensor calls it the moment a keyboard drag starts, which surfaces as an
// uncaught TypeError from inside an event handler rather than a failed assertion — the test still
// passes, and the run reports a stray error beside it. A no-op is the whole fix: nothing here
// asserts on scroll position, and a layout-free environment has nothing to scroll.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

// Isolate tests from persisted browser state (board view, auth recovery flag),
// so a view switch in one test can't change another test's initial view.
afterEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})
