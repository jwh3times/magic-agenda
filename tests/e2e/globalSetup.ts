import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

export const STORAGE_STATE = path.join('tests', 'e2e', '.auth', 'user.json')
const SETUP_RESULTS = path.join('test-results', 'global-setup')
const SETUP_SCREENSHOT = path.join(SETUP_RESULTS, 'failure.png')
const SETUP_TRACE = path.join(SETUP_RESULTS, 'trace.zip')

/**
 * Signs in once per run and saves the session.
 *
 * Not per-test, for two reasons: it is slow, and `supabase/config.toml` limits sign-ins to 30 per
 * 5 minutes per IP. A shared CI egress IP plus per-test sign-in is a self-inflicted flake.
 */
export default async function globalSetup(): Promise<void> {
  const baseURL = process.env.E2E_BASE_URL
  if (!baseURL) {
    throw new Error(
      'E2E_BASE_URL is unset. These tests run against a DEPLOYED build (a Cloudflare Pages\n' +
        'preview in CI) because public/_headers is Cloudflare-specific.\n' +
        'Locally, point it at a preview URL or https://magicagenda.app.',
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
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()

      // Separate "the session took" from "the cold Board finished loading". A failure now says
      // which boundary stalled instead of spending one opaque timeout on the toolbar.
      await page.waitForURL((url) => url.pathname !== '/login', { timeout: 30_000 })
      await page.getByRole('button', { name: '+ New task' }).waitFor({ timeout: 60_000 })
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
