import { defineConfig, devices } from '@playwright/test'

// Authenticated E2E runs against an isolated local Supabase stack so CAPTCHA and test data never
// couple CI to production. playwright.preview.config.ts separately exercises the deployed Pages
// preview for behavior that depends on Cloudflare's real response headers.
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/globalSetup.ts',

  // One worker, always. Signed-in tests share one local account and subscribe to realtime, so a
  // parallel worker's seeding deletions could reach another worker between load and assertion.
  workers: 1,
  fullyParallel: false,

  // No retries. A retry on a required check turns a real flake into an invisible one; if this
  // suite is flaky, that is a defect to diagnose, not to paper over.
  retries: 0,

  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
    // Visual canaries (#280). An ABSOLUTE pixel cap, not a ratio. The first cut used
    // maxDiffPixelRatio 0.01 -- about 9,200 pixels on a 1280x720 page -- and that was measured to be
    // too loose to be a check: a seeded card changing its tilt between runs moved under 1% of a
    // calendar page and passed, while the larger kanban cards crossed it (14,936 px) and failed. A
    // tolerance that forgives a whole card rotating also forgives a real regression on a small
    // element. Per-pixel colour noise is still absorbed by Playwright's default `threshold` (0.2);
    // this cap only bounds how many pixels may exceed it.
    toHaveScreenshot: { maxDiffPixels: 50, animations: 'disabled', caret: 'hide' },
  },

  // A local run must never write a baseline silently: Playwright's default ('missing') would let a
  // Windows or macOS run mint platform-specific baselines and pass. CI overrides this with
  // `--update-snapshots=missing` on purpose, because under 'none' Playwright writes NOTHING for a
  // missing baseline -- not even an `-actual.png` -- so a new canary's first CI run would leave no
  // image to accept (measured on #280's first run). The CI collect step reports any baseline written
  // that way; see docs/agents/testing.md.
  updateSnapshots: 'none',
  // The platform is in the name so a baseline generated on the Linux CI runner cannot be mistaken
  // for one on another OS: a local non-Linux run reports "missing" instead of a false mismatch.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{platform}{ext}',
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
  //
  // Two projects over the same browser so CI can gate on one and not the other. `chromium` is the
  // required smoke + a11y run; `visual` is the screenshot canaries, run as a separate
  // continue-on-error step until they have proved stable. The visual project writes to its own
  // output directory because Playwright clears `outputDir` at the start of every invocation --
  // sharing it would let the visual step wipe the gated run's traces.
  projects: [
    {
      name: 'chromium',
      testIgnore: /(preview|visual)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
    {
      name: 'visual',
      testMatch: /visual.spec.ts/,
      outputDir: 'test-results-visual',
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
  ],
})
