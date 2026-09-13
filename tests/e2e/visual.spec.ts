import { expect, test, type Page } from '@playwright/test'
import { seedBoard, SEEDED_TITLES, type Theme, type View } from './fixtures/seedBoard'
import { PINNED_DAY, PINNED_TIME, settle } from './fixtures/determinism'

/**
 * Visual regression canaries (#280).
 *
 * The visual layer is an inline-style-object model with per-theme branching, deliberately not CSS
 * (see docs/agents/ui.md), so there is no stylesheet to review and no CSS regression tooling that
 * applies. These screenshots are the only mechanical check that a token change did not wreck a
 * theme.
 *
 * **Not a gate yet.** CI runs this file as its own `visual` project in a `continue-on-error` step of
 * the `E2E` job, so a mismatch warns and uploads the new PNGs without blocking a merge.
 *
 * **Baselines are Linux-only.** They are generated on the CI runner; a baseline rendered on Windows
 * or macOS bakes in that platform's font rasterization and turns every CI run into a diff. The
 * snapshot path carries the platform, so a local run on another OS reports a missing baseline
 * rather than a false mismatch. Refreshing them: docs/agents/testing.md.
 *
 * **Everything this file screenshots is committed to a public repository.** The seeded board holds
 * fixture text only and no surface renders the account email, but inspect every new baseline
 * before committing it.
 */

const MOBILE = { width: 390, height: 844 }

/**
 * Each theme's `focusRing` token (src/theme/themeConf.ts), in the rgb form `getComputedStyle`
 * reports. Duplicated rather than imported because `tests/**` imports nothing from `src/**`, and
 * that duplication is the point: a token change should fail here and be looked at, not follow along.
 */
const FOCUS_RING: Record<Theme, string> = {
  cork: 'rgb(47, 29, 12)', // #2f1d0c
  brutal: 'rgb(17, 17, 17)', // #111111
  glass: 'rgb(234, 240, 255)', // #eaf0ff
}

/** Enough to cross the board chrome and the day cells before the pinned day's first card. */
const MAX_TABS = 100

/** Pixels around the focused card in the clip: past the 2px outline offset and the 3px ring. */
const RING_MARGIN = 16

/** The board has painted every card this view is expected to show. */
async function boardReady(page: Page, titles: readonly string[]): Promise<void> {
  await page.getByRole('button', { name: '+ New task' }).waitFor()
  for (const title of titles) await page.getByText(title).first().waitFor()
  await settle(page)
}

async function openBoard(page: Page, theme: Theme, view: View): Promise<void> {
  await page.clock.setFixedTime(new Date(PINNED_TIME))
  await seedBoard({ theme, view, anchor: PINNED_DAY })
  await page.goto('/')
}

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('landing (desktop)', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('heading', { name: 'Your week, on sticky notes.' }).waitFor()
    await settle(page)
    await expect(page).toHaveScreenshot('landing-desktop.png', { fullPage: true })
  })

  test.describe('mobile', () => {
    test.use({ viewport: MOBILE })

    test('landing (mobile)', async ({ page }) => {
      await page.goto('/')
      await page.getByRole('heading', { name: 'Your week, on sticky notes.' }).waitFor()
      await settle(page)
      await expect(page).toHaveScreenshot('landing-mobile.png', { fullPage: true })
    })
  })
})

test.describe('signed in', () => {
  // One canary per theme on the view that exercises the most theme branching: the month grid's
  // cells, the day numbers (including out-of-month ones), the Inbox, and all three cards.
  for (const theme of ['cork', 'brutal', 'glass'] as Theme[]) {
    test(`board calendar (${theme})`, async ({ page }) => {
      await openBoard(page, theme, 'calendar')
      await boardReady(page, SEEDED_TITLES)
      await expect(page).toHaveScreenshot(`board-calendar-${theme}.png`)
    })
  }

  test('board week (cork)', async ({ page }) => {
    await openBoard(page, 'cork', 'week')
    await boardReady(page, SEEDED_TITLES)
    await expect(page).toHaveScreenshot('board-week-cork.png')
  })

  test('board kanban (cork)', async ({ page }) => {
    await openBoard(page, 'cork', 'kanban')
    await boardReady(page, SEEDED_TITLES)
    await expect(page).toHaveScreenshot('board-kanban-cork.png')
  })

  test('task editor (cork)', async ({ page }) => {
    await openBoard(page, 'cork', 'calendar')
    await boardReady(page, SEEDED_TITLES)
    await page.getByText(SEEDED_TITLES[0]).first().click()
    // An existing task's editor, not the new-task one: Delete appears only there.
    await page.getByRole('button', { name: 'Delete' }).waitFor()
    await settle(page)
    await expect(page).toHaveScreenshot('task-editor-cork.png')
  })

  test('settings (cork)', async ({ page }) => {
    await page.clock.setFixedTime(new Date(PINNED_TIME))
    await seedBoard({ anchor: PINNED_DAY })
    await page.goto('/settings')
    await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
    // Several sections load on their own after the page renders — Two-factor ("Loading…"), Labels
    // ("Loading labels…"), and History ("Loading history…"). A full-page screenshot that races any
    // of them captures a loading state, so wait for every one to settle. The seed completes nothing,
    // which makes History's empty state the positive signal that it finished.
    await expect(page.getByText(/^Loading/)).toHaveCount(0)
    await page.getByText('No completed tasks on this Board yet.').waitFor()
    await settle(page)
    await expect(page).toHaveScreenshot('settings-cork.png', { fullPage: true })
  })

  /**
   * The per-theme keyboard focus ring (#359). jsdom always answers `:focus-visible` false, so this
   * ring cannot be checked in the unit suite at all (docs/agents/ui.md) — a real browser is the only
   * place it exists.
   *
   * Two things make or break it. **Focus must arrive by keyboard:** `SortableCard` lights the ring
   * only when the wrapper matches `:focus-visible`, which a click or a scripted `.focus()` does not
   * guarantee, so this presses Tab until the card holds focus. And **the outline is asserted before
   * the screenshot** — a positive control, because a baseline captured without a visible ring would
   * pin the very bug the canary exists to catch and then pass forever.
   */
  for (const [theme, ring] of Object.entries(FOCUS_RING) as [Theme, string][]) {
    test(`focus ring (${theme})`, async ({ page }) => {
      await openBoard(page, theme, 'calendar')
      await boardReady(page, SEEDED_TITLES)
      const card = page
        .locator('[aria-roledescription="sortable"]')
        .filter({ hasText: SEEDED_TITLES[0] })

      // Bounded, so a tab order that no longer reaches the card fails here with a clear message
      // instead of timing out somewhere less obvious.
      let reached = false
      for (let i = 0; i < MAX_TABS && !reached; i++) {
        await page.keyboard.press('Tab')
        reached = await card.evaluate((el) => el === document.activeElement)
      }
      expect(reached, `Tab did not reach "${SEEDED_TITLES[0]}" within ${MAX_TABS} presses`).toBe(
        true,
      )
      await expect(card).toBeFocused()
      await expect(card).toHaveCSS('outline-style', 'solid')
      await expect(card).toHaveCSS('outline-width', '3px')
      await expect(card).toHaveCSS('outline-color', ring)

      await settle(page)
      const box = await card.boundingBox()
      if (!box) throw new Error('focused card has no bounding box')
      // Clipped to the card plus a margin wider than the 2px offset and 3px ring, so the canary's
      // diff area is the ring itself rather than the whole board.
      await expect(page).toHaveScreenshot(`focus-ring-${theme}.png`, {
        clip: {
          x: box.x - RING_MARGIN,
          y: box.y - RING_MARGIN,
          width: box.width + RING_MARGIN * 2,
          height: box.height + RING_MARGIN * 2,
        },
      })
    })
  }

  test.describe('mobile', () => {
    test.use({ viewport: MOBILE })

    test('board calendar (cork, mobile)', async ({ page }) => {
      await openBoard(page, 'cork', 'calendar')
      // The mobile Inbox docks under the board expanded, so all three cards render here too
      // (confirmed on #280's first CI run) and the wait covers every one, as on desktop.
      await boardReady(page, SEEDED_TITLES)
      await expect(page).toHaveScreenshot('board-calendar-cork-mobile.png')
    })
  })
})
