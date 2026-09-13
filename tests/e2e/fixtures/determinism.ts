import type { Page } from '@playwright/test'

/**
 * What makes a rendered surface identical from one run to the next.
 *
 * Shared by the a11y scans and the visual canaries (#280) on purpose. Both assert something that
 * moves when the page is not settled — an axe count, a pixel — so a second copy of these rules in
 * one spec is exactly how the two would drift into measuring different pages.
 */

/**
 * page.clock does NOT freeze CSS animations — they run on the compositor's own timeline. The glass
 * theme's three blobs (src/theme/chrome.ts, @keyframes blobFloat in src/index.css) are therefore at
 * an arbitrary phase when axe runs, a function of how long seeding and the waits took on that runner.
 *
 * That moves a COUNT, not just a selector path. axe's getBackgroundColor walks elementsFromPoint and
 * bails to `bgColor: 'bgGradient'` the moment a background-image is in the stack, which makes the
 * node INCOMPLETE — and incompletes are not in results.violations. Glass is exactly where axe has to
 * walk deep, because every background above #0b0f1f is translucent, so a blob drifting over the
 * ViewSwitcher silently converts a color-contrast violation into an incomplete.
 *
 * For a screenshot the same drift is a pixel diff on every run. Do not remove this.
 */
export const FREEZE_ANIMATION = `*, *::before, *::after {
  animation: none !important;
  transition: none !important;
}`

/** Everything every surface needs between "content is on screen" and "scan or screenshot it". */
export async function settle(page: Page): Promise<void> {
  await page.addStyleTag({ content: FREEZE_ANIMATION })
  await page.evaluate(async () => {
    await document.fonts.ready
  })
}

/**
 * The board's shape is a function of today's date, and it must not drift between runs. Pinning the
 * browser clock and seeding to the SAME day is what makes the calendar grid identical every time.
 *
 * For a11y this is load-bearing because `brutal` flags the trailing OUT-OF-MONTH cells, and how many
 * of those the fixed 42-cell grid carries is a function of the month — unpin the clock and the
 * color-contrast count moves. For a screenshot it is the whole grid.
 *
 * The two must agree: `page.clock` moves only the browser, while `seedBoard` runs in the test
 * process in real time. Pinning the clock without passing the matching `anchor` puts the seeded rows
 * outside the rendered month -- see the header comment in fixtures/seedBoard.ts.
 *
 * 2026-06-15 is a Monday, so with a Sunday week start the second seeded row (+2 days) lands in the
 * same week, which the week-view canary relies on.
 */
export const PINNED_DAY = '2026-06-15'
export const PINNED_TIME = `${PINNED_DAY}T12:00:00Z`
