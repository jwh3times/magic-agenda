import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { seedBoard, SEEDED_TITLES } from './fixtures/seedBoard'

// No fake clock in this file, deliberately. `page.clock` can invalidate Supabase's JWT expiry
// checks (the token was issued in real time) and may not reach the service worker's separate
// context -- and the service-worker test below is the single most valuable thing here.

/**
 * Console errors, minus the ones that are not ours.
 *
 * public/_headers records that Cloudflare's injected Web Analytics beacon changes its hash
 * without notice and silently re-breaks CSP. Unscoped, that event would turn every PR red for a
 * cause unrelated to any PR.
 */
const IGNORED = [/cloudflareinsights\.com/i, /static\.cloudflareinsights/i]

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (IGNORED.some((re) => re.test(text))) return
    errors.push(text)
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  return errors
}

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('landing renders with no console errors', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Your week, on sticky notes.' })).toBeVisible()
    expect(errors).toEqual([])
  })

  test('the service worker survives a reload without breaking CSP or fonts', async ({ page }) => {
    // The bug this guards shipped TWICE (v1.2.37). A first load never reproduces it: the worker
    // is not yet controlling the page, so fonts load normally and land in the HTTP cache. Only on
    // the NEXT navigation does the worker intercept and get refused. The reload IS the test.
    const errors = collectErrors(page)
    const failed: string[] = []
    page.on('requestfailed', (req) => failed.push(`${req.url()} ${req.failure()?.errorText}`))

    await page.goto('/')
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, {
      timeout: 30_000,
    })

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Your week, on sticky notes.' })).toBeVisible()

    // Assert the @font-face rules REGISTERED, not that a family "checks".
    //
    // Two traps here, both of which make the obvious version of this test vacuous:
    //   1. document.fonts.check('16px Whatever') returns TRUE for a family with no FontFace at all.
    //      In the exact v1.2.37 failure mode -- the worker's fetch of the Google Fonts stylesheet is
    //      refused, so NO @font-face parses -- check() therefore passes. It cannot see the bug.
    //   2. There is no font called Inter in this app. index.html loads Archivo Black, Caveat,
    //      Libre Franklin, Manrope and Space Grotesk; Landing itself renders in system-ui
    //      (src/pages/Landing.tsx:60), so any loaded-status assertion fails on a healthy deploy too.
    //
    // When the stylesheet is refused, document.fonts is EMPTY. Iterating it is the signal.
    const families = await page.evaluate(async () => {
      await document.fonts.ready
      return [...new Set([...document.fonts].map((f) => f.family.replace(/['"]/g, '')))]
    })
    expect(families).toContain('Libre Franklin')

    expect(errors).toEqual([])
    expect(failed).toEqual([])
  })
})

test.describe('signed in', () => {
  test('board renders the seeded tasks', async ({ page }) => {
    await seedBoard()
    await page.goto('/')
    await expect(page.getByRole('button', { name: '+ New task' })).toBeVisible()
    await expect(page.getByText(SEEDED_TITLES[0])).toBeVisible()
  })

  test('a created task survives a reload, then can be deleted', async ({ page }) => {
    await seedBoard()
    const title = `e2e ${Date.now()}`

    await page.goto('/')
    await page.getByRole('button', { name: '+ New task' }).click()
    // The real placeholder ends in U+2026: "Task title…" (src/components/TaskEditor.tsx:231).
    await page.getByPlaceholder('Task title…').fill(title)

    // Wait for the INSERT to land, not just for the optimistic render. useTasks is
    // optimistic-with-rollback, so getByText(title) goes visible before the POST completes -- and
    // the reload below would abort the in-flight request, losing the row the next assertion wants.
    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/rest/v1/tasks') && r.ok(),
    )
    await page.getByRole('button', { name: 'Add task' }).click()
    await created
    await expect(page.getByText(title)).toBeVisible()

    await page.reload()
    await expect(page.getByText(title)).toBeVisible()

    // No window.confirm anywhere in TaskEditor -- delete is immediate for a non-recurring task, and
    // the scope prompt is in-app. Nothing here can block the session on a browser dialog.
    await page.getByText(title).click()
    await page.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText(title)).toHaveCount(0)
  })

  test('an unreachable Supabase falls back to the board snapshot', async ({ page }) => {
    // This asserts the SOURCE of the board, not merely that something rendered. The OfflineBanner
    // (role="status", text "Offline.") is set only by hydrateFromSnapshot() -- src/data/useTasks.ts
    // line 190, reached from the two load-failure paths at 205 and 221 -- and is NOT derived from
    // navigator.onLine. So the banner is positive proof that the snapshot branch ran.
    //
    // Only Supabase is cut, not the whole network, and this is deliberate. The original design was
    // context.setOffline(true) + page.reload(), which CANNOT work here: measured against the
    // deployed build, CDP offline emulation fails the top-level navigation with net::ERR_FAILED
    // before the service worker is consulted, so the reload never returns a document. The worker
    // itself is demonstrably alive under the same conditions -- a content-hashed /assets/*.js was
    // served 200 from ma-precache-v1 with the network down -- and /index.html is genuinely
    // precached (17 entries, caches.match('/index.html') hits). The shell is cached and the worker
    // works; Playwright just will not let a navigation reach it.
    //
    // Aborting Supabase reproduces exactly the condition useTasks guards -- a failed server load
    // with a snapshot present -- with no dependence on that emulation gap. What this test does NOT
    // cover is the worker serving the shell offline; src/sw/policy.test.ts covers that policy, and
    // no browser-level test in this suite exercises it.
    await seedBoard()
    await page.goto('/')
    await expect(page.getByRole('button', { name: '+ New task' })).toBeVisible()
    await expect(page.getByText(SEEDED_TITLES[0])).toBeVisible()

    // The snapshot is written on a 1s debounce after tasks settle, while Board renders the moment
    // the load resolves. Reloading offline before that write lands means readBoardSnapshot returns
    // null, hydrateFromSnapshot returns false, and the page shows ErrorScreen instead of the banner
    // -- a coin-flip failure, and retries are 0.
    //
    // Matched by PREFIX, not by an exact key: board snapshots are keyed per Board
    // (`ma-snapshot-board.<boardId>`), and this test cannot know the seeded account's board id
    // without querying for it. Waiting on the old singular `ma-snapshot-board` key is what broke
    // when snapshots became per-Board -- it simply never appears, so this timed out at 15s and
    // reported as a snapshot-fallback regression rather than as a stale test.
    await page.waitForFunction(
      () => Object.keys(localStorage).some((k) => k.startsWith('ma-snapshot-board.')),
      null,
      { timeout: 15_000 },
    )

    // The realtime WebSocket is not routable and does not need to be: the REST load failing is what
    // reaches hydrateFromSnapshot.
    await page.route(/supabase\.co/, (route) => route.abort())
    await page.reload()

    // Scoped, not a bare getByRole('status'): dnd-kit's accessibility LiveRegion is ALSO
    // role="status" and is always present, so the unscoped locator resolves two elements and
    // Playwright's strict mode throws. src/components/Board.test.tsx:53-55 documents the same trap.
    await expect(page.getByRole('status').filter({ hasText: 'Offline.' })).toBeVisible()
    await expect(page.getByText(SEEDED_TITLES[0])).toBeVisible()
  })
})

/**
 * No horizontal overflow on a phone, on every route a signed-out visitor can reach.
 *
 * The bug this guards was live in production and invisible to every other layer: a 900×260 logo
 * pinned to `height: 110` is 381px wide and cannot shrink, so /login, /auth/reset and /auth/confirm
 * each pushed the document 59px past a 390px viewport. The a11y scan cannot see it — axe has no
 * rule for "wider than the viewport" — and jsdom cannot, having no layout engine.
 *
 * The h1 wait is not decoration. Several of these routes render a full-screen `<Spinner/>` while
 * loading, and a fixed-position overlay does NOT overflow horizontally — so scanning too early
 * would pass vacuously against a loading screen. Every one of the six routes has exactly one
 * level-one heading once it has rendered.
 */
test.describe('phone-width layout', () => {
  test.use({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 390, height: 844 },
  })

  const PUBLIC_ROUTES = ['/', '/login', '/privacy', '/terms', '/auth/reset', '/auth/confirm']

  for (const route of PUBLIC_ROUTES) {
    test(`${route} does not overflow horizontally at 390px`, async ({ page }) => {
      await page.goto(route)
      await page.getByRole('heading', { level: 1 }).first().waitFor()
      await page.evaluate(async () => {
        await document.fonts.ready
      })
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(
        scrollWidth,
        `${route} is ${scrollWidth - clientWidth}px wider than the 390px viewport. Something in ` +
          'the page cannot shrink — check for a fixed-width or intrinsically-sized element.',
      ).toBeLessThanOrEqual(clientWidth)
    })
  }
})
