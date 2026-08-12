import { defineConfig, devices } from '@playwright/test'

// E2E runs against a REAL deployed build (a Cloudflare Pages preview in CI), because
// public/_headers is Cloudflare-specific and a local server cannot reproduce how Pages resolves
// header rules -- which is the exact cause of the v1.2.37 CSP bug this suite exists to catch.
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/globalSetup.ts',

  // One worker, always. Every signed-in test drives the SAME production account, and the app
  // subscribes to Supabase realtime -- so a parallel worker's seeding deletions are pushed live
  // into another worker's open page between load and assertion. This is not a speed knob.
  workers: 1,
  fullyParallel: false,

  // No retries. A retry on a required check turns a real flake into an invisible one; if this
  // suite is flaky, that is a defect to diagnose, not to paper over.
  retries: 0,

  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: process.env.E2E_BASE_URL,
    storageState: 'tests/e2e/.auth/user.json',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  // Use the regular Chromium build's new headless mode. The legacy headless shell crashed with the
  // same SIGSEGV at different browser.newContext() calls on consecutive Ubuntu CI runs; selecting
  // this channel keeps retries at zero while replacing the unstable browser runtime.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }],
})
