import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { testBoardId, testClient } from './fixtures/supabase'

/**
 * A Board Invitation, end to end in a real browser (#437).
 *
 * Covers what only a browser can: the blocking bootstrap scrubbing `?token=` before the app loads,
 * the token surviving a sign-in that happens on another page, the post-sign-in resume from `/`,
 * and acceptance joining the Board.
 *
 * **Sign-up itself is not driven here, and cannot be on this stack.** The isolated stack runs
 * production's `supabase/config.toml`, whose SMTP points at `smtp.resend.com` with a dummy key,
 * so a UI sign-up fails at its confirmation email. The invitee is therefore a pre-confirmed
 * account from `scripts/e2e-local-setup.ts`. What sign-up would add — confirmation landing on
 * `/`, which then resumes the invitation — is the same `HomeRoute` branch `HomeRoute.test.tsx`
 * covers.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is unset; scripts/e2e-local-setup.ts provides it.`)
  return value
}

test.describe('Board invitation', () => {
  // The invitee's own browser: no stored session from global setup.
  test.use({ storageState: { cookies: [], origins: [] } })

  test('a signed-out invitee opens the link, signs in, and joins the Board', async ({ page }) => {
    const inviteeEmail = required('E2E_INVITEE_EMAIL')
    const inviteePassword = required('E2E_INVITEE_PASSWORD')
    const owner = await testClient()
    const boardId = await testBoardId(owner)

    const created = await owner.rpc('create_invitation', {
      p_board_id: boardId,
      p_email: inviteeEmail,
      p_role: 'viewer',
    })
    expect(created.error).toBeNull()
    // Untyped client (no Database generic): narrow rather than trust `any`.
    const token: unknown = created.data
    if (typeof token !== 'string') throw new Error('create_invitation returned no token')

    const invitee = createClient(required('E2E_SUPABASE_URL'), required('E2E_SUPABASE_ANON_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    try {
      await page.goto(`/invite?token=${token}`)
      // Scrubbed before the app ran: the token is gone from the address bar.
      await expect(page).toHaveURL(/\/invite$/)
      await expect(
        page.getByText(/Sign in or create an account to see this invitation/),
      ).toBeVisible()

      await page.getByRole('link', { name: 'Sign in or create an account' }).click()
      await page.getByPlaceholder('you@example.com').fill(inviteeEmail)
      await page.getByPlaceholder('Password').fill(inviteePassword)
      await page.getByRole('button', { name: 'Sign in', exact: true }).click({ timeout: 30_000 })

      // Sign-in lands on `/`, which resumes the held invitation.
      await expect(page).toHaveURL(/\/invite$/, { timeout: 30_000 })
      await expect(page.getByTestId('invitation-consent')).toContainText('attached files')
      await page.getByRole('button', { name: /^Join / }).click()
      await expect(page).toHaveURL(/\/$/, { timeout: 30_000 })

      const signIn = await invitee.auth.signInWithPassword({
        email: inviteeEmail,
        password: inviteePassword,
        options: { captchaToken: 'XXXX.DUMMY.TOKEN.XXXX' },
      })
      expect(signIn.error).toBeNull()
      const { data: joined } = await invitee
        .from('board_memberships')
        .select('role')
        .eq('board_id', boardId)
        .is('ended_at', null)
      expect(joined).toEqual([{ role: 'viewer' }])
    } finally {
      // Leave the shared Board so the main account's other specs see it as before.
      await invitee.rpc('leave_board', { p_board_id: boardId })
    }
  })
})
