import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

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
  await expect(page.getByRole('heading', { name: 'Your week, on sticky notes.' })).toBeVisible()
  expect(errors).toEqual([])
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
