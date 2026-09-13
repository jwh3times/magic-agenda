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
 * Each theme's `focusRing` colour and `focusRingInset` (src/theme/themeConf.ts), in the forms
 * `getComputedStyle` reports. Duplicated rather than imported because `tests/**` imports nothing
 * from `src/**`, and that duplication is the point: a token change should fail here and be looked
 * at, not follow along.
 */
const FOCUS_RING: Record<Theme, { color: string; inset: number }> = {
  cork: { color: 'rgb(47, 29, 12)', inset: 3 }, // #2f1d0c
  brutal: { color: 'rgb(17, 17, 17)', inset: 8 }, // #111111
  glass: { color: 'rgb(234, 240, 255)', inset: 4 }, // #eaf0ff
}

/** The ring's width in px, which is fixed across themes (src/dnd/SortableCard.tsx). */
const RING_WIDTH = 3

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
   * Three things make or break it:
   *
   * - **Focus must arrive by keyboard.** `SortableCard` lights the ring only when its wrapper matches
   *   `:focus-visible`, which a click or a scripted `.focus()` does not guarantee, so this presses
   *   Tab until the wrapper holds focus.
   * - **The ring is on the card element, not the wrapper** (#361): the wrapper's first child, which
   *   carries the card's rotation and border. Its computed outline is asserted before the screenshot.
   * - **Computed style is not visibility.** The first cut of this canary asserted a solid, 3px,
   *   correctly coloured outline in all three themes and screenshotted no ring at all: it was drawn
   *   outside the card and the calendar cell's `overflow: auto` container clipped it away. So the
   *   ring's top and side edges must also fall inside every clipping ancestor. The bottom is exempt,
   *   because a card taller than its cell is legitimately cut off there by the cell itself.
   */
  for (const [theme, ring] of Object.entries(FOCUS_RING) as [
    Theme,
    { color: string; inset: number },
  ][]) {
    test(`focus ring (${theme})`, async ({ page }) => {
      await openBoard(page, theme, 'calendar')
      await boardReady(page, SEEDED_TITLES)
      const wrapper = page
        .locator('[aria-roledescription="sortable"]')
        .filter({ hasText: SEEDED_TITLES[0] })
      const card = wrapper.locator(':scope > div').first()

      // Bounded, so a tab order that no longer reaches the card fails here with a clear message
      // instead of timing out somewhere less obvious.
      let reached = false
      for (let i = 0; i < MAX_TABS && !reached; i++) {
        await page.keyboard.press('Tab')
        reached = await wrapper.evaluate((el) => el === document.activeElement)
      }
      expect(reached, `Tab did not reach "${SEEDED_TITLES[0]}" within ${MAX_TABS} presses`).toBe(
        true,
      )
      await expect(wrapper).toBeFocused()

      await expect(card).toHaveCSS('outline-style', 'solid')
      await expect(card).toHaveCSS('outline-width', `${RING_WIDTH}px`)
      await expect(card).toHaveCSS('outline-color', ring.color)
      await expect(card).toHaveCSS('outline-offset', `-${ring.inset}px`)
      // Straightened while focused (#361): a tilted card's corners overhang the unpadded calendar
      // cell and cut the ring near them, so a focused card must carry no rotation at all.
      await expect(card).toHaveCSS('transform', 'none')

      // The ring's outer edge sits (inset - width) px inside the card's box. Report every clipping
      // ancestor that cuts its top, left, or right edge; a 1px allowance absorbs the sub-pixel
      // expansion of a rotated card's bounding box.
      const clipped = await card.evaluate(
        (el, { inset, width }) => {
          const r = el.getBoundingClientRect()
          const edge = inset - width
          const ringBox = { top: r.top + edge, left: r.left + edge, right: r.right - edge }
          const problems: string[] = []
          for (let a = el.parentElement; a; a = a.parentElement) {
            const s = getComputedStyle(a)
            if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
            const b = a.getBoundingClientRect()
            if (ringBox.top < b.top - 1)
              problems.push(`top clipped by <${a.tagName.toLowerCase()}>`)
            if (ringBox.left < b.left - 1)
              problems.push(`left clipped by <${a.tagName.toLowerCase()}>`)
            if (ringBox.right > b.right + 1)
              problems.push(`right clipped by <${a.tagName.toLowerCase()}>`)
          }
          return problems
        },
        { inset: ring.inset, width: RING_WIDTH },
      )
      expect(clipped, 'the focus ring must be visible, not only styled').toEqual([])

      await settle(page)
      const box = await wrapper.boundingBox()
      if (!box) throw new Error('focused card has no bounding box')
      // Clipped to the card plus a margin, so the canary's diff area is the ring itself rather than
      // the whole board.
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
