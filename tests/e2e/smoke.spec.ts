import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedBoard, SEEDED_TITLES } from './fixtures/seedBoard'
import { testBoardId, testClient } from './fixtures/supabase'

// No fake clock in this file, deliberately. `page.clock` can invalidate Supabase's JWT expiry
// checks because the token was issued in real time.

const todaysDay = () => new Date().toISOString().slice(0, 10)

/** One column of a seeded Task's row. A failed query fails the test rather than reading as empty. */
async function savedColumn(title: string, column: 'day' | 'status') {
  const client = await testClient()
  const boardId = await testBoardId(client)
  const { data, error } = await client
    .from('tasks')
    .select(column)
    .eq('board_id', boardId)
    .eq('title', title)
    .single()
  if (error) throw new Error(`reading ${title} failed: ${error.message}`)
  return (data as Record<string, string | null>)[column]
}

/** The Scheduled Day in the database, which an unscheduled Task has none of. */
async function savedDay(title: string): Promise<string | null> {
  return savedColumn(title, 'day')
}

const savedStatus = (title: string) => savedColumn(title, 'status')

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

// A hover on these layouts moves the Task on screen straight away, so a cancel has something to undo.
test.describe('cancelling a drag (#583)', () => {
  const [FIRST, SCHEDULED, UNSCHEDULED] = SEEDED_TITLES

  const inbox = (page: Page) => page.getByRole('complementary', { name: 'Inbox' })

  async function open(page: Page, view: 'calendar' | 'week') {
    await seedBoard({ view })
    await page.goto('/')
    await expect(inbox(page).getByText(UNSCHEDULED)).toBeVisible()
    await expect(page.getByText(FIRST)).toBeVisible()
  }

  async function centre(locator: Locator) {
    const found = await locator.boundingBox()
    if (!found) throw new Error('the element did not render')
    return { x: found.x + found.width / 2, y: found.y + found.height / 2 }
  }

  /** Picks `title` up and carries it over `onto`, whose lane it then moves into on screen. */
  async function carry(page: Page, title: string, onto: Locator) {
    const card = page.getByText(title, { exact: true })
    // An earlier drag across a calendar cell can leave the cell scrolled with this text clipped
    // (#595), and a press aimed at clipped text lands on whatever is showing there instead.
    await card.scrollIntoViewIfNeeded()
    await onto.scrollIntoViewIfNeeded()
    const from = await centre(card)
    const to = await centre(onto)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 })
    await page.mouse.move(to.x, to.y, { steps: 12 })
  }

  /**
   * Carries the Inbox card over `onto` until it has moved out of the Inbox on screen. Its row can be
   * replaced during the hover, by a late realtime event from seeding for one, which sends it back.
   * dnd-kit doesn't report the same target twice, so that takes going back and hovering again.
   */
  async function hoverOutOfInbox(page: Page, onto: Locator) {
    const from = await centre(inbox(page).getByText(UNSCHEDULED, { exact: true }))
    const to = await centre(onto)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 })
    await expect(async () => {
      await page.mouse.move(from.x, from.y, { steps: 2 })
      await page.mouse.move(to.x, to.y, { steps: 12 })
      await expect(inbox(page).getByText(UNSCHEDULED)).toHaveCount(0, { timeout: 1000 })
    }).toPass({ timeout: 10000 })
  }

  for (const view of ['calendar', 'week'] as const) {
    test(`Escape after a hover move puts the Task back (${view})`, async ({ page }) => {
      await open(page, view)
      await hoverOutOfInbox(page, page.getByText(FIRST, { exact: true }))

      await page.keyboard.press('Escape')
      await page.mouse.up()
      await expect(inbox(page).getByText(UNSCHEDULED)).toBeVisible()

      await page.reload()
      await expect(inbox(page).getByText(UNSCHEDULED)).toBeVisible()
      expect(await savedDay(UNSCHEDULED)).toBeNull()
    })
  }

  test('Escape after a hover move puts the Task back in its Kanban column', async ({ page }) => {
    await seedBoard({ view: 'kanban' })
    await page.goto('/')
    const card = page.getByText(FIRST, { exact: true })
    await expect(card).toBeVisible()
    const columnBefore = (await card.boundingBox())?.x
    const statusBefore = await savedStatus(FIRST)
    const elsewhere = statusBefore === 'doing' ? 'Completed' : 'In Progress'

    await carry(page, FIRST, page.locator('span', { hasText: new RegExp(`^${elsewhere}$`) }))
    await page.keyboard.press('Escape')
    await page.mouse.up()

    // Once the drag overlay's copy of the card has gone.
    await expect(card).toHaveCount(1)
    await expect.poll(async () => (await card.boundingBox())?.x).toBe(columnBefore)
    expect(await savedStatus(FIRST)).toBe(statusBefore)
  })

  test('a keyboard drag cancelled with Escape puts the Task back', async ({ page }) => {
    await open(page, 'calendar')
    await inbox(page).getByRole('button', { name: UNSCHEDULED }).focus()
    await page.keyboard.press('Space')
    // The sensor starts listening for arrows a moment after the pick-up, so keep pressing.
    await expect(async () => {
      await page.keyboard.press('ArrowLeft')
      await expect(inbox(page).getByText(UNSCHEDULED)).toHaveCount(0, { timeout: 300 })
    }).toPass({ timeout: 5000 })

    await page.keyboard.press('Escape')
    await expect(inbox(page).getByText(UNSCHEDULED)).toBeVisible()
    expect(await savedDay(UNSCHEDULED)).toBeNull()
  })

  test('a later drag on the same lane does not save the cancelled move', async ({ page }) => {
    await open(page, 'calendar')
    await hoverOutOfInbox(page, page.getByText(FIRST, { exact: true }))
    await page.keyboard.press('Escape')
    await page.mouse.up()
    // Once the drag overlay's copy of the card has gone. It flies back to the Inbox, and a press on
    // anything it crosses on the way lands on the overlay, so no drag starts.
    await expect(page.getByText(UNSCHEDULED)).toHaveCount(1)

    // A real move into the lane the cancelled drag went through, which writes that whole lane.
    await carry(page, SCHEDULED, page.getByText(FIRST, { exact: true }))
    await page.mouse.up()
    await expect.poll(() => savedDay(SCHEDULED)).toBe(todaysDay())

    expect(await savedDay(UNSCHEDULED)).toBeNull()
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

  // The install suggestion has its own tests below, and these measure the Board without it.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('ma-install-banner-dismissed', '1'))
  })

  async function openBoard(page: Page, seed: Parameters<typeof seedBoard>[0]) {
    await seedBoard(seed)
    await page.goto('/')
    await page.getByRole('button', { name: '+ New task' }).waitFor()
    await page.getByRole('combobox', { name: 'Board' }).waitFor()
    await page.evaluate(async () => {
      await document.fonts.ready
    })
  }

  /** More Tasks on the seeded day, then a reload so the panel shows them. */
  async function addTasksToday(page: Page, count: number) {
    const client = await testClient()
    const boardId = await testBoardId(client)
    const today = new Date().toISOString().slice(0, 10)
    const { error } = await client.from('tasks').insert(
      Array.from({ length: count }, (_, i) => ({
        board_id: boardId,
        title: `Extra task ${i}`,
        day: today,
        order_index: i + 1,
        status: 'todo',
        color: 'yellow',
      })),
    )
    if (error) throw new Error(`adding tasks failed: ${error.message}`)
    await page.reload()
    await page.getByRole('button', { name: '+ New task' }).waitFor()
  }

  /**
   * Not the document's width, which the checks above use: `.app-root` is `overflow: hidden`, so the
   * Board clips anything too wide and the document can never report it. Each of the shell's layers
   * is measured instead, skipping the absolutely placed glass blobs, which overhang on purpose. A
   * scroller inside a layer (the month grid, the kanban columns) keeps its overflow to itself.
   */
  async function expectNoOverflow(page: Page, what: string) {
    const { widest, available } = await page.evaluate(() => {
      const root = document.querySelector('.app-root')
      if (!root) throw new Error('the board shell did not render')
      const layers = [...root.children].filter((el) =>
        ['static', 'relative'].includes(getComputedStyle(el).position),
      )
      const edges = layers.map((el) => {
        const { left, right } = el.getBoundingClientRect()
        return Math.max(right, left + el.scrollWidth)
      })
      return { widest: Math.max(...edges), available: root.clientWidth }
    })
    expect(
      widest,
      `${what} is ${widest - available}px wider than the viewport.`,
    ).toBeLessThanOrEqual(available)
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

    test('the month fits the screen: seven weekdays and every week, with no sideways scrolling', async ({
      page,
    }) => {
      await openBoard(page, { view: 'calendar' })
      for (const weekday of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
        await expect(page.getByRole('main').getByText(weekday, { exact: true })).toBeInViewport({
          ratio: 1,
        })
      }
      const days = page.getByRole('button', { name: /^\w+day \d+ \w+, / })
      await expect(days).toHaveCount(42)
      await expect(days.last()).toBeInViewport({ ratio: 1 })
      const main = page.getByRole('main')
      const sideways = await main.evaluate((el) =>
        [el, ...el.querySelectorAll('*')].some(
          (node) =>
            node.scrollWidth > node.clientWidth &&
            ['auto', 'scroll'].includes(getComputedStyle(node).overflowX),
        ),
      )
      expect(sideways, 'something in the Calendar view scrolls sideways').toBe(false)
    })

    test('a long panel scrolls on its own, and the grid keeps its height', async ({ page }) => {
      await openBoard(page, { view: 'calendar' })
      const firstDay = page.getByRole('button', { name: /^\w+day \d+ \w+, / }).first()
      const before = await firstDay.boundingBox()
      if (!before) throw new Error('the grid did not render')

      await addTasksToday(page, 12)

      const panel = page.getByRole('tabpanel')
      await expect(panel.getByText('Extra task 11')).toBeAttached()
      const after = await firstDay.boundingBox()
      expect(after?.height).toBe(before.height)
      expect(after?.height).toBeGreaterThanOrEqual(44)
      const scrolls = await panel.evaluate((el) => {
        const list = el.firstElementChild as HTMLElement
        return list.scrollHeight > list.clientHeight
      })
      expect(scrolls, 'the panel should scroll inside itself').toBe(true)
      await expect(firstDay).toBeInViewport({ ratio: 1 })
    })

    test('dragging within the panel reorders, and the new order survives a reload', async ({
      page,
    }) => {
      await openBoard(page, { view: 'calendar' })
      await addTasksToday(page, 1)
      const panel = page.getByRole('tabpanel')
      const titles = () => panel.getByText(/^(Draft the launch note|Extra task 0)$/).allInnerTexts()
      await expect.poll(titles).toEqual(['Draft the launch note', 'Extra task 0'])

      const box = async (text: string) => {
        const found = await panel.getByText(text).boundingBox()
        if (!found) throw new Error(`${text} did not render`)
        return found
      }
      const from = await box('Extra task 0')
      const to = await box('Draft the launch note')
      await page.mouse.move(from.x + 10, from.y + 5)
      await page.mouse.down()
      await page.mouse.move(from.x + 10, from.y - 10, { steps: 5 })
      await page.mouse.move(to.x + 10, to.y + 2, { steps: 10 })
      await page.mouse.up()
      await expect.poll(titles).toEqual(['Extra task 0', 'Draft the launch note'])

      // The screen moves first, so read the row order too: a reload before the write lands would
      // show the old order and blame the app for a race in this test.
      const client = await testClient()
      const boardId = await testBoardId(client)
      await expect
        .poll(async () => {
          const { data } = await client
            .from('tasks')
            .select('title')
            .eq('board_id', boardId)
            .eq('day', new Date().toISOString().slice(0, 10))
            .order('order_index')
          return data?.map((row) => String(row.title))
        })
        .toEqual(['Extra task 0', 'Draft the launch note'])

      await page.reload()
      await expect(panel.getByText('Extra task 0')).toBeVisible()
      await expect.poll(titles).toEqual(['Extra task 0', 'Draft the launch note'])
    })

    test.describe('dragging a panel card onto the grid (#566)', () => {
      /** A day in the visible month that isn't the selected one: today's neighbour in the grid. */
      async function neighbour(page: Page) {
        const days = page.getByRole('button', { name: /^\w+day \d+ \w+, / })
        const selected = await days.evaluateAll((all) =>
          all.findIndex((el) => el.getAttribute('aria-pressed') === 'true'),
        )
        return days.nth(selected === 0 ? 1 : selected - 1)
      }

      async function centre(locator: Locator) {
        const found = await locator.boundingBox()
        if (!found) throw new Error('the element did not render')
        return { x: found.x + found.width / 2, y: found.y + found.height / 2 }
      }

      async function pickUp(page: Page, title: string) {
        const from = await centre(page.getByRole('tabpanel').getByText(title))
        await page.mouse.move(from.x, from.y)
        await page.mouse.down()
        await page.mouse.move(from.x, from.y - 10, { steps: 5 })
      }

      test('a drop lands on the highlighted day, and survives a reload', async ({ page }) => {
        await openBoard(page, { view: 'calendar' })
        const title = 'Draft the launch note'
        const target = await neighbour(page)
        // By position, because a day's name changes with what it holds.
        const targetIndex = await target.evaluate((el) =>
          [...(el.parentElement as HTMLElement).children].indexOf(el),
        )
        const landed = page.getByRole('button', { name: /^\w+day \d+ \w+, / }).nth(targetIndex)
        await expect(landed).toHaveAccessibleName(/, no tasks$/)
        await expect(page.getByRole('tabpanel').getByText(title)).toBeVisible()

        await pickUp(page, title)
        const to = await centre(target)
        await page.mouse.move(to.x, to.y, { steps: 10 })

        // Hovering highlights and names the day, and moves nothing.
        await expect(page.getByText(/^→ /)).toBeVisible()
        await expect(target).toHaveCSS('outline-style', 'solid')
        expect(await savedDay(title)).toBe(todaysDay())

        await page.mouse.up()

        // The panel stays on the source day, and the target's name and markers now count the Task.
        await expect(page.getByRole('tabpanel').getByText(title)).toHaveCount(0)
        await expect(landed).toHaveAccessibleName(/, 1 task/)
        await expect(landed.getByTestId('day-marker')).toHaveCount(1)

        await expect.poll(() => savedDay(title)).not.toBe(todaysDay())
        const moved = await savedDay(title)

        await page.reload()
        await expect(landed).toHaveAccessibleName(/, 1 task/)
        await expect(page.getByRole('tabpanel').getByText(title)).toHaveCount(0)
        expect(await savedDay(title)).toBe(moved)
      })

      test('a drop offers Undo, which puts the Task back', async ({ page }) => {
        await openBoard(page, { view: 'calendar' })
        const title = 'Draft the launch note'
        const target = await neighbour(page)
        await pickUp(page, title)
        const to = await centre(target)
        await page.mouse.move(to.x, to.y, { steps: 10 })
        await page.mouse.up()

        await expect(page.getByText(`Moved “${title}”`)).toBeVisible()
        await expect.poll(() => savedDay(title)).not.toBe(todaysDay())
        await page.getByRole('button', { name: 'Undo' }).click()

        await expect(page.getByRole('tabpanel').getByText(title)).toBeVisible()
        await expect.poll(() => savedDay(title)).toBe(todaysDay())
      })

      test('a drop on the Inbox tab moves the Task there, and a day takes it back', async ({
        page,
      }) => {
        await openBoard(page, { view: 'calendar' })
        const title = 'Draft the launch note'
        const inboxTab = page.getByRole('tab', { name: /^Inbox/ })
        await expect(page.getByRole('tabpanel').getByText(title)).toBeVisible()

        await pickUp(page, title)
        const tab = await centre(inboxTab)
        await page.mouse.move(tab.x, tab.y, { steps: 10 })
        await expect(page.getByText('→ Inbox')).toBeVisible()
        await expect(inboxTab).toHaveCSS('outline-style', 'solid')
        await page.mouse.up()
        await expect(inboxTab).toHaveAccessibleName('Inbox, 2 tasks')
        await expect.poll(() => savedDay(title)).toBeNull()

        await inboxTab.click()
        await pickUp(page, title)
        const selected = page.getByRole('button', { pressed: true, name: /^\w+day \d+ \w+, / })
        const day = await centre(selected)
        await page.mouse.move(day.x, day.y, { steps: 10 })
        await page.mouse.up()
        await expect(inboxTab).toHaveAccessibleName('Inbox, 1 task')
        await expect.poll(() => savedDay(title)).toBe(todaysDay())
      })

      // Chromium's touch input, which reaches TouchSensor and the browser's own scrolling as the
      // mouse tests can't. It isn't an iPhone.
      test.describe('by touch', () => {
        test.use({ hasTouch: true, isMobile: true })

        async function touchscreen(page: Page) {
          const cdp = await page.context().newCDPSession(page)
          const at = (point: { x: number; y: number }) => ({ touchPoints: [point] })
          return {
            start: (point: { x: number; y: number }) =>
              cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', ...at(point) }),
            move: (point: { x: number; y: number }) =>
              cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', ...at(point) }),
            end: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
            cancel: () =>
              cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }),
          }
        }

        /** Long enough for the 250ms press, then far enough to start moving. */
        async function pressAndCarry(
          page: Page,
          touch: Awaited<ReturnType<typeof touchscreen>>,
          from: { x: number; y: number },
          to: { x: number; y: number },
        ) {
          await touch.start(from)
          await page.waitForTimeout(350)
          const steps = 10
          for (let i = 1; i <= steps; i++) {
            await touch.move({
              x: from.x + ((to.x - from.x) * i) / steps,
              y: from.y + ((to.y - from.y) * i) / steps,
            })
          }
        }

        test('a swipe over a card scrolls the panel and picks nothing up', async ({ page }) => {
          await openBoard(page, { view: 'calendar' })
          await addTasksToday(page, 12)
          const panel = page.getByRole('tabpanel')
          const list = panel.locator('> div').first()
          const touch = await touchscreen(page)

          const from = await centre(panel.getByText('Extra task 1', { exact: true }))
          await touch.start(from)
          for (let i = 1; i <= 15; i++) {
            await touch.move({ x: from.x, y: from.y - i * 12 })
            await page.waitForTimeout(10)
          }
          await touch.end()

          await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(50)
          await expect(page.getByText(/^→ /)).toHaveCount(0)
          await expect(page.getByRole('status')).toHaveText('')
        })

        test('a long press drags a card to a day, where it lands', async ({ page }) => {
          await openBoard(page, { view: 'calendar' })
          const title = 'Draft the launch note'
          const touch = await touchscreen(page)
          const target = await neighbour(page)

          await pressAndCarry(
            page,
            touch,
            await centre(page.getByRole('tabpanel').getByText(title)),
            await centre(target),
          )
          await expect(page.getByText(/^→ /)).toBeVisible()
          await expect(target).toHaveCSS('outline-style', 'solid')
          await touch.end()

          await expect(page.getByRole('tabpanel').getByText(title)).toHaveCount(0)
          await expect.poll(() => savedDay(title)).not.toBe(todaysDay())
        })

        test('a cancelled touch leaves the Task where it was', async ({ page }) => {
          await openBoard(page, { view: 'calendar' })
          const title = 'Draft the launch note'
          const touch = await touchscreen(page)
          const target = await neighbour(page)

          await pressAndCarry(
            page,
            touch,
            await centre(page.getByRole('tabpanel').getByText(title)),
            await centre(target),
          )
          await expect(target).toHaveCSS('outline-style', 'solid')
          await touch.cancel()

          await expect(page.getByText(/^→ /)).toHaveCount(0)
          await expect(page.getByRole('tabpanel').getByText(title)).toBeVisible()
          expect(await savedDay(title)).toBe(todaysDay())
        })
      })

      test('letting go over nothing leaves the Task where it was', async ({ page }) => {
        await openBoard(page, { view: 'calendar' })
        const title = 'Draft the launch note'
        await pickUp(page, title)
        await page.mouse.move(195, 5, { steps: 10 })
        await page.mouse.up()
        await expect(page.getByRole('tabpanel').getByText(title)).toBeVisible()
        expect(await savedDay(title)).toBe(todaysDay())
      })

      test('Escape cancels a drag held over a day', async ({ page }) => {
        await openBoard(page, { view: 'calendar' })
        const title = 'Draft the launch note'
        const target = await neighbour(page)
        await pickUp(page, title)
        const to = await centre(target)
        await page.mouse.move(to.x, to.y, { steps: 10 })
        await expect(target).toHaveCSS('outline-style', 'solid')
        await page.keyboard.press('Escape')
        await page.mouse.up()
        await expect(page.getByRole('tabpanel').getByText(title)).toBeVisible()
        expect(await savedDay(title)).toBe(todaysDay())
      })
    })

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

    test('the controls button shows a visible marker while a filter is active', async ({
      page,
    }) => {
      await openBoard(page, { view: 'calendar' })
      const marker = page.getByRole('banner').getByTestId('filter-marker')
      await expect(marker).toHaveCount(0)

      await page.getByRole('button', { name: 'Search and filters' }).click()
      await page.getByRole('button', { name: 'Show pinned only' }).click()
      // Shut, because that is when the marker is the only sign that the board is filtered.
      await page.getByRole('button', { name: 'Search and filters, filters active' }).click()
      await expect(marker).toBeVisible()
      await expect(marker).toBeInViewport({ ratio: 1 })
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

        // The longest month name, wherever the real clock happens to be.
        const label = banner.getByText(/^[A-Z][a-z]+ \d{4}$/)
        for (let i = 0; i < 12 && !(await label.innerText()).startsWith('September'); i++) {
          await banner.getByRole('button', { name: '‹' }).click()
        }
        await expect(label).toContainText('September')
        expect(
          await label.evaluate((el) => el.scrollWidth <= el.clientWidth),
          '"September" does not fit the month label',
        ).toBe(true)
        expect((await banner.boundingBox())?.height).toBeLessThanOrEqual(MAX_HEADER_HEIGHT)

        // The widest Today a real board plausibly shows. Text rather than twelve seeded Tasks,
        // because only its width matters here.
        await banner.getByRole('button', { name: /^Today/ }).evaluate((button) => {
          button.textContent = 'Today (12)'
        })
        expect(
          (await banner.boundingBox())?.height,
          'a two-digit overdue count pushes the header onto a third row',
        ).toBeLessThanOrEqual(MAX_HEADER_HEIGHT)
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

/**
 * The Install the app section (#567). Playwright can't install anything and Chromium won't offer a
 * real prompt here, so a simulated event drives the button's logic: this says nothing about a real
 * Android phone, which none of this has been checked on.
 */
test.describe('Install the app', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  /** Fire the browser's prompt event, and record on the page whether it gets shown. */
  const offerPrompt = (page: Page, outcome: 'accepted' | 'dismissed') =>
    page.evaluate((outcome) => {
      const event = new Event('beforeinstallprompt', { cancelable: true })
      Object.assign(event, {
        prompt: () => {
          document.documentElement.dataset.promptShown = 'yes'
          return Promise.resolve()
        },
        userChoice: Promise.resolve({ outcome }),
      })
      window.dispatchEvent(event)
    }, outcome)

  const section = (page: Page) => page.getByRole('region', { name: 'Install the app' })

  async function openBoard(page: Page) {
    await seedBoard({ theme: 'cork' })
    await page.goto('/')
    await page.getByRole('button', { name: '+ New task' }).waitFor()
  }

  /** The prompt fires on the Board, and Settings opens later without a reload, as it would for real. */
  async function offerThenOpenSettings(page: Page, outcome: 'accepted' | 'dismissed') {
    await seedBoard({ theme: 'cork' })
    await page.goto('/')
    const settings = page.getByRole('button', { name: 'Settings', exact: true })
    await settings.waitFor()
    await offerPrompt(page, outcome)
    await settings.click()
    await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
  }

  test('a prompt that fired before Settings opened is still there, and accepting it installs', async ({
    page,
  }) => {
    await offerThenOpenSettings(page, 'accepted')

    await section(page).getByRole('button', { name: 'Install the app' }).click()

    await expect(section(page).getByText("You've installed Magic Agenda.")).toBeVisible()
    await expect(section(page).getByRole('button')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.dataset.promptShown)).toBe('yes')
  })

  test('dismissing the prompt leaves the written steps', async ({ page }) => {
    await offerThenOpenSettings(page, 'dismissed')

    await section(page).getByRole('button', { name: 'Install the app' }).click()

    await expect(section(page).getByText("Open your browser's menu")).toBeVisible()
    await expect(section(page).getByRole('button')).toHaveCount(0)
  })

  test('the section updates when the browser reports the app installed', async ({ page }) => {
    await offerThenOpenSettings(page, 'accepted')
    await section(page).getByRole('button', { name: 'Install the app' }).waitFor()

    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))

    await expect(section(page).getByText("You've installed Magic Agenda.")).toBeVisible()
    await expect(section(page).getByRole('button')).toHaveCount(0)
  })

  test.describe('on an iPhone', () => {
    test.use({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    })

    test('Notifications points to the steps', async ({ page }) => {
      await seedBoard({ theme: 'cork' })
      await page.goto('/settings')
      await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
      await expect(
        section(page).getByRole('list', { name: 'Steps to install on iPhone or iPad' }),
      ).toContainText('Add to Home Screen')

      await page
        .getByRole('region', { name: 'Notifications' })
        .getByRole('link', { name: 'Install the app' })
        .click()

      await expect(page.getByRole('heading', { name: 'Install the app', level: 2 })).toBeFocused()
      await expect(section(page)).toBeInViewport()
      expect(page.url()).not.toContain('#')
    })

    // A stand-in for the real thing, which only an iPhone can show.
    test('the installed app opens with no suggestion to install it', async ({ page }) => {
      await page.addInitScript(() => {
        const real = window.matchMedia.bind(window)
        window.matchMedia = (query) =>
          query === '(display-mode: standalone)'
            ? ({ matches: true } as MediaQueryList)
            : real(query)
      })
      await openBoard(page)

      await expect(section(page)).toHaveCount(0)
    })
  })

  // #568. On the Board, this region is the banner.
  test.describe('the suggestion on the Board', () => {
    test('stays dismissed across a reload', async ({ page }) => {
      await openBoard(page)
      await expect(section(page).getByRole('link', { name: 'See how' })).toBeVisible()

      await section(page).getByRole('button', { name: 'Dismiss' }).click()
      await expect(section(page)).toHaveCount(0)

      await page.reload()
      await page.getByRole('button', { name: '+ New task' }).waitFor()
      await expect(section(page)).toHaveCount(0)
    })

    test('leads to the steps in Settings', async ({ page }) => {
      await openBoard(page)

      await section(page).getByRole('link', { name: 'See how' }).click()

      await expect(page.getByRole('heading', { name: 'Install the app', level: 2 })).toBeFocused()
      await expect(section(page).getByText("Open your browser's menu")).toBeInViewport()
      expect(page.url()).not.toContain('#')
    })

    test('accepting the prompt takes it away', async ({ page }) => {
      await openBoard(page)
      await offerPrompt(page, 'accepted')

      await section(page).getByRole('button', { name: 'Install the app' }).click()

      await expect(section(page)).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.dataset.promptShown)).toBe('yes')
    })

    test('leaves the Board usable and on the page', async ({ page }) => {
      await seedBoard({ view: 'calendar' })
      await page.goto('/')
      await section(page).waitFor()
      await expect(page.getByRole('dialog')).toHaveCount(0)

      // The Calendar still takes a press while the suggestion shows.
      await page.getByText(SEEDED_TITLES[0]).click()
      await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible()
    })

    test.describe('on a desktop', () => {
      test.use({ viewport: { width: 1280, height: 720 } })

      test('never shows', async ({ page }) => {
        await openBoard(page)

        await expect(section(page)).toHaveCount(0)
      })
    })
  })
})
