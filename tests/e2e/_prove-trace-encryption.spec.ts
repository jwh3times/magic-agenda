import { expect, test } from '@playwright/test'
import { seedBoard, SEEDED_TITLES } from './fixtures/seedBoard'

/**
 * TEMPORARY -- deliberately fails to prove the CI trace-encryption path works end to end.
 * Signed in on purpose, so the trace contains real Supabase traffic (and therefore a live
 * `authorization: Bearer` header) in its plaintext form. This file is reverted immediately after.
 */
test('deliberate failure to exercise the trace encryption step', async ({ page }) => {
  await seedBoard()
  await page.goto('/')
  await expect(page.getByRole('button', { name: '+ New task' })).toBeVisible()
  await expect(page.getByText(SEEDED_TITLES[0])).toBeVisible()
  expect('this failure is intentional').toBe('see the Encrypt the traces step')
})
