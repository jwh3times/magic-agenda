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
}

export interface PushGateway {
  state: () => Promise<PushState>
  subscribe: (accountId: string) => Promise<void>
  unsubscribe: (accountId: string) => Promise<void>
}

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
  const state = async (): Promise<PushState> => {
    const available = availability(deps)
    const permission = deps.notification?.permission ?? 'default'
    if (available !== 'supported') {
      return { availability: available, permission, subscribed: false }
    }
    const registration = await deps.serviceWorkerReady!
    const subscription = await registration.pushManager.getSubscription()
    return { availability: available, permission, subscribed: subscription !== null }
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
    const existing = await registration.pushManager.getSubscription()
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

  return { state, subscribe, unsubscribe }
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
})
