import { supabase } from '../lib/supabase'
import type { Database } from '../types/database.types'

type SubscriptionInsert = Database['public']['Tables']['push_subscriptions']['Insert']

export type PushAvailability = 'supported' | 'unsupported' | 'ios-install-required' | 'unconfigured'

export interface PushState {
  availability: PushAvailability
  permission: NotificationPermission
  subscribed: boolean
}

interface NotificationAdapter {
  permission: NotificationPermission
  requestPermission: () => Promise<NotificationPermission>
}

interface PushDependencies {
  publicKey: string
  notification: NotificationAdapter | null
  serviceWorkerReady: Promise<ServiceWorkerRegistration> | null
  ios: boolean
  standalone: boolean
  save: (row: SubscriptionInsert) => Promise<void>
  remove: (accountId: string, endpoint: string) => Promise<void>
  /** Whether this Account has a row for this endpoint. Rejects when it cannot tell. */
  owns: (accountId: string, endpoint: string) => Promise<boolean>
}

/**
 * The browser keeps one push subscription per origin, whoever is signed in, so nothing ties it
 * to an Account except the row that Account saved for its endpoint. Every method that answers
 * "is this device subscribed" or changes it therefore takes the Account, and the subscription is
 * given up when the session is (`release`).
 */
export interface PushGateway {
  /** `accountId` is null when nobody is signed in, which is never subscribed. */
  state: (accountId: string | null) => Promise<PushState>
  subscribe: (accountId: string) => Promise<void>
  /** The Settings action: fails loudly if the row cannot be removed, and keeps the device. */
  unsubscribe: (accountId: string) => Promise<void>
  /**
   * Give this device up at sign-out. Best-effort and bounded, because sign-out must not wait on
   * it: the row is removed while there is still a session to remove it with, and the browser
   * subscription is retired either way. A row left behind points at a dead endpoint, which the
   * reminder sender deletes on its first 404 or 410. Pass null once the session is already gone.
   */
  release: (accountId: string | null) => Promise<void>
  /** Retire a subscription this browser holds that the signed-in Account does not own. */
  reconcile: (accountId: string) => Promise<void>
}

/** How long `release` may hold up a sign-out. `navigator.serviceWorker.ready` can stay pending. */
const RELEASE_TIMEOUT_MS = 2000

function decodePublicKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function availability(deps: PushDependencies): PushAvailability {
  if (deps.ios && !deps.standalone) return 'ios-install-required'
  if (!deps.notification || !deps.serviceWorkerReady) return 'unsupported'
  if (!deps.publicKey) return 'unconfigured'
  return 'supported'
}

export function createPushGateway(deps: PushDependencies): PushGateway {
  const state = async (accountId: string | null): Promise<PushState> => {
    const available = availability(deps)
    const permission = deps.notification?.permission ?? 'default'
    if (available !== 'supported') {
      return { availability: available, permission, subscribed: false }
    }
    const registration = await deps.serviceWorkerReady!
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription || !accountId) {
      return { availability: available, permission, subscribed: false }
    }
    // A read that fails (offline) says what the browser holds: `release` and `reconcile` keep
    // that honest in the ordinary case, and "not subscribed" would offer a button that cannot work.
    const subscribed = await deps.owns(accountId, subscription.endpoint).catch(() => true)
    return { availability: available, permission, subscribed }
  }

  const subscribe = async (accountId: string): Promise<void> => {
    const available = availability(deps)
    if (available !== 'supported') {
      throw new Error(
        available === 'unconfigured'
          ? 'Push notifications are not configured for this deployment.'
          : 'Push notifications are not supported on this device.',
      )
    }
    const permission =
      deps.notification!.permission === 'granted'
        ? 'granted'
        : await deps.notification!.requestPermission()
    if (permission !== 'granted') throw new Error('Notification permission was denied.')

    const registration = await deps.serviceWorkerReady!
    let existing = await registration.pushManager.getSubscription()
    // Another Account's subscription is replaced, never adopted: saving a second row for the same
    // endpoint would deliver both Accounts' reminders to this device. Retiring it kills the
    // endpoint, so the other Account's row stops working too. This throws when the read fails,
    // which is right: the save below needs the same connection.
    if (existing && !(await deps.owns(accountId, existing.endpoint))) {
      await existing.unsubscribe()
      existing = null
    }
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodePublicKey(deps.publicKey),
      }))
    const json = subscription.toJSON()
    const p256dh = json.keys?.p256dh
    const auth = json.keys?.auth
    if (!p256dh || !auth) throw new Error('The browser returned an incomplete push subscription.')

    await deps.save({
      account_id: accountId,
      endpoint: subscription.endpoint,
      p256dh,
      auth_secret: auth,
      expiration_time:
        subscription.expirationTime === null
          ? null
          : new Date(subscription.expirationTime).toISOString(),
    })
  }

  const unsubscribe = async (accountId: string): Promise<void> => {
    if (!deps.serviceWorkerReady) return
    const registration = await deps.serviceWorkerReady
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return
    await deps.remove(accountId, subscription.endpoint)
    await subscription.unsubscribe()
  }

  const release = async (accountId: string | null): Promise<void> => {
    if (!deps.serviceWorkerReady) return
    const ready = deps.serviceWorkerReady
    const work = (async () => {
      const subscription = await (await ready).pushManager.getSubscription()
      if (!subscription) return
      if (accountId) await deps.remove(accountId, subscription.endpoint).catch(() => {})
      await subscription.unsubscribe()
    })().catch(() => {})
    await Promise.race([
      work,
      new Promise<void>((resolve) => setTimeout(resolve, RELEASE_TIMEOUT_MS)),
    ])
  }

  const reconcile = async (accountId: string): Promise<void> => {
    if (availability(deps) !== 'supported') return
    const subscription = await (await deps.serviceWorkerReady!).pushManager.getSubscription()
    if (!subscription) return
    // Not knowing is not the same as not owning: a failed read retires nothing.
    const owned = await deps.owns(accountId, subscription.endpoint).catch(() => true)
    if (!owned) await subscription.unsubscribe()
  }

  return { state, subscribe, unsubscribe, release, reconcile }
}

function isIosDevice(): boolean {
  const agent = navigator.userAgent
  return /iPad|iPhone|iPod/.test(agent) || (agent.includes('Mac') && navigator.maxTouchPoints > 1)
}

const notification: NotificationAdapter | null =
  typeof Notification === 'undefined'
    ? null
    : {
        get permission() {
          return Notification.permission
        },
        requestPermission: () => Notification.requestPermission(),
      }

const serviceWorkerReady =
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
    ? navigator.serviceWorker.ready
    : null

export const browserPushGateway = createPushGateway({
  publicKey: import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '',
  notification,
  serviceWorkerReady,
  ios: typeof navigator !== 'undefined' && isIosDevice(),
  standalone:
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches,
  save: async (row) => {
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(row, { onConflict: 'account_id,endpoint' })
    if (error) throw error
  },
  remove: async (accountId, endpoint) => {
    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('account_id', accountId)
      .eq('endpoint', endpoint)
    if (error) throw error
  },
  owns: async (accountId, endpoint) => {
    const { data, error } = await supabase
      .from('push_subscriptions')
      .select('id')
      .eq('account_id', accountId)
      .eq('endpoint', endpoint)
      .maybeSingle()
    if (error) throw error
    return data !== null
  },
})
