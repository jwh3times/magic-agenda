# Runbook: recover from a stuck service worker

**Read this before you need it.** The first time you follow these steps should not be during an
incident.

- **Produced by:** [`src/sw.ts`](../../src/sw.ts), authored by hand (not generated — see
  `AGENTS.md`) and built by `vite-plugin-pwa` in `injectManifest` mode, then deployed as `/sw.js`
  by Cloudflare Pages on every merge to `main`.
- **What you need:** a browser to reproduce and verify with, and a PR that replaces `src/sw.ts`
  with the kill-switch version below.

## Why a service worker can get "stuck"

A service worker only updates when the browser fetches a **byte-different** `/sw.js` on a
navigation and no other tab is holding the old one open — the update then sits `waiting` until
every controlled tab closes or `applyUpdate()` in `src/lib/registerSW.ts` posts `SKIP_WAITING`
(the "new version" toast in `UpdatePrompt`). If a bad worker ships — a caching bug, a broken
`fetch` handler, a precache list that can never resolve — a normal page reload does **not** fix
it, because the reload is served by the very worker that is broken. Two outcomes matter here:

1. **Broken but still installable.** The old worker keeps serving stale or wrong responses;
   fixing `main` and merging eventually offers the fix as a normal update, same as any release.
2. **Broken badly enough that it can never reach `activate`, or `activate` succeeds but the worker
   now serves nothing usable and the tab never gets a chance to accept an update** (e.g. it
   intercepts navigations and throws, so the update toast itself never renders). This is what
   this runbook is for.

## 1. Confirm a stuck worker is the cause

Don't reach for the kill switch on a hunch — a stuck worker has a specific signature:

1. Open the affected page and do a **hard reload** (Ctrl/Cmd+Shift+R, or DevTools → Network →
   "Disable cache" then reload). Hard reload bypasses the service worker for navigation entirely.
   - If the hard reload **fixes** the page, the worker is implicated.
   - If it does **not**, the bug is not the worker — stop here and look elsewhere (a bad deploy,
     a Supabase-side issue, `_headers`/CSP).
2. DevTools → **Application → Service Workers**. Look for:
   - A registration whose **Source** version is older than the latest deployed build, sitting in
     `activated and is running` when it should have been replaced.
   - A worker stuck `waiting` for a long time with no tabs ever prompting to update (a symptom
     `registerSW.ts` cannot always paper over — see the honest limit below).
   - A worker whose `fetch` handler is visibly erroring: Console shows failed navigations, or the
     Network tab shows `(failed) net::ERR_FAILED` on `/` even though the origin server itself is
     healthy from a hard reload.
3. DevTools → **Application → Cache Storage**. `ma-precache-v1` (or the current `VERSION` in
   `src/sw.ts`) present with stale entries — e.g. an old hashed asset that 404s against the
   current deploy's manifest — corroborates a stuck worker rather than a server-side problem.

If steps 1–3 line up (hard reload works, normal reload doesn't, Service Workers panel shows an
old version, or Cache Storage holds stale entries), proceed to the kill switch.

## 2. The kill-switch worker

Replace the entire contents of `src/sw.ts` with a minimal `install`/`activate` pair that deletes
every cache, unregisters itself, and reloads every open client. It intentionally does **not**
import from `src/sw/policy.ts` or reference `self.__WB_MANIFEST` — the whole point is that it must
install and activate cleanly even if the bug that got you here is in the caching logic itself:

```ts
// Kill switch: wipes every cache this origin's worker ever wrote, unregisters, and reloads
// every controlled tab. Ships in place of the normal src/sw.ts (see
// docs/runbooks/service-worker-rollback.md) — do not merge this alongside the real worker logic.
const sw = self as unknown as ServiceWorkerGlobalScope

sw.addEventListener('install', (event) => {
  event.waitUntil(sw.skipWaiting())
})

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
      await sw.registration.unregister()
      const clients = await sw.clients.matchAll({ type: 'window' })
      for (const client of clients) client.navigate(client.url)
    })(),
  )
})
```

This still type-checks under `tsconfig.worker.json` (same `include` entry, same WebWorker lib) —
no config change needed. Do not try to be clever and make it also serve `index.html`: the goal is
the smallest possible surface area that can still activate, because the thing you are recovering
from is a worker that couldn't.

## 3. Ship it

1. Branch, replace `src/sw.ts` with the kill-switch version, and open a PR as usual — this is a
   normal merge to `main`, no special deploy path.
2. Merge once checks pass. Cloudflare Pages deploys the new `dist/sw.js` immediately.
3. **This is why network-first navigation matters** (see `src/sw.ts`'s header comment and
   `src/sw/policy.ts`'s `isNavigation`): a stuck worker with a _broken_ `fetch` handler might still
   pass navigations through to the network rather than serving a cached/failed response — that
   design choice is what keeps a bad deploy fixable at all. The browser only discovers the new
   `/sw.js` on a navigation, byte-compares it against the installed one, and — because they now
   differ — begins installing the kill switch in the background.
4. **This does not reach users instantly.** The browser checks for an update on navigation (and
   periodically in the background per browser policy), but the kill switch has to install,
   activate, and then its `activate` handler has to run before a given tab is recovered. A tab
   that is never navigated and never gets a background update check will not self-heal — see the
   honest limit below.

## 4. Confirm recovery

On an affected browser/device, after the deploy:

1. Navigate to the app (a plain link click or address-bar reload — not a hard reload, since the
   point is to prove the _normal_ path now works).
2. DevTools → **Application → Service Workers**: the kill-switch worker should appear briefly
   (`activating` → `activated`), then the panel should show **no registration at all** — its own
   `activate` handler unregistered it.
3. DevTools → **Application → Cache Storage**: empty. No `ma-precache-*` or `ma-runtime-*` keys
   left over.
4. Reload once more. The page loads with **no** service worker controlling it (Network tab shows
   real requests to the origin, not `(ServiceWorker)` in the Size column).
5. Revert `src/sw.ts` to the real worker (`git revert` the kill-switch commit, or restore it from
   `main`'s history) and merge again. The next navigation installs the real worker fresh — a clean
   `install` with no stale cache to fight, since step 2–3 above already cleared everything.
6. Confirm the app now behaves like a fresh install of the real worker: `ma-precache-v1` reappears
   in Cache Storage with the current build's asset count, and the app works offline again — the
   same checks as the installable-PWA feature's own verification checklist apply here too: no
   `*.supabase.co` entry in any cache, and an airplane-mode reload still renders the board shell.

## The honest limit

**This is mitigation, not a cure.** The kill switch only runs on a tab that actually revisits the
site after the fix ships. A user who installed the PWA to their Home Screen and never opens it
again keeps the broken worker forever — there is no push mechanism that reaches a service worker
that is never given a navigation to check on. This is also why the underlying incident should
always be fixed at the source (revert or patch the bad `src/sw.ts` logic) rather than treated as
resolved once the kill switch is deployed: the kill switch's job is to stop making things worse
for everyone who _does_ come back, not to guarantee everyone does.

Because of that limit, prefer prevention over cure: this is exactly why network-first navigation
(Task 10) must never be "optimized" to cache-first, and why `src/sw/policy.test.ts` pins the
never-cache-Supabase rule — the failure modes this runbook exists for are the ones a review or a
test can catch before they ship, which is cheaper than any recovery path.
