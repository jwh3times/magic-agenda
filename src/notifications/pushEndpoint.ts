/**
 * Which push endpoints the reminder sender will post to.
 *
 * A browser hands over its endpoint when it subscribes, and the app stores it as given, so the
 * column itself says nothing about where it points: any Account could save a URL of its choosing
 * and have the sender make a request there. The sender is the boundary (it is what makes the
 * request), and Settings checks first so an unsupported browser gets a message rather than a
 * device that silently never rings. This module is shared by both, the Edge Function included.
 *
 * The list is the push services of the browsers people use: Chrome and the other Chromium
 * browsers (Firebase Cloud Messaging), Edge (Windows Push Notification Services, one host per
 * region under `notify.windows.com`), Firefox (Mozilla autopush), and Safari on macOS and iOS
 * (Apple). A browser with another service is refused; add its host here.
 */

/** Hosts matched exactly. */
const PUSH_SERVICE_HOSTS: ReadonlySet<string> = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
])

/** Domains whose subdomains are push hosts. The dot is part of it, so the bare domain is not. */
const PUSH_SERVICE_SUFFIXES: readonly string[] = ['.notify.windows.com']

/** HTTPS on the default port, no credentials, and a host on the list above. */
export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') {
    return false
  }
  const host = url.hostname
  return (
    PUSH_SERVICE_HOSTS.has(host) || PUSH_SERVICE_SUFFIXES.some((suffix) => host.endsWith(suffix))
  )
}
