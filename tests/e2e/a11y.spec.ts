import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { seedBoard, SEEDED_TITLES, type Theme } from './fixtures/seedBoard'
import {
  baselineFor,
  EXPECTED_LABELS,
  formatContrast,
  formatFindings,
  parseBaseline,
  tally,
  toBaseline,
  type BaselineEntry,
  type ContrastData,
  type Finding,
} from '../../scripts/a11y-baseline'

// Fixing what this finds is IN scope for the structural rules — landmarks, page headings, control
// names — and OUT of scope for the two families still baselined:
//
//   color-contrast      lives in src/theme/themeConf.ts, a deliberate verbatim port of
//                       design/Task Board.dc.html. Clearing it is a contrast redesign of three
//                       themes, which is a different project with a different risk profile.
//   nested-interactive  src/dnd/SortableCard.tsx spreads dnd-kit's attributes (including
//                       role="button") onto the wrapper around TaskCard's pin and done buttons.
//                       Clearing it means changing how the activator is attached — editing src/dnd.
//
// The baseline is JSON and takes no comments, which is why this note lives here.
const BASELINE = path.join('tests', 'e2e', 'a11y-baseline.json')

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
 * The old ratchet keyed on {ruleId, target} and failed only on NEW pairs, so it tolerated that. This
 * one asserts counts by equality, so it does not. Do not remove this.
 */
const FREEZE_ANIMATION = `*, *::before, *::after {
  animation: none !important;
  transition: none !important;
}`

/** Everything every surface needs between "content is on screen" and "scan it". */
async function settle(page: Page): Promise<void> {
  await page.addStyleTag({ content: FREEZE_ANIMATION })
  await page.evaluate(async () => {
    await document.fonts.ready
  })
}

/**
 * No try/catch, on purpose.
 *
 * This is only reached in asserting mode, where a missing, truncated or conflict-markered baseline
 * must be an error. Under the old increases-only scheme an empty baseline was the STRICTEST possible
 * state — every finding is new — so swallowing a read error was survivable. Under equality, an empty
 * baseline means "expect zero violations everywhere", which is a legitimate PASSING state. The moment
 * the last baselined violation is fixed, a deleted baseline becomes indistinguishable from success.
 */
function readBaseline(): BaselineEntry[] {
  return parseBaseline(readFileSync(BASELINE, 'utf8'), EXPECTED_LABELS)
}

/** Set E2E_A11Y_UPDATE_BASELINE=1 to rewrite the baseline instead of asserting against it. */
const UPDATING = process.env.E2E_A11Y_UPDATE_BASELINE === '1'
const collected: Finding[] = []
const scanned = new Set<string>()

async function scan(page: Page, label: string): Promise<Finding[]> {
  const results = await new AxeBuilder({ page }).analyze()
  // Recorded separately from the findings: a clean surface yields zero findings, so its label would
  // otherwise be indistinguishable from a surface that never ran at all.
  scanned.add(label)
  const found = results.violations.flatMap((violation) =>
    violation.nodes.map((node) => ({
      label,
      ruleId: violation.id,
      target: node.target.join(' '),
      // Only color-contrast carries colour data, and it is the only family where knowing WHICH
      // colours failed saves work later — see this file's header note on the deferred redesign.
      detail:
        violation.id === 'color-contrast'
          ? formatContrast(
              node.any.find((check) => check.id === 'color-contrast')?.data as
                ContrastData | undefined,
            )
          : undefined,
    })),
  )
  // Unconditional, and BEFORE the assertion. In practice a baseline is produced by reading numbers
  // out of a CI log — the update mode needs the E2E account's credentials, which exist only as
  // repository secrets. Logging after the assert would skip every surface that fails, costing
  // another serialised run on a required check that also holds the single e2e-prod-account
  // concurrency slot.
  console.log(`[a11y] ${label} ${JSON.stringify(tally(found))}\n${formatFindings(found)}`)
  return found
}

test.afterAll(() => {
  if (!UPDATING) return

  // Refuse to write a partial baseline.
  //
  // `collected` and `scanned` are module state and afterAll runs PER WORKER. Playwright discards a
  // worker after a test failure and continues in a fresh process, so a mid-run failure would
  // otherwise write a baseline holding only what the surviving worker saw -- silently dropping every
  // entry for the surfaces that ran before it. A filtered regeneration (`-g "landing"`) does the
  // same thing. Both look like success, and both quietly disarm the ratchet.
  const missing = EXPECTED_LABELS.filter((label) => !scanned.has(label))
  if (missing.length) {
    throw new Error(
      `Refusing to write a partial a11y baseline: ${missing.join(', ')} did not scan in this worker.\n` +
        'Regenerate with a full, unfiltered run:\n' +
        '  E2E_A11Y_UPDATE_BASELINE=1 npm run test:e2e -- a11y.spec.ts',
    )
  }

  writeFileSync(BASELINE, `${JSON.stringify(toBaseline(collected), null, 2)}\n`)
})

/**
 * Strict equality, in both directions.
 *
 * A count that ROSE is a regression. A count that FELL means the baseline is stale — which is a
 * failure on purpose: tolerating it is what lets a ratchet's ceiling drift above reality and stop
 * being a ratchet.
 */
async function scanAndAssert(page: Page, label: string): Promise<void> {
  const found = await scan(page, label)
  if (UPDATING) {
    collected.push(...found)
    return
  }
  expect(
    tally(found),
    `a11y violation counts changed on "${label}".\n` +
      'A count that ROSE is a regression — fix it.\n' +
      'A count that FELL means the baseline is stale — commit the lower number.\n' +
      'Observed violations:\n' +
      formatFindings(found),
  ).toEqual(baselineFor(readBaseline(), label))
}

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('landing matches the a11y baseline', async ({ page }) => {
    await page.goto('/')
    // NOT a redundant wait — same reason as the settings wait above. `/` routes through HomeRoute
    // (src/App.tsx), which renders <Spinner/> while auth is loading, and axe's isModalOpen()
    // heuristic passes landmark-one-main and page-has-heading-one for free against a full-screen
    // Spinner. Wait for real content before scanning.
    await page.getByRole('heading', { name: 'Your week, on sticky notes.' }).waitFor()
    await settle(page)
    await scanAndAssert(page, 'landing')
  })

  test('login matches the a11y baseline', async ({ page }) => {
    await page.goto('/login')
    await settle(page)
    await scanAndAssert(page, 'login')
  })
})

/**
 * The board's shape is a function of today's date, and it must not drift between runs. Pinning the
 * browser clock and seeding to the SAME day is what makes the calendar grid identical every time.
 *
 * This used to be justified by the baseline keying on axe's CSS target paths. It no longer keys on
 * paths — but the pinning is still load-bearing, for a different reason: `brutal` flags the trailing
 * OUT-OF-MONTH cells, and how many of those the fixed 42-cell grid carries is a function of the
 * month. Unpin the clock and the color-contrast count moves.
 *
 * The two must agree: `page.clock` moves only the browser, while `seedBoard` runs in the test
 * process in real time. Pinning the clock without passing the matching `anchor` puts the seeded rows
 * outside the rendered month -- see the header comment in fixtures/seedBoard.ts.
 */
const PINNED_DAY = '2026-06-15'
const PINNED_TIME = `${PINNED_DAY}T12:00:00Z`

test.describe('signed in', () => {
  test('settings matches the a11y baseline', async ({ page }) => {
    await page.clock.setFixedTime(new Date(PINNED_TIME))
    await seedBoard({ anchor: PINNED_DAY })
    await page.goto('/settings')
    // NOT a redundant wait. SettingsPage renders <Spinner/> until the settings load resolves, and
    // Spinner is `position: fixed; inset: 0` — which axe's isModalOpen() heuristic reads as an open
    // modal (any absolute/fixed element covering >=75% of the viewport whose pointer-events is not
    // 'none'). Both page-level rules carry passForModal: true and short-circuit through
    // has-descendant-evaluate, so scanning the loading state makes landmark-one-main AND
    // page-has-heading-one pass for free. That is exactly how the pre-2026-07-30 baseline came to
    // hold one `region: #root` entry for this surface and nothing else: it never scanned the
    // settings page at all. A scan that races a loading state does not merely miss content — a
    // full-screen loader actively suppresses the page-level rules and scores clean.
    await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
    await settle(page)
    await scanAndAssert(page, 'settings')
  })

  // Contrast risk is per-theme, so each theme is its own scan. Themes are seeded into
  // user_settings and the page reloaded, rather than driven through the settings UI.
  for (const theme of ['cork', 'brutal', 'glass'] as Theme[]) {
    test(`board (${theme}) matches the a11y baseline`, async ({ page }) => {
      await page.clock.setFixedTime(new Date(PINNED_TIME))
      await seedBoard({ theme, anchor: PINNED_DAY })
      await page.goto('/')
      await page.getByRole('button', { name: '+ New task' }).waitFor()
      // All THREE seeded cards, not just the two dated ones. nested-interactive is exactly one per
      // rendered card, so a board that has painted 2 of 3 yields a count of 2 — which the old
      // increases-only ratchet passed (fewer targets, no new pair) and equality fails as a stale
      // baseline. Scanning a partly-painted board would also miss most of the per-theme CARD
      // contrast this loop exists to measure.
      for (const title of SEEDED_TITLES) await page.getByText(title).waitFor()
      await settle(page)
      await scanAndAssert(page, `board-${theme}`)
    })
  }
})
