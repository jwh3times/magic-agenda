import { expect, test, vi } from 'vitest'
import { createPushGateway, type SubscriptionRow } from './pushGateway'

function fixture(overrides: Partial<Parameters<typeof createPushGateway>[0]> = {}) {
  const unsubscribe = vi.fn(() => Promise.resolve(true))
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/device',
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
  const list = vi.fn((_accountId: string) => Promise.resolve<SubscriptionRow[]>([]))
  const removeById = vi.fn((_accountId: string, _id: string) => Promise.resolve(true))
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
    list,
    removeById,
    deviceLabel: 'Chrome on Linux',
    ...overrides,
  }
  return {
    gateway: createPushGateway(deps),
    subscribe,
    getSubscription,
    save,
    remove,
    unsubscribe,
    list,
    removeById,
  }
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
    endpoint: 'https://fcm.googleapis.com/fcm/send/device',
    p256dh: 'public-key',
    auth_secret: 'auth-secret',
    expiration_time: null,
    device_label: 'Chrome on Linux',
  })
})

test('a browser whose push service is not supported is refused before anything is saved', async () => {
  // The reminder sender posts only to known push services, so saving this row would offer
  // "subscribed" for a device that can never ring.
  const { gateway, subscribe, save } = fixture()
  const elsewhere = vi.fn(() => Promise.resolve(true))
  subscribe.mockResolvedValueOnce({
    endpoint: 'https://push.unknown-browser.test/device',
    expirationTime: null,
    toJSON: () => ({ keys: { p256dh: 'public-key', auth: 'auth-secret' } }),
    unsubscribe: elsewhere,
  } as unknown as PushSubscription)

  await expect(gateway.subscribe('account-1')).rejects.toThrow(
    "This browser's push service is not supported",
  )
  expect(save).not.toHaveBeenCalled()
  expect(elsewhere).toHaveBeenCalled()
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
    endpoint: 'https://fcm.googleapis.com/fcm/send/device',
    unsubscribe: base.unsubscribe,
  } as unknown as PushSubscription
  base.getSubscription.mockResolvedValue(subscription)

  await base.gateway.unsubscribe('account-1')

  expect(base.remove).toHaveBeenCalledWith(
    'account-1',
    'https://fcm.googleapis.com/fcm/send/device',
  )
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
    endpoint: 'https://fcm.googleapis.com/fcm/send/device',
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
  expect(owns).toHaveBeenLastCalledWith('account-2', 'https://fcm.googleapis.com/fcm/send/device')
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
  expect(base.remove).toHaveBeenCalledWith(
    'account-1',
    'https://fcm.googleapis.com/fcm/send/device',
  )
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

// ——— the device list ———
// A subscription made on a device the owner no longer has (a lost laptop, a browser they signed
// out of elsewhere) can only be removed from somewhere else, so Settings lists every one.

const row = (id: string, endpoint: string, createdAt: string, label: string | null) => ({
  id,
  endpoint,
  device_label: label,
  created_at: createdAt,
})

test('lists the Account’s devices, this one first, without handing out an endpoint', async () => {
  const base = subscribedFixture()
  base.list.mockResolvedValue([
    row(
      'old',
      'https://updates.push.services.mozilla.com/wpush/v2/a',
      '2026-09-01T10:00:00Z',
      null,
    ),
    row(
      'here',
      'https://fcm.googleapis.com/fcm/send/device',
      '2026-09-02T10:00:00Z',
      'Chrome on Linux',
    ),
    row('new', 'https://web.push.apple.com/b', '2026-10-01T10:00:00Z', 'Safari on iPhone'),
  ])

  const devices = await base.gateway.devices('account-1')

  expect(base.list).toHaveBeenCalledWith('account-1')
  expect(devices).toEqual([
    { id: 'here', label: 'Chrome on Linux', createdAt: '2026-09-02T10:00:00Z', current: true },
    { id: 'new', label: 'Safari on iPhone', createdAt: '2026-10-01T10:00:00Z', current: false },
    { id: 'old', label: 'Firefox', createdAt: '2026-09-01T10:00:00Z', current: false },
  ])
  expect(JSON.stringify(devices)).not.toContain('https://')
})

test('lists devices from a browser that cannot subscribe itself', async () => {
  // Removing the lost laptop from an iPhone outside the Home Screen app must still work.
  const base = fixture({ ios: true, standalone: false, serviceWorkerReady: null })
  base.list.mockResolvedValue([
    row(
      'laptop',
      'https://fcm.googleapis.com/fcm/send/x',
      '2026-09-01T10:00:00Z',
      'Chrome on Linux',
    ),
  ])
  expect(await base.gateway.devices('account-1')).toEqual([
    { id: 'laptop', label: 'Chrome on Linux', createdAt: '2026-09-01T10:00:00Z', current: false },
  ])
})

test('a list read that fails says so rather than showing no devices', async () => {
  const base = fixture()
  base.list.mockRejectedValue(new Error('offline'))
  await expect(base.gateway.devices('account-1')).rejects.toThrow('offline')
})

test('removing a device deletes its row by id for this Account', async () => {
  const base = subscribedFixture()
  await base.gateway.removeDevice('account-1', 'laptop')
  expect(base.removeById).toHaveBeenCalledWith('account-1', 'laptop')
  // Another device's row is all there is to remove; this browser keeps its own subscription.
  expect(base.unsubscribe).not.toHaveBeenCalled()
})

test('removing a device that is already gone is not an error', async () => {
  const base = fixture({ removeById: () => Promise.resolve(false) })
  await expect(base.gateway.removeDevice('account-1', 'gone')).resolves.toBeUndefined()
})

test('a removal that fails is reported', async () => {
  const base = fixture({ removeById: () => Promise.reject(new Error('offline')) })
  await expect(base.gateway.removeDevice('account-1', 'laptop')).rejects.toThrow('offline')
})

test('lists devices even when the service worker never becomes ready', async () => {
  // `navigator.serviceWorker.ready` never settles where no worker registers (dev, a blocked
  // registration). The list does not depend on it; only "which one is this device" does.
  vi.useFakeTimers()
  try {
    const base = fixture({ serviceWorkerReady: new Promise(() => {}) })
    base.list.mockResolvedValue([
      row(
        'laptop',
        'https://fcm.googleapis.com/fcm/send/x',
        '2026-09-01T10:00:00Z',
        'Chrome on Linux',
      ),
    ])
    let listed: unknown = null
    void base.gateway.devices('account-1').then((devices) => (listed = devices))
    await vi.advanceTimersByTimeAsync(5000)
    expect(listed).toEqual([
      { id: 'laptop', label: 'Chrome on Linux', createdAt: '2026-09-01T10:00:00Z', current: false },
    ])
  } finally {
    vi.useRealTimers()
  }
})
