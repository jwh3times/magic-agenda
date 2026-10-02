import { expect, test } from '@playwright/test'
import { inviteeSession, leaveAsInvitee, nameInvitee } from './fixtures/invitee'
import { testBoardId, testClient } from './fixtures/supabase'

/**
 * A Board Invitation, end to end in a real browser (#437).
 *
 * Covers what only a browser can: the blocking bootstrap scrubbing `?token=` before the app loads,
 * the token surviving a sign-in that happens on another page, the post-sign-in resume from `/`,
 * acceptance joining the Board, and (#476) an unnamed invitee naming themselves on the way in.
 *
 * **Sign-up itself is not driven here, and cannot be on this stack.** The isolated stack runs
 * production's `supabase/config.toml`, whose SMTP points at `smtp.resend.com` with a dummy key,
 * so a UI sign-up fails at its confirmation email. The invitee is therefore a pre-confirmed
 * account from `scripts/e2e-local-setup.ts`. What sign-up would add — confirmation landing on
 * `/`, which then resumes the invitation — is the same `HomeRoute` branch `HomeRoute.test.tsx`
 * covers.
 */

test.describe('Board invitation', () => {
  // The invitee's own browser: no stored session from global setup.
  test.use({ storageState: { cookies: [], origins: [] } })

  test('a signed-out invitee opens the link, signs in, and joins the Board', async ({ page }) => {
    const owner = await testClient()
    const boardId = await testBoardId(owner)
    const invitee = await inviteeSession()

    const created = await owner.rpc('create_invitation', {
      p_board_id: boardId,
      p_email: invitee.email,
      p_role: 'viewer',
    })
    expect(created.error).toBeNull()
    // Untyped client (no Database generic): narrow rather than trust `any`.
    const token: unknown = created.data
    if (typeof token !== 'string') throw new Error('create_invitation returned no token')

    // The name prompt appears only for an unnamed Account, so a retried run starts unnamed too.
    await nameInvitee(invitee, '')
    try {
      await page.goto(`/invite?token=${token}`)
      // Scrubbed before the app ran: the token is gone from the address bar.
      await expect(page).toHaveURL(/\/invite$/)
      await expect(
        page.getByText(/Sign in or create an account to see this invitation/),
      ).toBeVisible()

      await page.getByRole('link', { name: 'Sign in or create an account' }).click()
      await page.getByPlaceholder('you@example.com').fill(invitee.email)
      await page.getByPlaceholder('Password').fill(invitee.password)
      await page.getByRole('button', { name: 'Sign in', exact: true }).click({ timeout: 30_000 })

      // Sign-in lands on `/`, which resumes the held invitation.
      await expect(page).toHaveURL(/\/invite$/, { timeout: 30_000 })
      await expect(page.getByTestId('invitation-consent')).toContainText('attached files')
      await page.getByRole('textbox', { name: /Your name/ }).fill('Ivy Invitee')
      await page.getByRole('button', { name: /^Join / }).click()
      await expect(page).toHaveURL(/\/$/, { timeout: 30_000 })

      const { data: joined } = await invitee.client
        .from('board_memberships')
        .select('role')
        .eq('board_id', boardId)
        .is('ended_at', null)
      expect(joined).toEqual([{ role: 'viewer' }])

      // The Owner's member list names the new member with what they typed on the way in.
      const members = await owner.rpc('board_members', { p_board_id: boardId })
      expect(members.error).toBeNull()
      const rows: unknown = members.data
      if (!Array.isArray(rows)) throw new Error('board_members returned no rows')
      const joinedRow = (rows as { account_id: string; display_name: string }[]).find(
        (row) => row.account_id === invitee.accountId,
      )
      expect(joinedRow?.display_name).toBe('Ivy Invitee')
    } finally {
      // Leave the shared Board so the main account's other specs see it as before.
      await leaveAsInvitee(invitee, boardId)
      await nameInvitee(invitee, '')
    }
  })
})
