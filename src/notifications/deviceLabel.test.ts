import { expect, test } from 'vitest'
import { deviceLabel, serviceLabel } from './deviceLabel'

const agents = {
  chromeLinux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  firefoxMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  samsungAndroid:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  operaWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/122.0.0.0',
  chromeOs:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
}

test('names the browser and the system it runs on', () => {
  expect(deviceLabel(agents.chromeLinux)).toBe('Chrome on Linux')
  expect(deviceLabel(agents.edgeWindows)).toBe('Edge on Windows')
  expect(deviceLabel(agents.firefoxMac)).toBe('Firefox on macOS')
  expect(deviceLabel(agents.safariIphone)).toBe('Safari on iPhone')
  expect(deviceLabel(agents.safariMac)).toBe('Safari on macOS')
  expect(deviceLabel(agents.chromeAndroid)).toBe('Chrome on Android')
  expect(deviceLabel(agents.samsungAndroid)).toBe('Samsung Internet on Android')
  expect(deviceLabel(agents.operaWindows)).toBe('Opera on Windows')
  expect(deviceLabel(agents.chromeOs)).toBe('Chrome on ChromeOS')
})

test('an iPad asking for the desktop site is still an iPad', () => {
  // iPadOS Safari sends the macOS agent; touch support is what tells them apart.
  expect(deviceLabel(agents.safariMac, 5)).toBe('Safari on iPad')
  expect(deviceLabel(agents.safariMac, 0)).toBe('Safari on macOS')
})

test('says what it can and nothing when it recognizes neither part', () => {
  expect(deviceLabel('SomeBrowser/1.0 (Windows NT 10.0)')).toBe('Browser on Windows')
  expect(deviceLabel('Mozilla/5.0 (Unknown) Firefox/143.0')).toBe('Firefox')
  expect(deviceLabel('')).toBeNull()
})

test('the label always fits the database column', () => {
  for (const agent of Object.values(agents)) {
    expect((deviceLabel(agent) ?? '').length).toBeLessThanOrEqual(64)
  }
})

test('a device saved without a label is named by its push service', () => {
  expect(serviceLabel('https://fcm.googleapis.com/fcm/send/x')).toBe(
    'Chrome or another Chromium browser',
  )
  expect(serviceLabel('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe('Edge')
  expect(serviceLabel('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe('Firefox')
  expect(serviceLabel('https://web.push.apple.com/x')).toBe('Safari')
  expect(serviceLabel('not a url')).toBe('Unknown browser')
})
