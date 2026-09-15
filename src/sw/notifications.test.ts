import { expect, test } from 'vitest'
import { notificationFromPush } from './notifications'

test('turns a reminder payload into a visible notification', () => {
  expect(
    notificationFromPush({
      title: 'Due in 15 minutes',
      body: 'Submit the report',
      url: '/?board=board-1',
      tag: 'reminder-delivery-1',
    }),
  ).toEqual({
    title: 'Due in 15 minutes',
    options: {
      body: 'Submit the report',
      data: { url: '/?board=board-1' },
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'reminder-delivery-1',
    },
  })
})

test('malformed data still produces a safe, same-origin notification', () => {
  expect(
    notificationFromPush({ title: '', body: 42, url: 'https://attacker.test/', tag: null }),
  ).toMatchObject({
    title: 'Magic Agenda reminder',
    options: { body: 'A scheduled task is due soon.', data: { url: '/' } },
  })
})
