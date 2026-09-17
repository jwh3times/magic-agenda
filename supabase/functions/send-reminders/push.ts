// @deno-types="npm:@types/web-push@3.6.4"
import webPush from 'web-push'
import { PushFailure, type PushSubscriptionRow, type PushTransport } from './sender.ts'

export class WebPushTransport implements PushTransport {
  constructor(
    private readonly subject: string,
    private readonly publicKey: string,
    private readonly privateKey: string,
  ) {}

  async send(subscription: PushSubscriptionRow, payload: string, topic: string): Promise<void> {
    try {
      await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.authSecret },
        },
        payload,
        {
          vapidDetails: {
            subject: this.subject,
            publicKey: this.publicKey,
            privateKey: this.privateKey,
          },
          TTL: 24 * 60 * 60,
          urgency: 'normal',
          topic,
          timeout: 10_000,
        },
      )
    } catch (error) {
      const status =
        error && typeof error === 'object' && 'statusCode' in error
          ? Number((error as { statusCode: unknown }).statusCode)
          : null
      throw new PushFailure(error instanceof Error ? error.message : 'Web Push failed.', status)
    }
  }
}

export function productionPush(): WebPushTransport {
  const subject = Deno.env.get('VAPID_SUBJECT')
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!subject || !publicKey || !privateKey) {
    throw new Error('VAPID configuration is missing.')
  }
  return new WebPushTransport(subject, publicKey, privateKey)
}
