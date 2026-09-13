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
  expect: {
    timeout: 15_000,
    // Visual canaries (#280). A small tolerance absorbs sub-pixel antialiasing on the same runner
    // image without hiding a real token change, which moves whole regions of a theme.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' },
  },

  // A missing baseline must FAIL, never be written silently. Playwright's default ('missing') would
  // let a local Windows run mint platform-specific baselines and pass, and in CI it would hide the
  // one signal the refresh flow depends on: the failing run's `-actual.png` files ARE the new
  // baselines (docs/agents/testing.md). Pass `--update-snapshots` explicitly to override.
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
      testIgnore: /visual.spec.ts/,
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
