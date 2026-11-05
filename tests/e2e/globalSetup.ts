import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { activeMembershipCount, testClient } from './fixtures/supabase'

export const STORAGE_STATE = path.join('tests', 'e2e', '.auth', 'user.json')
const SETUP_RESULTS = path.join('test-results', 'global-setup')
const SETUP_SCREENSHOT = path.join(SETUP_RESULTS, 'failure.png')
const SETUP_TRACE = path.join(SETUP_RESULTS, 'trace.zip')

/**
 * Signs in once per run and saves the session.
 *
 * Not per-test, for two reasons: it is slow, and `supabase/config.toml` limits sign-ins to 30 per
 * 5 minutes per IP. Re-authenticating every test against one local GoTrue is a self-inflicted flake.
 * The one exception is a failure: on "No boards yet" it signs in once more through the Data API to
 * count the account's Memberships (`explainNoBoards`).
 */
export default async function globalSetup(): Promise<void> {
  const baseURL = process.env.E2E_BASE_URL
  if (!baseURL) {
    throw new Error(
      'E2E_BASE_URL is unset. The authenticated suite needs the branch build backed by an\n' +
        'isolated local Supabase stack. CI prepares it automatically; see docs/agents/testing.md.',
    )
  }
  const email = process.env.E2E_TEST_EMAIL
  const password = process.env.E2E_TEST_PASSWORD
  if (!email || !password) {
    throw new Error('E2E_TEST_EMAIL and E2E_TEST_PASSWORD must be set.')
  }

  await mkdir(path.dirname(STORAGE_STATE), { recursive: true })

  // Match the project runtime in playwright.config.ts. The legacy headless shell crashed during
  // repeated context creation on Ubuntu CI; the regular Chromium build's new headless mode did not
  // implicate any application assertion and is the supported replacement runtime.
  const browser = await chromium.launch({ channel: 'chromium' })
  try {
    const page = await browser.newPage({ baseURL })
    const context = page.context()
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })

    try {
      await page.goto('/login')
      await page.getByPlaceholder('you@example.com').fill(email)
      await page.getByPlaceholder('Password').fill(password)
      // click() auto-waits for the button to become enabled. That matters when the local
      // Turnstile test widget is still obtaining its deterministic token, and it keeps this
      // setup module independent of Playwright's assertion runtime.
      await page.getByRole('button', { name: 'Sign in', exact: true }).click({ timeout: 30_000 })

      // Separate "the session took" from "the cold Board finished loading". A failure now says
      // which boundary stalled instead of spending one opaque timeout on the toolbar.
      await page.waitForURL((url) => url.pathname !== '/login', { timeout: 30_000 })
      // Either the Board loaded or the page says there is none. Waiting on the toolbar alone spent
      // the full minute on a "No boards yet" page that was never going to change (#572).
      const toolbar = page.getByRole('button', { name: '+ New task' })
      const noBoards = page.getByRole('heading', { name: 'No boards yet' })
      await toolbar.or(noBoards).first().waitFor({ timeout: 60_000 })
      if (await noBoards.isVisible()) throw new Error(await explainNoBoards())
      await context.storageState({ path: STORAGE_STATE })

      // Successful setup needs no artifact. Failure artifacts are retained below and encrypted by
      // the same CI step as ordinary Playwright traces before this public repository uploads them.
      await context.tracing.stop()
    } catch (error) {
      await mkdir(SETUP_RESULTS, { recursive: true })
      await page.screenshot({ path: SETUP_SCREENSHOT, fullPage: true }).catch(() => undefined)
      await context.tracing.stop({ path: SETUP_TRACE }).catch(() => undefined)
      throw error
    }
  } finally {
    await browser.close()
  }
}

/**
 * Why the signed-in page said "No boards yet", asked of the server rather than the page.
 *
 * The two causes need opposite fixes, and the page looks the same for both: an account that really
 * is on no Board is stack state, put right by a reset, while one that is on a Board means the app
 * failed to load its Board list and showed the empty state instead of an error (#629).
 */
async function explainNoBoards(): Promise<string> {
  let count: number
  try {
    count = await activeMembershipCount(await testClient())
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return (
      `The Board page says "No boards yet", and the account's Memberships could not be checked: ${reason}
` + 'If the account really has no Board, see "Running E2E locally" in docs/agents/testing.md.'
    )
  }
  if (count === 0) {
    return (
      'The E2E account is a member of no Board, so the Board page says "No boards yet". That is\n' +
      'stack state, not a regression. Reset the local stack and provision the accounts again:\n' +
      '  npx supabase db reset --local\n' +
      '  GITHUB_ENV=<file> npx tsx scripts/e2e-local-setup.ts\n' +
      'See "Running E2E locally" in docs/agents/testing.md.'
    )
  }
  return (
    `The Board page says "No boards yet", but the E2E account is a member of ${count} Board(s).\n` +
    'The app failed to load its Board list and showed the empty state instead of an error (#629).\n' +
    'A reset will not help; rerun, and read the trace for the failed board_memberships request.'
  )
}
