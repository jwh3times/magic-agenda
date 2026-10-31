import { expect, test, type Page } from '@playwright/test'
import { seedBoard, SEEDED_TITLES } from './fixtures/seedBoard'

// No fake clock in this file, deliberately. `page.clock` can invalidate Supabase's JWT expiry
// checks because the token was issued in real time.

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
    // Only Supabase is cut, not the whole network, and this is deliberate: it is exactly the
    // condition useTasks guards, a failed server load with a snapshot present. The service worker
    // serving the shell offline is a different claim, tested in preview.spec.ts against the
    // deployed preview: only Cloudflare Pages redirects /index.html, which is what broke it
    // (#284), so a local build cannot test it honestly.
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
    // reaches hydrateFromSnapshot. Match the configured adapter instead of a production hostname;
    // CI intentionally points this suite at its isolated local stack.
    const supabaseURL = process.env.E2E_SUPABASE_URL
    if (!supabaseURL) throw new Error('E2E_SUPABASE_URL is unset')
    const supabaseOrigin = new URL(supabaseURL).origin
    await page.route(
      (url) => url.href.startsWith(`${supabaseOrigin}/`),
      (route) => route.abort(),
    )
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

/**
 * The landing page's board preview must not move the page when it loads (#499).
 *
 * The preview is a lazy chunk behind a placeholder, and the placeholder used to be shorter than the
 * preview: 196 px against 229-270 px, so the theme buttons and feature list jumped down. Both now
 * share a reserved height (`src/components/landing/previewHeight.ts`) that the preview fills.
 *
 * The chunk is held back so the placeholder is measurable at all; on a fast local server it is
 * replaced before a test can see it. Then every theme must render at exactly that height, which
 * fails as soon as one outgrows the reservation. 360 px is the narrowest width the reservation
 * covers; 761 px is the narrowest desktop width, where the four columns wrap the most.
 */
test.describe('landing preview height', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const width of [360, 390, 761, 1280]) {
    test(`the preview fills its placeholder's height at ${width}px, in every theme`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      let release: () => void = () => {}
      const held = new Promise<void>((resolve) => (release = resolve))
      await page.route('**/assets/BoardPreview-*.js', async (route) => {
        await held
        await route.continue()
      })
      await page.goto('/')
      const region = page.getByRole('region', { name: 'Live board preview' })
      const placeholder = region.locator(':scope > div[aria-hidden="true"]:not([inert])')
      const reserved = (await placeholder.boundingBox())?.height
      if (!reserved) throw new Error('the preview placeholder did not render')

      release()
      const preview = region.locator(':scope > [inert]')
      await preview.waitFor()
      await page.evaluate(async () => {
        await document.fonts.ready
      })
      for (const theme of ['Cork', 'Neon-Brutalist', 'Aurora-Glass']) {
        await page.getByRole('button', { name: theme, exact: true }).click()
        await expect(page.getByRole('button', { name: theme, exact: true })).toHaveAttribute(
          'aria-pressed',
          'true',
        )
        const height = (await preview.boundingBox())?.height
        expect(
          height,
          `the ${theme} preview is ${height}px against a ${reserved}px placeholder at ${width}px. ` +
            'Raise PREVIEW_HEIGHT in src/components/landing/previewHeight.ts.',
        ).toBeCloseTo(reserved, 0)
      }
    })
  }
})

/**
 * The signed-in Board at phone width (#564). The public routes above say nothing about it, and it
 * is where the phone controls live: jsdom has no layout engine, so only here can a header that takes
 * three rows, or a row that pushes the page wider, fail.
 */
test.describe('phone-width board', () => {
  /** The two toolbar rows and their padding, with a little room for a theme's border. */
  const MAX_HEADER_HEIGHT = 96

  async function openBoard(page: Page, seed: Parameters<typeof seedBoard>[0]) {
    await seedBoard(seed)
    await page.goto('/')
    await page.getByRole('button', { name: '+ New task' }).waitFor()
    await page.getByRole('combobox', { name: 'Board' }).waitFor()
    await page.evaluate(async () => {
      await document.fonts.ready
    })
  }

  async function expectNoOverflow(page: Page, what: string) {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(
      scrollWidth,
      `${what} is ${scrollWidth - clientWidth}px wider than the viewport.`,
    ).toBeLessThanOrEqual(clientWidth)
  }

  test.describe('at 390×844', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    for (const view of ['calendar', 'week', 'agenda', 'kanban'] as const) {
      test(`${view} fits, with the controls shut and open`, async ({ page }) => {
        await openBoard(page, { view })
        await expectNoOverflow(page, `The ${view} view`)

        // The freed height reaches the content: nothing sits between the header and the board.
        const header = await page.getByRole('banner').boundingBox()
        const main = await page.getByRole('main').boundingBox()
        if (!header || !main) throw new Error('the board did not render')
        expect(header.height).toBeLessThanOrEqual(MAX_HEADER_HEIGHT)
        expect(main.y).toBeCloseTo(header.y + header.height, 0)
        await expect(page.getByRole('textbox', { name: 'Search tasks' })).toHaveCount(0)

        await page.getByRole('button', { name: 'Search and filters' }).click()
        await expect(page.getByRole('textbox', { name: 'Search tasks' })).toBeVisible()
        await expectNoOverflow(page, `The ${view} view with its controls open`)
      })
    }

    // A real keypress as well as the unit test's: focus now moves during the keydown, and a browser
    // that still ran the key's default action would put the "/" into the box it just opened.
    test('the search shortcut opens the controls and focuses an empty search box', async ({
      page,
    }) => {
      await openBoard(page, { view: 'calendar' })
      await page.keyboard.press('/')
      const search = page.getByRole('textbox', { name: 'Search tasks' })
      await expect(search).toBeFocused()
      await expect(search).toHaveValue('')
    })
  })

  // The narrowest common phone, per theme: their fonts differ in width, and the first toolbar row
  // has to hold all four view buttons without scrolling any of them out of sight.
  test.describe('at 360×800', () => {
    test.use({ viewport: { width: 360, height: 800 } })

    for (const theme of ['cork', 'brutal', 'glass'] as const) {
      test(`the ${theme} header keeps two rows and every control in view`, async ({ page }) => {
        await openBoard(page, { theme, view: 'calendar' })
        await expectNoOverflow(page, `The ${theme} board`)

        const banner = page.getByRole('banner')
        const header = await banner.boundingBox()
        if (!header) throw new Error('the header did not render')
        expect(header.height).toBeLessThanOrEqual(MAX_HEADER_HEIGHT)

        for (const name of ['Calendar', 'Week', 'Agenda', 'Board', 'Today']) {
          const box = await banner.getByRole('button', { name, exact: true }).boundingBox()
          if (!box) throw new Error(`${name} did not render`)
          expect(box.x + box.width, `${name} runs off the screen`).toBeLessThanOrEqual(360 - 10)
        }
        for (const name of ['Search and filters', 'Settings', '+ New task']) {
          await expect(banner.getByRole('button', { name, exact: true })).toBeInViewport({
            ratio: 1,
          })
        }
      })
    }
  })
})

/**
 * Settings at phone width, signed in, per theme (#464). Its section lists hold rows of a text
 * field beside themed buttons, and a grid column cannot shrink below a text input's default
 * ~20-character width. That pushed a Label row's Delete button 35-57px off a 402px phone before
 * `rowListStyle` let the column shrink. 360px is the narrowest common phone width, and the themes
 * differ in border and padding widths, so each gets its own run.
 */
test.describe('phone-width settings', () => {
  test.use({ viewport: { width: 360, height: 800 } })

  for (const theme of ['cork', 'brutal', 'glass'] as const) {
    test(`settings (${theme}) does not overflow horizontally at 360px`, async ({ page }) => {
      await seedBoard({ theme })
      await page.goto('/settings')
      await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
      // The sections that load on their own: Labels must have rows, and History must be done.
      await page
        .getByRole('button', { name: /^Delete / })
        .first()
        .waitFor()
      await page.getByText('No completed tasks on this Board yet.').waitFor()
      await page.evaluate(async () => {
        await document.fonts.ready
      })
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(
        scrollWidth,
        `Settings (${theme}) is ${scrollWidth - clientWidth}px wider than the 360px viewport.`,
      ).toBeLessThanOrEqual(clientWidth)
    })
  }
})
