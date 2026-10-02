import { expect, test } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { inviteeSession, leaveAsInvitee, nameInvitee } from './fixtures/invitee'
import { testBoardId, testClient } from './fixtures/supabase'

/**
 * The Members panel, driven as an Owner in a real browser (#494).
 *
 * It is reachable here only because `scripts/e2e-local-setup.ts` enables `board-sharing` as
 * production has it. Before that, the E2E account saw no **Members…** button at all, and every
 * screen in this file shipped with unit and RLS coverage only.
 *
 * The invitation is created through the Owner's UI, the half `invitation.spec.ts` cannot reach
 * (it is about the invitee's browser). Acceptance goes through the invitee's own Data API client,
 * since the invitee's side of the link is that spec's subject.
 */

const INVITEE_NAME = 'Ivy Invitee'
const LABEL = 'Pat from accounts'

test.describe('Members panel', () => {
  test('an Owner invites from the panel, then sets and clears a member label', async ({ page }) => {
    const owner = await testClient()
    const boardId = await testBoardId(owner)
    const invitee = await inviteeSession()
    await nameInvitee(invitee, INVITEE_NAME)
    let token: string | null = null
    let joined = false

    try {
      await page.goto('/settings')
      await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
      await page.getByRole('button', { name: 'Members…' }).click()
      const panel = page.getByRole('group', { name: /^Members of / })
      await expect(panel.getByText('(you)')).toBeVisible()

      const invite = panel.getByRole('group', { name: /^Invite people to / })
      await invite.getByRole('textbox', { name: 'Email address to invite' }).fill(invitee.email)
      await invite.getByRole('combobox', { name: 'Role for the invitation' }).selectOption('viewer')
      await invite.getByRole('button', { name: 'Create link' }).click()
      const url = await invite
        .getByRole('textbox', { name: `Invitation link for ${invitee.email}` })
        .inputValue()
      token = new URL(url).searchParams.get('token')
      if (!token) throw new Error(`the invitation link carried no token: ${url}`)
      await invite.getByRole('button', { name: 'Done' }).click()
      await expect(invite.getByText(invitee.email)).toBeVisible()

      const accepted = await invitee.client.rpc('accept_invitation', { p_token: token })
      expect(accepted.error).toBeNull()
      joined = true

      // The panel reads its list on open and after its own changes, not on someone else's join.
      await panel.getByRole('button', { name: 'Hide' }).click()
      await page.getByRole('button', { name: 'Members…' }).click()
      const row = panel.getByRole('listitem').filter({ hasText: INVITEE_NAME })
      await expect(row).toContainText(invitee.email)
      await expect(row.getByRole('combobox', { name: `Role for ${INVITEE_NAME}` })).toHaveValue(
        'viewer',
      )
      await expect(invite.getByText(invitee.email)).toHaveCount(0)

      // Set an Owner-private label (#490). The member's own name stays beside it.
      await row.getByRole('button', { name: 'Name…' }).click()
      await row.getByRole('textbox', { name: `Name on this board for ${INVITEE_NAME}` }).fill(LABEL)
      await row.getByRole('button', { name: 'Save' }).click()
      await expect(row.getByText(LABEL, { exact: true })).toBeVisible()
      await expect(row.getByText(INVITEE_NAME, { exact: true })).toBeVisible()
      expect(await nicknameOf(owner, boardId, invitee.accountId)).toBe(LABEL)

      // And clear it.
      await row.getByRole('button', { name: 'Name…' }).click()
      await row.getByRole('button', { name: 'Clear name' }).click()
      await expect(row.getByText(LABEL)).toHaveCount(0)
      await expect(row.getByText(INVITEE_NAME, { exact: true })).toBeVisible()
      expect(await nicknameOf(owner, boardId, invitee.accountId)).toBeNull()
    } finally {
      // Leave the Board as the other specs expect it: one member, no pending invitation.
      if (joined) await leaveAsInvitee(invitee, boardId)
      else if (token) await invitee.client.rpc('decline_invitation', { p_token: token })
      await nameInvitee(invitee, '')
    }
  })
})

/** The Owner's label for one member, as `board_members()` returns it; `null` when there is none. */
async function nicknameOf(
  owner: SupabaseClient,
  boardId: string,
  accountId: string,
): Promise<string | null> {
  const listed = await owner.rpc('board_members', { p_board_id: boardId })
  if (listed.error) throw new Error(`board_members failed: ${listed.error.message}`)
  // Untyped client (no Database generic): narrow rather than trust `any`.
  const rows: unknown = listed.data
  if (!Array.isArray(rows)) throw new Error('board_members returned no rows')
  const row = (rows as { account_id: string; nickname: string | null }[]).find(
    (member) => member.account_id === accountId,
  )
  if (!row) throw new Error('the invitee is not on the Board')
  return row.nickname
}
