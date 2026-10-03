import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { expect, test, vi } from 'vitest'
import {
  BoardMembersContext,
  initialsOf,
  NO_BOARD_MEMBERS,
  type BoardMembersValue,
} from '../board/boardMembersContext'
import type { BoardMember } from '../board/boardMembers'
import { EMPTY_FILTER, type FilterQuery } from '../data/filters'
import { fakeLabelDirectory } from '../labels/fakeLabelDirectory'
import { LabelDirectoryContext } from '../labels/labelDirectoryContext'
import { ThemeProvider } from '../theme/ThemeProvider'
import { asTask, NO_RECUR, type Task } from '../types/task'
import { SearchFilterBar } from './SearchFilterBar'
import { TaskCard } from './TaskCard'
import { TaskEditor } from './TaskEditor'

/**
 * The Assignee UI (#440): card initials, the editor's picker, and "Assigned to me".
 *
 * All three read `BoardMembersContext`, which is empty unless the `board-sharing` flag is on and
 * holds one member on a Private Board — so each is asserted present on a shared Board and absent
 * on a Private one. "Absent" must mean both of those states, not just sharing off: the card was
 * checked only against the empty list, and showed an uncleanable badge on a Private Board (#506).
 */

const member = (over: Partial<BoardMember>): BoardMember => ({
  membershipId: 'm1',
  accountId: 'a1',
  role: 'owner',
  displayName: 'Ada Lovelace',
  joinedAt: '2026-09-27T00:00:00Z',
  email: null,
  nickname: null,
  ...over,
})

const SHARED: BoardMembersValue = {
  members: [
    member({}),
    member({ membershipId: 'm2', accountId: 'a2', role: 'editor', displayName: 'Bo' }),
  ],
  me: 'a1',
}
const PRIVATE: BoardMembersValue = { members: [member({})], me: 'a1' }

const task = (over: Partial<Task> = {}): Task =>
  asTask({
    id: 't1',
    title: 'Ship it',
    description: '',
    labelId: null,
    assigneeId: null,
    color: 'yellow',
    checklist: [],
    status: 'todo',
    completedAt: null,
    reopenStatus: 'todo',
    archivedAt: null,
    day: '2026-09-27',
    atTime: null,
    pinned: false,
    order: 0,
    korder: 0,
    ...NO_RECUR,
    ...over,
  })

function Providers({ members, children }: { members: BoardMembersValue; children: ReactNode }) {
  return (
    <ThemeProvider>
      <LabelDirectoryContext.Provider value={fakeLabelDirectory()}>
        <BoardMembersContext.Provider value={members}>{children}</BoardMembersContext.Provider>
      </LabelDirectoryContext.Provider>
    </ThemeProvider>
  )
}

test('initials come from up to two words, with a fallback for no name', () => {
  expect(initialsOf('Ada Lovelace')).toBe('AL')
  expect(initialsOf('bo')).toBe('B')
  expect(initialsOf('   ')).toBe('?')
})

test('a card shows its assignee’s initials on a shared Board', () => {
  render(
    <Providers members={SHARED}>
      <TaskCard task={task({ assigneeId: 'a2' })} variant="inbox" />
    </Providers>,
  )
  expect(screen.getByLabelText('Assigned to Bo')).toHaveTextContent('B')
})

test('a card shows nothing when the members are unknown (sharing off)', () => {
  render(
    <Providers members={NO_BOARD_MEMBERS}>
      <TaskCard task={task({ assigneeId: 'a2' })} variant="inbox" />
    </Providers>,
  )
  expect(screen.queryByLabelText(/Assigned to/)).toBeNull()
})

// The case that shipped broken (#506): an Owner assigns a task to themselves, then the only other
// member leaves. The assignee is still a member, so the server keeps the assignment, and the list
// still holds them — but the editor's picker is gone, so a badge here could never be cleared.
test('a card shows nothing on a Private Board, even when its assignee is the remaining member', () => {
  render(
    <Providers members={PRIVATE}>
      <TaskCard task={task({ assigneeId: 'a1' })} variant="inbox" />
    </Providers>,
  )
  expect(screen.queryByLabelText(/Assigned to/)).toBeNull()
})

function renderEditor(members: BoardMembersValue, over: Partial<Task> = {}, canEdit = true) {
  const onSave = vi.fn()
  render(
    <Providers members={members}>
      <TaskEditor
        initial={task(over)}
        isNew={false}
        onSave={onSave}
        onDelete={() => {}}
        onClose={() => {}}
        canEditContent={canEdit}
      />
    </Providers>,
  )
  return { onSave }
}

test('the editor assigns and unassigns on a shared Board', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(SHARED)
  const picker = screen.getByLabelText('Assignee')
  expect(picker).toHaveValue('')
  // The viewer is marked, so "me" is findable in a list of names.
  expect(screen.getByRole('option', { name: 'Ada Lovelace (you)' })).toBeInTheDocument()

  await user.selectOptions(picker, 'a2')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: 'a2' }))
})

test('choosing Unassigned saves null, not an empty string', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(SHARED, { assigneeId: 'a2' })
  await user.selectOptions(screen.getByLabelText('Assignee'), '')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: null }))
})

test('the editor offers no Assignee on a Private Board', () => {
  renderEditor(PRIVATE)
  expect(screen.queryByLabelText('Assignee')).toBeNull()
})

test('a Viewer sees the Assignee but cannot change it', () => {
  renderEditor(SHARED, { assigneeId: 'a2' }, false)
  expect(screen.getByLabelText('Assignee')).toBeDisabled()
})

function renderBar(members: BoardMembersValue, query: FilterQuery = EMPTY_FILTER) {
  const onChange = vi.fn()
  render(
    <Providers members={members}>
      <SearchFilterBar query={query} onChange={onChange} />
    </Providers>,
  )
  return { onChange }
}

test('"Assigned to me" filters by the viewer’s own account, and toggles back off', async () => {
  const user = userEvent.setup()
  const { onChange } = renderBar(SHARED)
  await user.click(screen.getByRole('button', { name: /Assigned to me/ }))
  expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER, assignedTo: 'a1' })
})

test('"Assigned to me" is absent on a Private Board', () => {
  renderBar(PRIVATE)
  expect(screen.queryByRole('button', { name: /Assigned to me/ })).toBeNull()
})
