import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// registerSW.ts intentionally keeps `registered`/`waitingWorker` as module-level state (that is
// what makes registerServiceWorker() StrictMode-safe). That means the module itself must be
// reset and re-imported between tests, or the second test silently no-ops against state left by
// the first — dynamic import + vi.resetModules() gives each test a clean module instance.
function stubServiceWorker(waiting: unknown = null) {
  const registration = { waiting, addEventListener: vi.fn(), installing: null }
  const register = vi.fn(() => Promise.resolve(registration))
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { register, addEventListener: vi.fn(), controller: null },
    configurable: true,
  })
  return { register, registration }
}

beforeEach(() => vi.resetModules())
afterEach(() => vi.restoreAllMocks())

test('registers once even when called twice (StrictMode double-invokes effects)', async () => {
  const { register } = stubServiceWorker()
  const { registerServiceWorker } = await import('./registerSW')
  registerServiceWorker()
  registerServiceWorker()
  await Promise.resolve()
  expect(register).toHaveBeenCalledOnce()
})

test('fires onUpdateReady when a worker is already waiting', async () => {
  stubServiceWorker({ postMessage: vi.fn() })
  const { onUpdateReady, registerServiceWorker } = await import('./registerSW')
  const cb = vi.fn()
  onUpdateReady(cb)
  registerServiceWorker()
  await vi.waitFor(() => expect(cb).toHaveBeenCalled())
})
