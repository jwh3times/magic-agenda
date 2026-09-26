import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import type { BoardMember } from '../board/boardMembers'
import { fakeBoardSummary } from '../board/fakeBoardDirectory'
import { boardFailed, type BoardOutcome } from '../board/outcome'

const h = vi.hoisted(() => ({
  members: [] as BoardMember[],
  list: vi.fn(),
  changeMemberRole: vi.fn(),
  removeMember: vi.fn(),
  leaveBoard: vi.fn(),
}))

vi.mock('../board/boardMembers', () => ({ listBoardMembers: h.list }))
vi.mock('../board/memberAdmin', () => ({
  changeMemberRole: h.changeMemberRole,
  removeMember: h.removeMember,
  leaveBoard: h.leaveBoard,
}))

import { MembersPanel } from './MembersPanel'

const ok: BoardOutcome = { ok: true, value: undefined }

const member = (over: Partial<BoardMember>): BoardMember => ({
  membershipId: 'm1',
  accountId: 'a1',
  role: 'owner',
  displayName: 'Ada',
  joinedAt: '2026-09-26T10:00:00Z',
  email: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.members = [
    member({ email: 'ada@example.test' }),
    member({
      membershipId: 'm2',
      accountId: 'a2',
      role: 'editor',
      displayName: 'Bo',
      email: 'bo@example.test',
    }),
    member({ membershipId: 'm3', accountId: 'a3', role: 'viewer', displayName: '' }),
  ]
  h.list.mockImplementation(() => Promise.resolve({ ok: true, value: h.members }))
  for (const command of [h.changeMemberRole, h.removeMember, h.leaveBoard])
    command.mockResolvedValue(ok)
})

function renderPanel(role: 'owner' | 'editor' | 'viewer' = 'owner', membershipId = 'm1') {
  const onOwnMembershipChanged = vi.fn()
  render(
    <MembersPanel
      board={fakeBoardSummary({ role, membershipId, name: 'Team' })}
      onClose={() => {}}
      onOwnMembershipChanged={onOwnMembershipChanged}
    />,
  )
  return { onOwnMembershipChanged }
}

test('lists members with names, marks the caller, and falls back for a blank Display Name', async () => {
  renderPanel()
  expect(await screen.findByText('Bo')).toBeInTheDocument()
  expect(screen.getByText('(you)')).toBeInTheDocument()
  expect(screen.getByText('Unnamed member')).toBeInTheDocument()
  expect(screen.getByText('bo@example.test')).toBeInTheDocument()
})

test('an Owner gets role selects and Remove for others, never for themselves', async () => {
  renderPanel('owner')
  await screen.findByText('Bo')
  expect(screen.getAllByRole('combobox')).toHaveLength(3)
  // Two others, so two Remove buttons: the caller leaves rather than removing themselves.
  expect(screen.getAllByRole('button', { name: 'Remove…' })).toHaveLength(2)
})

test('an Editor sees roles as text and no administration controls', async () => {
  renderPanel('editor', 'm2')
  await screen.findByText('Ada')
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Remove…' })).toBeNull()
  expect(screen.getByText('Owner')).toBeInTheDocument()
  // Leaving is every member's.
  expect(screen.getByRole('button', { name: 'Leave board…' })).toBeInTheDocument()
})

test('changing a role calls the command and re-reads the list', async () => {
  renderPanel()
  await userEvent.selectOptions(await screen.findByLabelText('Role for Bo'), 'viewer')
  expect(h.changeMemberRole).toHaveBeenCalledWith('m2', 'viewer')
  await waitFor(() => expect(h.list).toHaveBeenCalledTimes(2))
})

test('changing your own role reloads the directory, since capabilities derive from it', async () => {
  const { onOwnMembershipChanged } = renderPanel()
  await userEvent.selectOptions(await screen.findByLabelText('Role for Ada'), 'editor')
  await waitFor(() => expect(onOwnMembershipChanged).toHaveBeenCalled())
})

test('a last-owner refusal is shown in the server’s words and changes nothing locally', async () => {
  h.changeMemberRole.mockResolvedValueOnce(boardFailed('last-owner'))
  const { onOwnMembershipChanged } = renderPanel()
  await userEvent.selectOptions(await screen.findByLabelText('Role for Ada'), 'editor')
  expect(await screen.findByRole('alert')).toHaveTextContent(/at least one owner/)
  expect(onOwnMembershipChanged).not.toHaveBeenCalled()
})

test('removing asks first, then removes', async () => {
  renderPanel()
  const [removeBo] = await screen.findAllByRole('button', { name: 'Remove…' })
  await userEvent.click(removeBo)
  expect(h.removeMember).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
  expect(h.removeMember).toHaveBeenCalledWith('m2')
})

test('leaving asks first, then hands off to the directory', async () => {
  const { onOwnMembershipChanged } = renderPanel('viewer', 'm3')
  await userEvent.click(await screen.findByRole('button', { name: 'Leave board…' }))
  await userEvent.click(screen.getByRole('button', { name: 'Leave' }))
  expect(h.leaveBoard).toHaveBeenCalledWith('b1')
  expect(onOwnMembershipChanged).toHaveBeenCalled()
})

test('a refused leave says why and stays', async () => {
  h.leaveBoard.mockResolvedValueOnce(boardFailed('last-owner'))
  const { onOwnMembershipChanged } = renderPanel()
  await userEvent.click(await screen.findByRole('button', { name: 'Leave board…' }))
  await userEvent.click(screen.getByRole('button', { name: 'Leave' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/at least one owner/)
  expect(onOwnMembershipChanged).not.toHaveBeenCalled()
})
