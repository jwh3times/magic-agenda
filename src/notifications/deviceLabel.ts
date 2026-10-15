/**
 * What the device list calls a device. Settings lists every browser an Account has subscribed so
 * one can be removed from anywhere, and "added 3 September" alone does not tell a lost laptop
 * from the phone in your hand. The label is recorded once, by the browser that subscribes, and
 * is only ever shown to the Account that owns the row.
 *
 * It is a hint, not an identity: the user agent is the browser's own description of itself, and
 * nothing depends on it being right.
 */

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  // Order matters: Edge, Opera and Samsung Internet all also say "Chrome", and Chrome says "Safari".
  [/\bEdg(e|A|iOS)?\//, 'Edge'],
  [/\b(OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(Firefox|FxiOS)\//, 'Firefox'],
  [/\b(Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
]

const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  // Before macOS: iPhone and iPad agents say "like Mac OS X".
  [/\biPhone\b|\biPod\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
]

function first(table: readonly (readonly [RegExp, string])[], agent: string): string | null {
  return table.find(([pattern]) => pattern.test(agent))?.[1] ?? null
}

/** "Firefox on Linux", or as much of it as the agent gives away; null when it gives nothing. */
export function deviceLabel(userAgent: string, maxTouchPoints = 0): string | null {
  const browser = first(BROWSERS, userAgent)
  let system = first(SYSTEMS, userAgent)
  // iPadOS Safari asks for the desktop site by default and sends the macOS agent.
  if (system === 'macOS' && maxTouchPoints > 1) system = 'iPad'
  if (browser && system) return `${browser} on ${system}`
  if (system) return `Browser on ${system}`
  return browser
}

/** For a row saved before labels existed: the push service is all the endpoint says. */
export function serviceLabel(endpoint: string): string {
  let host: string
  try {
    host = new URL(endpoint).hostname
  } catch {
    return 'Unknown browser'
  }
  if (host === 'fcm.googleapis.com') return 'Chrome or another Chromium browser'
  if (host.endsWith('.notify.windows.com')) return 'Edge'
  if (host === 'updates.push.services.mozilla.com') return 'Firefox'
  if (host === 'web.push.apple.com') return 'Safari'
  return 'Unknown browser'
}
