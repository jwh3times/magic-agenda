import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { cspSources } from '../../scripts/csp'
import { landingReady } from './fixtures/determinism'

/**
 * These probes intentionally run against the deployed Cloudflare Pages preview. Authenticated app
 * behavior belongs to the isolated local-stack run; this file owns behavior only Pages can prove:
 * its response headers, external-resource CSP, and service-worker navigation behavior.
 */

const IGNORED = [/cloudflareinsights\.com/i, /static\.cloudflareinsights/i]

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return
    const value = msg.text()
    if (IGNORED.some((pattern) => pattern.test(value))) return
    errors.push(value)
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  return errors
}

function isTurnstileHost(hostname: string): boolean {
  // Keep this exact: public/_headers permits this origin, not arbitrary challenge subdomains.
  return hostname === 'challenges.cloudflare.com'
}

function isTurnstileFrame(url: string): boolean {
  return url.startsWith('https://') && isTurnstileHost(new URL(url).hostname)
}

test('landing renders with no console errors', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/')
  // The board preview is a separate lazy chunk (#498). Asserting on the heading alone could finish
  // before that chunk loaded, so an error from fetching or rendering it could go unrecorded.
  await landingReady(page)
  expect(errors).toEqual([])
})

test('the served CSP still admits attachment thumbnails', async ({ page }) => {
  // The durable half of #407. `scripts/csp-headers.test.ts` asserts the same directive in
  // `public/_headers`; this one asserts what Cloudflare actually sent, so it also covers the file
  // being renamed, not copied into `dist/`, or overridden by a rule added elsewhere. The source
  // test cannot see any of that.
  //
  // Thumbnails are `<img>` elements whose `src` is a signed Supabase Storage URL, and an `<img>`
  // is governed by `img-src` alone. Rendering a real one is deliberately out of scope: it needs an
  // authenticated upload against the live bucket and leaves objects behind. The header carries the
  // risk, and the failure it guards is invisible — `AttachmentsSection`'s `onError` degrades a
  // refused image to the same `FILE` placeholder a PDF attachment shows.
  const response = await page.goto('/')
  const policy = response?.headers()['content-security-policy']
  expect(policy, 'Pages served no Content-Security-Policy at all').toBeTruthy()
  expect(cspSources(policy!, 'img-src')).toContain('https://*.supabase.co')
})

test('Turnstile loads under the deployed CSP', async ({ page }) => {
  const errors = collectErrors(page)
  const failedChallengeRequests: string[] = []
  page.on('requestfailed', (request) => {
    if (isTurnstileHost(new URL(request.url()).hostname)) {
      failedChallengeRequests.push(`${request.url()} ${request.failure()?.errorText}`)
    }
  })

  const scriptResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.hostname === 'challenges.cloudflare.com' &&
      url.pathname.startsWith('/turnstile/v0/') &&
      url.pathname.endsWith('/api.js') &&
      response.request().resourceType() === 'script' &&
      response.ok()
    )
  })
  await page.goto('/login')

  await scriptResponse
  // Turnstile places its iframe in a closed shadow root, so a DOM locator cannot see it. The frame
  // tree can, and proves frame-src allowed the browser to attach the challenge document.
  await expect.poll(() => page.frames().some((frame) => isTurnstileFrame(frame.url()))).toBe(true)
  expect(failedChallengeRequests).toEqual([])
  expect(errors).toEqual([])
})

test('auth token is scrubbed before an end-of-body script reads the URL', async ({ page }) => {
  const tokenHash = 'bogus-e2e-token'
  const path = `/auth/reset?token_hash=${tokenHash}&type=recovery`

  await page.route('**/__beacon_probe.js', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: 'document.documentElement.dataset.beaconProbeHref = document.location.href',
    })
  })
  await page.route(
    (url) => url.pathname === '/auth/reset' && url.searchParams.get('token_hash') === tokenHash,
    async (route) => {
      const response = await route.fetch()
      const html = await response.text()
      expect(html).toContain('</body>')
      await route.fulfill({
        response,
        body: html.replace('</body>', '<script defer src="/__beacon_probe.js"></script></body>'),
      })
    },
  )

  await page.goto(path)
  const root = page.locator('html')
  await expect(root).toHaveAttribute('data-beacon-probe-href', /.+/)
  const observedHref = await root.getAttribute('data-beacon-probe-href')

  expect(observedHref).not.toContain('token_hash')
  expect(new URL(observedHref!).search).toBe('')
})

test('the service worker survives a reload without breaking CSP or fonts', async ({ page }) => {
  // The bug this guards shipped TWICE (v1.2.37). A first load never reproduces it: the worker is
  // not yet controlling the page, so fonts load normally and land in the HTTP cache. Only on the
  // NEXT navigation does the worker intercept and get refused. The reload IS the test.
  const errors = collectErrors(page)
  const failed: string[] = []
  page.on('requestfailed', (request) =>
    failed.push(`${request.url()} ${request.failure()?.errorText}`),
  )

  await page.goto('/')
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, {
    timeout: 30_000,
  })

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Your week, on sticky notes.' })).toBeVisible()

  // document.fonts.check() returns true even when no FontFace registered. Iteration is the signal.
  const families = await page.evaluate(async () => {
    await document.fonts.ready
    return [...new Set([...document.fonts].map((font) => font.family.replace(/['"]/g, '')))]
  })
  expect(families).toContain('Libre Franklin')

  expect(errors).toEqual([])
  expect(failed).toEqual([])
})

// ——— the worker serves the shell (#284) ———
// These were believed impossible to test: CDP offline emulation "failed the top-level navigation
// before the worker was consulted". It never did. The worker answered, with a response the browser
// had to refuse: Pages redirects `/index.html` to `/`, so the precached shell was a redirected
// response, and a navigation may not be answered with one. Only the deployed preview has that
// redirect, which is why a local build passed and these live here.

const LANDING = 'Your week, on sticky notes.'

/** Loads the app and waits until the worker controls the page with its precache in place. */
async function installed(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, {
    timeout: 30_000,
  })
  await page.waitForFunction(async () => !!(await caches.match('/index.html')), null, {
    timeout: 30_000,
  })
}

test('the installed app opens with the network down', async ({ page, context }) => {
  await installed(page)
  await context.setOffline(true)

  const response = await page.reload()

  expect(response?.fromServiceWorker()).toBe(true)
  await expect(page.getByRole('heading', { name: LANDING })).toBeVisible()
})

test('a redirected shell in the cache still opens offline', async ({ page, context }) => {
  await installed(page)
  // The serve-time safety net. Install already stores a clean shell, so plant the redirected one
  // the fix exists for: `fetch` follows the 308, so this response is redirected. Read it back too,
  // because a cache that dropped the flag would let this pass without testing anything.
  const redirected = await page.evaluate(async () => {
    const response = await fetch('/index.html')
    await (await caches.open('ma-precache-v1')).put('/index.html', response)
    return (await caches.match('/index.html'))?.redirected
  })
  expect(redirected).toBe(true)
  await context.setOffline(true)

  const response = await page.reload()

  expect(response?.fromServiceWorker()).toBe(true)
  await expect(page.getByRole('heading', { name: LANDING })).toBeVisible()
})

test('an online navigation gets the newest shell, not the cached one', async ({
  page,
  context,
}) => {
  // The worker is the one deployed artifact a merge cannot reach, so navigations must be
  // network-first: cache-first would make a bad deploy permanent for everyone who installed it.
  // The worker's own fetch of the page is routed here, so the network can answer with a shell the
  // cache has never seen.
  await installed(page)
  await context.route(
    (url) => url.pathname === '/',
    async (route) => {
      const response = await route.fetch()
      const body = (await response.text()).replace('<body>', '<body><p id="newer-shell"></p>')
      await route.fulfill({ response, body })
    },
  )

  const response = await page.reload()

  expect(response?.fromServiceWorker()).toBe(true)
  await expect(page.locator('#newer-shell')).toHaveCount(1)
})
