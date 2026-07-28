import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// registerSW.ts intentionally keeps `registered`/`waitingWorker` as module-level state (that is
// what makes registerServiceWorker() idempotent and testable as such). That means the module
// itself must be reset and re-imported between tests, or one test's state leaks into the next —
// dynamic import + vi.resetModules() gives each test a clean module instance.
//
// registerServiceWorker() only attempts registration in production (see the `import.meta.env.PROD`
// guard) — every test that exercises the live registration path stubs that on.

type Listener = () => void

function stubServiceWorker(waiting: unknown = null, controller: unknown = null) {
  const registrationListeners: Record<string, Listener> = {}
  const registration = {
    waiting,
    installing: null as {
      state: string
      addEventListener: (event: string, cb: Listener) => void
    } | null,
    addEventListener: vi.fn((event: string, cb: Listener) => {
      registrationListeners[event] = cb
    }),
  }
  const register = vi.fn(() => Promise.resolve(registration))
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { register, addEventListener: vi.fn(), controller },
    configurable: true,
  })
  return { register, registration, registrationListeners }
}

/** Drives a registration through the REAL update path — `updatefound`, then the installing
 *  worker reaching `state === 'installed'` — as opposed to a worker that was already `waiting`
 *  when the page loaded. This is the path the `navigator.serviceWorker.controller` check guards. */
function fireLiveUpdate(
  registration: ReturnType<typeof stubServiceWorker>['registration'],
  registrationListeners: Record<string, Listener>,
) {
  const installingListeners: Record<string, Listener> = {}
  const installing = {
    state: 'installing',
    addEventListener: vi.fn((event: string, cb: Listener) => {
      installingListeners[event] = cb
    }),
  }
  registration.installing = installing
  registrationListeners.updatefound()
  installing.state = 'installed'
  installingListeners.statechange()
}

beforeEach(() => vi.resetModules())
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

test('registers once even when called twice (StrictMode double-invokes effects)', async () => {
  vi.stubEnv('PROD', true)
  const { register } = stubServiceWorker()
  const { registerServiceWorker } = await import('./registerSW')
  registerServiceWorker()
  registerServiceWorker()
  await Promise.resolve()
  expect(register).toHaveBeenCalledOnce()
})

test('fires onUpdateReady when a worker is already waiting', async () => {
  vi.stubEnv('PROD', true)
  stubServiceWorker({ postMessage: vi.fn() })
  const { onUpdateReady, registerServiceWorker } = await import('./registerSW')
  const cb = vi.fn()
  onUpdateReady(cb)
  registerServiceWorker()
  await vi.waitFor(() => expect(cb).toHaveBeenCalled())
})

test('fires onUpdateReady when a new worker finishes installing over an existing controller', async () => {
  vi.stubEnv('PROD', true)
  const { registration, registrationListeners } = stubServiceWorker(null, {})
  const { onUpdateReady, registerServiceWorker } = await import('./registerSW')
  const cb = vi.fn()
  onUpdateReady(cb)
  registerServiceWorker()
  await vi.waitFor(() => expect(registrationListeners.updatefound).toBeTypeOf('function'))
  fireLiveUpdate(registration, registrationListeners)
  expect(cb).toHaveBeenCalled()
})

test('does not fire onUpdateReady for the very first install (no controller yet)', async () => {
  vi.stubEnv('PROD', true)
  const { registration, registrationListeners } = stubServiceWorker(null, null)
  const { onUpdateReady, registerServiceWorker } = await import('./registerSW')
  const cb = vi.fn()
  onUpdateReady(cb)
  registerServiceWorker()
  await vi.waitFor(() => expect(registrationListeners.updatefound).toBeTypeOf('function'))
  fireLiveUpdate(registration, registrationListeners)
  expect(cb).not.toHaveBeenCalled()
})

test('does not register outside production (dev has no /sw.js to register)', async () => {
  // PROD is false by default under Vitest (see the probe used to confirm this while diagnosing
  // this test) — no vi.stubEnv call here is the point.
  const { register } = stubServiceWorker()
  const { registerServiceWorker } = await import('./registerSW')
  registerServiceWorker()
  await Promise.resolve()
  expect(register).not.toHaveBeenCalled()
})
