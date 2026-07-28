// Caching policy as pure predicates. It lives apart from sw.ts because a service worker
// cannot run in jsdom, and this is the part that must not be wrong: a Supabase response in
// a cache shared by every profile on the device would leak one user's board to another.

const SUPABASE_HOST = /(^|\.)supabase\.co$/i
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com'])

/** Auth-scoped data. Never written to any cache, over any scheme. */
export function isNeverCached(url: URL): boolean {
  return SUPABASE_HOST.test(url.hostname)
}

/**
 * Immutable by construction (content-hashed build assets) or safe to serve stale (fonts).
 * Everything else — including the HTML shell — goes to the network first.
 */
export function isCacheFirst(url: URL, origin: string): boolean {
  if (isNeverCached(url)) return false
  if (FONT_HOSTS.has(url.hostname)) return true
  return url.origin === origin && url.pathname.startsWith('/assets/')
}

export function isNavigation(request: { mode: string; destination: string }): boolean {
  return request.mode === 'navigate' || request.destination === 'document'
}
