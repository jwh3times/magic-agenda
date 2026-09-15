import { defineConfig, devices } from '@playwright/test'

/** Deployed-preview probes that need Cloudflare Pages' real response headers. */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /preview\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: process.env.E2E_PREVIEW_URL,
    storageState: { cookies: [], origins: [] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    channel: 'chromium',
  },
})
