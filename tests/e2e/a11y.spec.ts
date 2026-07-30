import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { seedBoard, SEEDED_TITLES, type Theme } from './fixtures/seedBoard'

// Installing the ratchet is in scope; fixing what it finds is NOT. theme/themeConf.ts is a
// deliberate verbatim port of the prototype, and turning this into a contrast redesign would be a
// different project. Existing violations are baselined; only NEW pairs fail.
const BASELINE = path.join('tests', 'e2e', 'a11y-baseline.json')

type Finding = { ruleId: string; target: string }

// Every surface this file scans. The baseline writer refuses to run unless all of them were
// scanned in THIS worker -- see the afterAll hook.
const EXPECTED_LABELS = [
  'landing',
  'login',
  'settings',
  'board-cork',
  'board-brutal',
  'board-glass',
]

function readBaseline(): Finding[] {
  try {
    return JSON.parse(readFileSync(BASELINE, 'utf8')) as Finding[]
  } catch {
    return []
  }
}

const key = (f: Finding) => `${f.ruleId} ${f.target}`

/** Set E2E_A11Y_UPDATE_BASELINE=1 to rewrite the baseline instead of asserting against it. */
const UPDATING = process.env.E2E_A11Y_UPDATE_BASELINE === '1'
const collected: Finding[] = []
const scanned = new Set<string>()

async function scan(page: Page, label: string): Promise<Finding[]> {
  const results = await new AxeBuilder({ page }).analyze()
  // Recorded separately from the findings: a clean surface yields zero findings, so its label would
  // otherwise be indistinguishable from a surface that never ran at all.
  scanned.add(label)
  return results.violations.flatMap((v) =>
    v.nodes.map((n) => ({ ruleId: v.id, target: `${label}:${n.target.join(' ')}` })),
  )
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

  const unique = [...new Map(collected.map((f) => [key(f), f])).values()].sort((a, b) =>
    key(a).localeCompare(key(b)),
  )
  writeFileSync(BASELINE, `${JSON.stringify(unique, null, 2)}\n`)
})

function assertNoNewViolations(found: Finding[]): void {
  if (UPDATING) {
    collected.push(...found)
    return
  }
  const baselined = new Set(readBaseline().map(key))
  const fresh = found.filter((f) => !baselined.has(key(f)))
  expect(fresh).toEqual([])
}

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('landing has no new a11y violations', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)
    assertNoNewViolations(await scan(page, 'landing'))
  })

  test('login has no new a11y violations', async ({ page }) => {
    await page.goto('/login')
    await page.evaluate(() => document.fonts.ready)
    assertNoNewViolations(await scan(page, 'login'))
  })
})

/**
 * The baseline keys on axe's CSS target paths, so the board's shape must not drift between runs --
 * and the board's shape is a function of today's date. Pinning the browser clock and seeding to the
 * SAME day is what makes the calendar grid identical on every run.
 *
 * The two must agree: `page.clock` moves only the browser, while `seedBoard` runs in the test
 * process in real time. Pinning the clock without passing the matching `anchor` puts the seeded rows
 * outside the rendered month -- see the header comment in fixtures/seedBoard.ts.
 *
 * Step 2 of this task decides empirically whether the clock is usable at all. If it is not, delete
 * both lines and switch the board scans to `view: 'kanban'` (see that step).
 */
const PINNED_DAY = '2026-06-15'
const PINNED_TIME = `${PINNED_DAY}T12:00:00Z`

test.describe('signed in', () => {
  test('settings has no new a11y violations', async ({ page }) => {
    await page.clock.setFixedTime(new Date(PINNED_TIME))
    await seedBoard({ anchor: PINNED_DAY })
    await page.goto('/settings')
    await page.evaluate(() => document.fonts.ready)
    assertNoNewViolations(await scan(page, 'settings'))
  })

  // Contrast risk is per-theme, so each theme is its own scan. Themes are seeded into
  // user_settings and the page reloaded, rather than driven through the settings UI.
  for (const theme of ['cork', 'brutal', 'glass'] as Theme[]) {
    test(`board (${theme}) has no new a11y violations`, async ({ page }) => {
      await page.clock.setFixedTime(new Date(PINNED_TIME))
      await seedBoard({ theme, anchor: PINNED_DAY })
      await page.goto('/')
      await page.getByRole('button', { name: '+ New task' }).waitFor()
      // Both seeded dated cards must actually be on screen: the whole point of scanning three themes
      // is per-theme CARD contrast, and a board rendering only the inbox card would scan almost none
      // of it while still passing.
      await page.getByText(SEEDED_TITLES[0]).waitFor()
      await page.getByText(SEEDED_TITLES[1]).waitFor()
      await page.evaluate(() => document.fonts.ready)
      assertNoNewViolations(await scan(page, `board-${theme}`))
    })
  }
})
