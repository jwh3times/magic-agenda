import { expect, test } from 'vitest'
import { isPushServiceEndpoint } from './pushEndpoint'

test.each([
  'https://fcm.googleapis.com/fcm/send/abc:def',
  'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
  'https://web.push.apple.com/QGuQ2b',
  'https://wns2-by3p.notify.windows.com/w/?token=BQYAAAB',
])('a browser push service is allowed: %s', (endpoint) => {
  expect(isPushServiceEndpoint(endpoint)).toBe(true)
})

test.each([
  ['plain http', 'http://fcm.googleapis.com/fcm/send/abc'],
  ['another host', 'https://example.com/fcm/send/abc'],
  ['a look-alike suffix', 'https://fcm.googleapis.com.example.com/x'],
  ['a look-alike prefix', 'https://evilfcm.googleapis.com/x'],
  ['a bare Windows domain', 'https://notify.windows.com/w/'],
  ['an explicit port', 'https://fcm.googleapis.com:8443/fcm/send/abc'],
  ['credentials in the URL', 'https://user@fcm.googleapis.com/fcm/send/abc'],
  ['an IP address', 'https://127.0.0.1/x'],
  ['not a URL', 'fcm.googleapis.com/fcm/send/abc'],
])('anything else is refused: %s', (_case, endpoint) => {
  expect(isPushServiceEndpoint(endpoint)).toBe(false)
})
