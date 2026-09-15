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
    ...overrides,
  }
  return { gateway: createPushGateway(deps), subscribe, getSubscription, save, remove, unsubscribe }
}

test('reports iOS Home Screen guidance before generic unsupported messaging', async () => {
  const { gateway } = fixture({ ios: true, standalone: false, serviceWorkerReady: null })
  await expect(gateway.state()).resolves.toEqual({
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
  expect((await gateway.state()).availability).toBe('unconfigured')
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
