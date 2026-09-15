interface ReminderPush {
  title?: unknown
  body?: unknown
  url?: unknown
  tag?: unknown
}

export interface VisibleNotification {
  title: string
  options: NotificationOptions
}

function text(value: unknown, fallback: string, max: number): string {
  return typeof value === 'string' && value.trim() ? value.slice(0, max) : fallback
}

/** Parse untrusted push bytes into the only notification shape this worker will display. */
export function notificationFromPush(value: unknown): VisibleNotification {
  const payload = value && typeof value === 'object' ? (value as ReminderPush) : {}
  const url = typeof payload.url === 'string' && payload.url.startsWith('/') ? payload.url : '/'
  return {
    title: text(payload.title, 'Magic Agenda reminder', 120),
    options: {
      body: text(payload.body, 'A scheduled task is due soon.', 300),
      data: { url },
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: text(payload.tag, 'magic-agenda-reminder', 180),
    },
  }
}
