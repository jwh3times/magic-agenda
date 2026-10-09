import { expect, test, vi } from 'vitest'
import { createPushGateway } from './pushGateway'

function fixture(overrides: Partial<Parameters<typeof createPushGateway>[0]> = {}) {
  const unsubscribe = vi.fn(() => Promise.resolve(true))
  const subscription = {
    endpoint: 'https://push.example.test/device',
    expirationTime: null,
    toJSON: () => ({ keys: { p256dh: 'public-key', auth: 'auth-secret' } }),
    unsubscribe,
  } as unknown as PushSubscription
  const subscribe = vi.fn((_options: PushSubscriptionOptionsInit) => Promise.resolve(subscription))
  const getSubscription = vi.fn(() => Promise.resolve<PushSubscription | null>(null))
  const registration = {
    pushManager: { subscribe, getSubscription },
  } as unknown as ServiceWorkerRegistration
  const save = vi.fn(() => Promise.resolve())
  const remove = vi.fn(() => Promise.resolve())
  const requestPermission = vi.fn(() => Promise.resolve<NotificationPermission>('granted'))
  const deps: Parameters<typeof createPushGateway>[0] = {
    publicKey: 'AQAB',
    notification: { permission: 'default', requestPermission },
    serviceWorkerReady: Promise.resolve(registration),
    ios: false,
    standalone: false,
    save,
    remove,
    owns: () => Promise.resolve(true),
    ...overrides,
  }
  return { gateway: createPushGateway(deps), subscribe, getSubscription, save, remove, unsubscribe }
}

test('reports iOS Home Screen guidance before generic unsupported messaging', async () => {
  const { gateway } = fixture({ ios: true, standalone: false, serviceWorkerReady: null })
  await expect(gateway.state(null)).resolves.toEqual({
    availability: 'ios-install-required',
    permission: 'default',
    subscribed: false,
  })
})

test('reports a missing deployment key without requesting permission', async () => {
  const requestPermission = vi.fn(() => Promise.resolve<NotificationPermission>('granted'))
  const { gateway } = fixture({
    publicKey: '',
    notification: { permission: 'default', requestPermission },
  })
  expect((await gateway.state(null)).availability).toBe('unconfigured')
  await expect(gateway.subscribe('account-1')).rejects.toThrow('not configured')
  expect(requestPermission).not.toHaveBeenCalled()
})

test('subscribes on demand and persists exactly the browser credential', async () => {
  const { gateway, subscribe, save } = fixture()

  await gateway.subscribe('account-1')

  const options = subscribe.mock.calls[0][0]
  expect(options.userVisibleOnly).toBe(true)
  expect(options.applicationServerKey).toBeInstanceOf(Uint8Array)
  expect(save).toHaveBeenCalledWith({
    account_id: 'account-1',
    endpoint: 'https://push.example.test/device',
    p256dh: 'public-key',
    auth_secret: 'auth-secret',
    expiration_time: null,
  })
})

test('a denied permission creates no subscription or database row', async () => {
  const requestPermission = vi.fn(() => Promise.resolve<NotificationPermission>('denied'))
  const { gateway, subscribe, save } = fixture({
    notification: { permission: 'default', requestPermission },
  })

  await expect(gateway.subscribe('account-1')).rejects.toThrow('denied')
  expect(subscribe).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
})

test('unsubscribing removes the server credential before retiring the browser endpoint', async () => {
  const base = fixture()
  const subscription = {
    endpoint: 'https://push.example.test/device',
    unsubscribe: base.unsubscribe,
  } as unknown as PushSubscription
  base.getSubscription.mockResolvedValue(subscription)

  await base.gateway.unsubscribe('account-1')

  expect(base.remove).toHaveBeenCalledWith('account-1', 'https://push.example.test/device')
  expect(base.unsubscribe).toHaveBeenCalled()
  expect(base.remove.mock.invocationCallOrder[0]).toBeLessThan(
    base.unsubscribe.mock.invocationCallOrder[0],
  )
})

// ——— a subscription belongs to the Account that made it ———
// The browser holds one subscription per origin, whoever is signed in. Left alone it outlives
// the Account: the next person on this browser profile keeps receiving the previous Account's
// reminders, and is told "this device is subscribed" while they do.

function subscribedFixture(overrides: Partial<Parameters<typeof createPushGateway>[0]> = {}) {
  const base = fixture(overrides)
  const subscription = {
    endpoint: 'https://push.example.test/device',
    expirationTime: null,
    toJSON: () => ({ keys: { p256dh: 'public-key', auth: 'auth-secret' } }),
    unsubscribe: base.unsubscribe,
  } as unknown as PushSubscription
  base.getSubscription.mockResolvedValue(subscription)
  return base
}

test('a subscription made by another Account does not read as subscribed', async () => {
  const owns = vi.fn((accountId: string) => Promise.resolve(accountId === 'account-1'))
  const { gateway } = subscribedFixture({ owns })

  expect((await gateway.state('account-1')).subscribed).toBe(true)
  expect((await gateway.state('account-2')).subscribed).toBe(false)
  expect(owns).toHaveBeenLastCalledWith('account-2', 'https://push.example.test/device')
})

test('an ownership read that fails falls back to what the browser holds', async () => {
  const { gateway } = subscribedFixture({ owns: () => Promise.reject(new Error('offline')) })
  expect((await gateway.state('account-1')).subscribed).toBe(true)
})

test('subscribing over another Account’s subscription replaces it rather than sharing it', async () => {
  const base = subscribedFixture({ owns: () => Promise.resolve(false) })

  await base.gateway.subscribe('account-2')

  expect(base.unsubscribe).toHaveBeenCalled()
  expect(base.subscribe).toHaveBeenCalled()
  expect(base.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
    base.subscribe.mock.invocationCallOrder[0],
  )
  expect(base.save).toHaveBeenCalledWith(expect.objectContaining({ account_id: 'account-2' }))
})

test('releasing removes the row and retires the browser subscription', async () => {
  const base = subscribedFixture()
  await base.gateway.release('account-1')
  expect(base.remove).toHaveBeenCalledWith('account-1', 'https://push.example.test/device')
  expect(base.unsubscribe).toHaveBeenCalled()
})

test('releasing still retires the browser subscription when the row cannot be removed', async () => {
  const base = subscribedFixture({ remove: () => Promise.reject(new Error('offline')) })
  await expect(base.gateway.release('account-1')).resolves.toBeUndefined()
  expect(base.unsubscribe).toHaveBeenCalled()
})

test('releasing with no Account retires the browser subscription alone', async () => {
  const base = subscribedFixture()
  await base.gateway.release(null)
  expect(base.remove).not.toHaveBeenCalled()
  expect(base.unsubscribe).toHaveBeenCalled()
})

test('releasing never waits on a service worker that is not coming', async () => {
  vi.useFakeTimers()
  try {
    const { gateway } = fixture({ serviceWorkerReady: new Promise(() => {}) })
    let settled = false
    void gateway.release('account-1').then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(5000)
    expect(settled).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})

test('reconciling retires a subscription the signed-in Account does not own', async () => {
  const foreign = subscribedFixture({ owns: () => Promise.resolve(false) })
  await foreign.gateway.reconcile('account-2')
  expect(foreign.unsubscribe).toHaveBeenCalled()

  const own = subscribedFixture({ owns: () => Promise.resolve(true) })
  await own.gateway.reconcile('account-1')
  expect(own.unsubscribe).not.toHaveBeenCalled()

  // Not knowing is not the same as not owning: a failed read retires nothing.
  const unknown = subscribedFixture({ owns: () => Promise.reject(new Error('offline')) })
  await unknown.gateway.reconcile('account-1')
  expect(unknown.unsubscribe).not.toHaveBeenCalled()
})
