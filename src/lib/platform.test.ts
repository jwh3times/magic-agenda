import { describe, expect, it } from 'vitest'
import { isInAppBrowser, isIosDevice } from './platform'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1'
const IPHONE_WEBVIEW =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const IPHONE_INSTAGRAM = `${IPHONE_WEBVIEW} Instagram 390.0.0.0 (iPhone14,5; iOS 18_5)`
const IPHONE_FACEBOOK = `${IPHONE_WEBVIEW} [FBAN/FBIOS;FBAV/500.0.0;FBDV/iPhone14,5]`
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'
const IPAD_WEBVIEW_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36'
const ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 10; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.0.0 Mobile Safari/537.36'
const ANDROID_TIKTOK = `${ANDROID_CHROME} musical_ly_2023 BytedanceWebview/d8a21c6`
const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'

describe('isIosDevice', () => {
  it.each([
    ['iPhone Safari', IPHONE_SAFARI, 5, true],
    ['iPhone Chrome', IPHONE_CHROME, 5, true],
    ['an iPad asking for desktop sites', IPAD_AS_MAC, 5, true],
    ['a Mac', IPAD_AS_MAC, 0, false],
    ['Android', ANDROID_CHROME, 5, false],
    ['Windows', WINDOWS_CHROME, 10, false],
  ])('%s', (_name, agent, touchPoints, expected) => {
    expect(isIosDevice(agent, touchPoints)).toBe(expected)
  })
})

describe('isInAppBrowser', () => {
  it.each([
    ['iPhone Safari', IPHONE_SAFARI, 5, false],
    ['iPhone Chrome', IPHONE_CHROME, 5, false],
    ['an unnamed iPhone web view', IPHONE_WEBVIEW, 5, true],
    ['Instagram on iPhone', IPHONE_INSTAGRAM, 5, true],
    ['Facebook on iPhone', IPHONE_FACEBOOK, 5, true],
    ['Safari on an iPad asking for desktop sites', IPAD_AS_MAC, 5, false],
    ['an unnamed iPad web view sending a Mac user agent', IPAD_WEBVIEW_AS_MAC, 5, true],
    ['Android Chrome', ANDROID_CHROME, 5, false],
    ['an Android web view', ANDROID_WEBVIEW, 5, true],
    ['TikTok on Android', ANDROID_TIKTOK, 5, true],
    ['Safari on a Mac', IPAD_AS_MAC, 0, false],
    ["a Mac app's web view, which isn't recognized", IPAD_WEBVIEW_AS_MAC, 0, false],
    ['Chrome on Windows', WINDOWS_CHROME, 10, false],
  ])('%s', (_name, agent, touchPoints, expected) => {
    expect(isInAppBrowser(agent, touchPoints)).toBe(expected)
  })
})
