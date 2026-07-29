/**
 * Magic Agenda's service worker. Authored here rather than generated: vite-plugin-pwa runs in
 * injectManifest mode and only supplies `self.__WB_MANIFEST`, so nothing workbox ships ends up
 * in the deployed worker.
 *
 * The load-bearing decision is that navigations are NETWORK-FIRST. A service worker is the one
 * artifact a merge to `main` cannot reach — it lives on the user's device — so an online user
 * must always receive the newest index.html. Cache-first is used only for content-hashed assets,
 * which are immutable by construction. See docs/runbooks/service-worker-rollback.md.
 */
import { isCacheFirst, isNavigation, isNeverCached } from './sw/policy'

// Typechecked under tsconfig.worker.json (WebWorker lib, no DOM). Still an `unknown` hop, not a
// direct cast: lib.webworker.d.ts types the ambient `self` generically as `WorkerGlobalScope`
// (shared by dedicated/shared/service workers alike), not narrowed to `ServiceWorkerGlobalScope`,
// so the two types don't sufficiently overlap for TS to allow a direct assertion.
const sw = self as unknown as ServiceWorkerGlobalScope

// Interface merge, not a redeclaration of `self` itself: workbox-build's injectManifest looks for
// the literal, un-aliased substring `self.__WB_MANIFEST` in the *bundled* output to know where to
// splice in the precache list — bundlers never rename a bare, unbound global reference like `self`,
// but they do rename local variables (the `sw` alias above), so reading through `sw` here would
// bundle to something injectManifest can never find. Augmenting the ambient interface lets
// `self.__WB_MANIFEST` below type-check without a second local alias.
declare global {
  interface WorkerGlobalScope {
    __WB_MANIFEST: { url: string; revision: string | null }[]
  }
}

// Bump to invalidate every cache at once.
const VERSION = 'v1'
const PRECACHE = `ma-precache-${VERSION}`
const RUNTIME = `ma-runtime-${VERSION}`
const SHELL = '/index.html'

sw.addEventListener('install', (event) => {
  // The injected manifest emits root-relative URLs with no leading slash (e.g. "index.html"), so
  // deduping on the raw strings misses that "index.html" and SHELL ("/index.html") resolve to the
  // same request. cache.addAll's Batch Cache Operations algorithm rejects a batch containing two
  // entries that resolve to the same request (TypeError: duplicate requests), which would fail
  // install every time. Resolve everything to an absolute URL first, then dedupe on that.
  const base = sw.location.href
  const urls = self.__WB_MANIFEST.map((e) => new URL(e.url, base).href)
  const toPrecache = [...new Set([...urls, new URL(SHELL, base).href])]
  event.waitUntil(caches.open(PRECACHE).then((cache) => cache.addAll(toPrecache)))
})

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => k !== PRECACHE && k !== RUNTIME).map((k) => caches.delete(k)),
      )
      await sw.clients.claim()
    })(),
  )
})

sw.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void sw.skipWaiting()
})

async function networkFirst(request: Request): Promise<Response> {
  try {
    const res = await fetch(request)
    if (res.ok) {
      const cache = await caches.open(PRECACHE)
      await cache.put(SHELL, res.clone())
    }
    return res
  } catch {
    const cached = (await caches.match(SHELL)) ?? (await caches.match(request))
    if (cached) return cached
    throw new Error('offline and no cached shell')
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const res = await fetch(request)
    if (res.ok || res.type === 'opaque') {
      const cache = await caches.open(RUNTIME)
      await cache.put(request, res.clone())
    }
    return res
  } catch {
    // The fetch was refused outright — CSP, offline, DNS. This branch must never rethrow.
    //
    // It exists because of a real production failure (v1.2.36): the worker's fetch of the Google
    // Fonts stylesheet was CSP-blocked by a too-narrow connect-src, this function had no catch,
    // and the rejection reached respondWith() — which turns ONE unavailable asset into a hard
    // NetworkError for the page, taking out the whole stylesheet for every controlled visitor.
    // The connect-src is fixed (see public/_headers), but the fragility was the real defect: any
    // future font-host outage would do the same. Fail soft instead.
    //
    // Retry the cache ignoring the query string first. Google Fonts URLs carry a long `family=`
    // query, so a previously cached response for a near-identical URL is a better answer than
    // nothing. Otherwise return a network error for THIS request only — the page survives, the
    // one asset does not.
    const stale = await caches.match(request, { ignoreSearch: true })
    return stale ?? Response.error()
  }
}

sw.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (isNeverCached(url)) return // straight to the network, never observed
  if (isNavigation(request)) {
    event.respondWith(networkFirst(request))
    return
  }
  if (isCacheFirst(url, sw.location.origin)) event.respondWith(cacheFirst(request))
})
