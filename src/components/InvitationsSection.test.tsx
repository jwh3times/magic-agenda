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

beforeEach(() => {
  vi.clearAllMocks()
  h.list.mockResolvedValue({
    ok: true,
    value: [{ id: 'i1', email: 'bo@example.test', role: 'viewer', expiresAt: '2026-10-10' }],
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
