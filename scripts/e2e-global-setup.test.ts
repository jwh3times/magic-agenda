import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const fillEmail = vi.fn()
  const fillPassword = vi.fn()
  const clickSignIn = vi.fn()
  const waitForURL = vi.fn((_predicate: (url: URL) => boolean, _options: { timeout: number }) =>
    Promise.resolve(),
  )
  const waitForToolbar = vi.fn((_options: { timeout: number }) => Promise.resolve())
  const storageState = vi.fn((_options: { path: string }) => Promise.resolve())
  const startTracing = vi.fn(
    (_options: { screenshots: boolean; snapshots: boolean; sources: boolean }) => Promise.resolve(),
  )
  const stopTracing = vi.fn((_options?: { path: string }) => Promise.resolve())
  const screenshot = vi.fn((_options: { fullPage: boolean; path: string }) => Promise.resolve())
  const close = vi.fn()

  const context = {
    storageState,
    tracing: { start: startTracing, stop: stopTracing },
  }
  const page = {
    goto: vi.fn(),
    getByPlaceholder: vi.fn((name: string) => ({
      fill: name === 'you@example.com' ? fillEmail : fillPassword,
    })),
    getByRole: vi.fn((_role: string, options: { name: string }) =>
      options.name === 'Sign in' ? { click: clickSignIn } : { waitFor: waitForToolbar },
    ),
    waitForURL,
    context: vi.fn(() => context),
    screenshot,
  }
  const launch = vi.fn(() =>
    Promise.resolve({ newPage: vi.fn(() => Promise.resolve(page)), close }),
  )

  return {
    fillEmail,
    fillPassword,
    clickSignIn,
    waitForURL,
    waitForToolbar,
    storageState,
    startTracing,
    stopTracing,
    screenshot,
    close,
    launch,
  }
})

vi.mock('@playwright/test', () => ({ chromium: { launch: h.launch } }))

import globalSetup from '../tests/e2e/globalSetup'

describe('E2E global setup diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('E2E_BASE_URL', 'https://example.test')
    vi.stubEnv('E2E_TEST_EMAIL', 'e2e@example.test')
    vi.stubEnv('E2E_TEST_PASSWORD', 'not-a-real-password')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('captures diagnostics when a cold board load times out', async () => {
    h.waitForToolbar.mockRejectedValueOnce(new Error('toolbar timed out'))

    await expect(globalSetup()).rejects.toThrow('toolbar timed out')

    expect(h.waitForURL).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 30_000,
    })
    const leftLogin = h.waitForURL.mock.calls[0]?.[0]
    expect(leftLogin).toBeDefined()
    if (!leftLogin) throw new Error('globalSetup did not install a navigation predicate')
    expect(leftLogin(new URL('https://example.test/login'))).toBe(false)
    expect(leftLogin(new URL('https://example.test/board'))).toBe(true)
    expect(h.waitForToolbar).toHaveBeenCalledWith({ timeout: 60_000 })
    expect(h.startTracing).toHaveBeenCalledWith({
      screenshots: true,
      snapshots: true,
      sources: true,
    })
    const screenshotOptions = h.screenshot.mock.calls[0]?.[0]
    expect(screenshotOptions?.fullPage).toBe(true)
    expect(screenshotOptions?.path).toMatch(/test-results[\\/]+global-setup[\\/]+failure\.png$/)
    const traceOptions = h.stopTracing.mock.calls[0]?.[0]
    expect(traceOptions?.path).toMatch(/test-results[\\/]+global-setup[\\/]+trace\.zip$/)
    expect(h.close).toHaveBeenCalledOnce()
  })

  it('stores the signed-in session and discards a successful setup trace', async () => {
    await globalSetup()

    const storageOptions = h.storageState.mock.calls[0]?.[0]
    expect(storageOptions?.path).toMatch(/tests[\\/]+e2e[\\/]+\.auth[\\/]+user\.json$/)
    expect(h.stopTracing).toHaveBeenCalledOnce()
    expect(h.stopTracing).toHaveBeenCalledWith()
    expect(h.screenshot).not.toHaveBeenCalled()
    expect(h.close).toHaveBeenCalledOnce()
  })
})
