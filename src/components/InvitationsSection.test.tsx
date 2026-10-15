import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
}))

vi.mock('../invite/invitations', () => ({
  listPendingInvitations: h.list,
  createInvitation: h.create,
  revokeInvitation: h.revoke,
}))

import { InvitationsSection } from './InvitationsSection'
import type { BoardMember } from '../board/boardMembers'

const owner = (accountId: string, displayName: string): BoardMember => ({
  membershipId: `m-${accountId}`,
  accountId,
  role: 'owner',
  displayName,
  joinedAt: '2026-09-01',
  email: null,
  nickname: null,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.list.mockResolvedValue({
    ok: true,
    value: [
      {
        id: 'i1',
        email: 'bo@example.test',
        role: 'viewer',
        expiresAt: '2026-10-10',
        invitedBy: 'a2',
      },
    ],
  })
  h.create.mockResolvedValue({ ok: true, value: 'tok123' })
  h.revoke.mockResolvedValue({ ok: true, value: undefined })
})

test('tells the Owner what the link grants and who it works for', () => {
  render(<InvitationsSection boardId="b1" boardName="Team" />)
  const group = screen.getByRole('group', { name: 'Invite people to Team' })
  expect(group).toHaveTextContent('only for someone signed in with that address')
  expect(group).toHaveTextContent('including attached files')
})

test('creating shows the link once, with the token, and refreshes the pending list', async () => {
  render(<InvitationsSection boardId="b1" boardName="Team" />)
  await userEvent.type(screen.getByLabelText('Email address to invite'), 'new@example.test')
  await userEvent.selectOptions(screen.getByLabelText('Role for the invitation'), 'viewer')
  await userEvent.click(screen.getByRole('button', { name: 'Create link' }))

  expect(h.create).toHaveBeenCalledWith('b1', 'new@example.test', 'viewer')
  const link = await screen.findByLabelText('Invitation link for new@example.test')
  expect((link as HTMLInputElement).value).toMatch(/\/invite\?token=tok123$/)
  expect(screen.getByText(/only time it is shown/)).toBeInTheDocument()
  await waitFor(() => expect(h.list).toHaveBeenCalledTimes(2))

  await userEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(screen.queryByLabelText('Invitation link for new@example.test')).toBeNull()
})

test('a refusal is shown in our own words and no link appears', async () => {
  h.create.mockResolvedValue({
    ok: false,
    reason: 'already-invited',
    message: 'That email already has a pending invitation.',
  })
  render(<InvitationsSection boardId="b1" boardName="Team" />)
  await userEvent.type(screen.getByLabelText('Email address to invite'), 'bo@example.test')
  await userEvent.click(screen.getByRole('button', { name: 'Create link' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('already has a pending invitation')
  expect(screen.queryByText(/only time it is shown/)).toBeNull()
})

test('lists pending invitations and revokes one', async () => {
  render(<InvitationsSection boardId="b1" boardName="Team" />)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Revoke invitation for bo@example.test' }),
  )
  expect(h.revoke).toHaveBeenCalledWith('i1')
})

test('says which Owner issued each pending invitation', async () => {
  h.list.mockResolvedValue({
    ok: true,
    value: [
      {
        id: 'i1',
        email: 'bo@example.test',
        role: 'viewer',
        expiresAt: '2026-10-10',
        invitedBy: 'a2',
      },
      {
        id: 'i2',
        email: 'cy@example.test',
        role: 'editor',
        expiresAt: '2026-10-10',
        invitedBy: 'a1',
      },
    ],
  })
  render(
    <InvitationsSection
      boardId="b1"
      boardName="Team"
      members={[owner('a1', 'Me'), owner('a2', 'Ada')]}
      selfAccountId="a1"
    />,
  )
  expect(await screen.findByText(/invited by Ada/)).toBeInTheDocument()
  expect(screen.getByText(/invited by you/)).toBeInTheDocument()
})

test('rereads the pending list when the members change', async () => {
  // Removing or demoting an Owner revokes their pending invitations on the server; the list must
  // not keep offering them.
  const { rerender } = render(
    <InvitationsSection boardId="b1" boardName="Team" members={[owner('a1', 'Me')]} />,
  )
  await waitFor(() => expect(h.list).toHaveBeenCalledTimes(1))
  rerender(<InvitationsSection boardId="b1" boardName="Team" members={[owner('a1', 'Me')]} />)
  await waitFor(() => expect(h.list).toHaveBeenCalledTimes(2))
})
