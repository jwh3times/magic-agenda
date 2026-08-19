import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { BoardDirectoryContext } from '../board/boardDirectoryContext'
import { checkBoardName, normalizeBoardName } from '../board/boardName'
import { fakeBoardDirectory, fakeBoardSummary } from '../board/fakeBoardDirectory'
import type { BoardSummary } from '../board/selection'
import type { UseBoardDirectory } from '../board/useBoardDirectory'
import { BoardsSection } from './BoardsSection'

const TWO_BOARDS: BoardSummary[] = [
  fakeBoardSummary({ id: 'b1', name: 'Personal', role: 'owner' }),
  fakeBoardSummary({ id: 'b2', name: 'Work', role: 'owner' }),
]

function Harness({
  initial = TWO_BOARDS,
  overrides = {},
}: {
  initial?: BoardSummary[]
  overrides?: Partial<UseBoardDirectory>
}) {
  const [boards, setBoards] = useState(initial)

  const directory: UseBoardDirectory = {
    ...fakeBoardDirectory({ boards }),
    boards,
    selectedBoardId: boards[0]?.id ?? null,
    deleteBoard: (id) => {
      setBoards((current) => current.filter((b) => b.id !== id))
      return Promise.resolve(null)
    },
    renameBoard: (id, name) => {
      const problem = checkBoardName(name)
      if (problem) return Promise.resolve(problem)
      setBoards((current) =>
        current.map((b) => (b.id === id ? { ...b, name: normalizeBoardName(name) } : b)),
      )
      return Promise.resolve(null)
    },
    ...overrides,
  }

  return (
    <BoardDirectoryContext.Provider value={directory}>
      <BoardsSection />
    </BoardDirectoryContext.Provider>
  )
}

/**
 * The listed Board names, in render order.
 *
 * Reads each row's first `<span>` rather than its `textContent`: a row also carries the "current"
 * marker, the Delete control, and — while confirming — a paragraph containing the name twice, so
 * whole-row text is neither the name nor stable across states.
 */
const boardNames = () =>
  screen.getAllByRole('listitem').map((li) => li.querySelector('span')?.textContent ?? '')

test('lists every Board and marks the current one', () => {
  render(<Harness />)
  expect(boardNames()).toEqual(['Personal', 'Work'])
  expect(screen.getByText('current')).toBeInTheDocument()
})

test('deletion is behind a confirmation that names what it destroys', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(screen.getAllByRole('button', { name: 'Delete…' })[0])

  // The consequence has to be stated, not implied — this is the only irreversible action here.
  expect(screen.getByText(/every task and label in it/i)).toBeInTheDocument()
  expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument()
})

test('the confirm button stays disabled until the Board name is typed', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(screen.getAllByRole('button', { name: 'Delete…' })[0])
  const confirmButton = screen.getByRole('button', { name: 'Delete board' })
  expect(confirmButton).toBeDisabled()

  await user.type(screen.getByLabelText('Type Personal to confirm deletion'), 'Work')
  expect(confirmButton).toBeDisabled()

  await user.clear(screen.getByLabelText('Type Personal to confirm deletion'))
  await user.type(screen.getByLabelText('Type Personal to confirm deletion'), 'Personal')
  expect(confirmButton).toBeEnabled()
})

test('the confirmation is case-insensitive and trimmed, not a spelling test', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(screen.getAllByRole('button', { name: 'Delete…' })[0])
  await user.type(screen.getByLabelText('Type Personal to confirm deletion'), '  personal  ')
  expect(screen.getByRole('button', { name: 'Delete board' })).toBeEnabled()
})

test('confirming deletes only that Board', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(screen.getAllByRole('button', { name: 'Delete…' })[0])
  await user.type(screen.getByLabelText('Type Personal to confirm deletion'), 'Personal')
  await user.click(screen.getByRole('button', { name: 'Delete board' }))

  await waitFor(() => expect(boardNames()).toEqual(['Work']))
})

test('Cancel abandons the deletion and leaves the Board alone', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(screen.getAllByRole('button', { name: 'Delete…' })[0])
  await user.type(screen.getByLabelText('Type Personal to confirm deletion'), 'Personal')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))

  expect(screen.queryByRole('button', { name: 'Delete board' })).not.toBeInTheDocument()
  expect(boardNames()).toEqual(['Personal', 'Work'])
})

test('a failed deletion explains itself and keeps the Board listed', async () => {
  const user = userEvent.setup()
  const deleteBoard = vi.fn(() => Promise.resolve('permission denied'))
  render(<Harness overrides={{ deleteBoard }} />)

  await user.click(screen.getAllByRole('button', { name: 'Delete…' })[0])
  await user.type(screen.getByLabelText('Type Personal to confirm deletion'), 'Personal')
  await user.click(screen.getByRole('button', { name: 'Delete board' }))

  expect(await screen.findByText('permission denied')).toBeInTheDocument()
  expect(boardNames()).toEqual(['Personal', 'Work'])
})

test('an Editor and a Viewer get no delete control', () => {
  render(
    <Harness
      initial={[
        fakeBoardSummary({ id: 'b1', name: 'Shared', role: 'editor' }),
        fakeBoardSummary({ id: 'b2', name: 'Readonly', role: 'viewer' }),
      ]}
    />,
  )
  expect(screen.queryByRole('button', { name: 'Delete…' })).not.toBeInTheDocument()
})

test('the delete control is per Board, following that Board’s role', () => {
  render(
    <Harness
      initial={[
        fakeBoardSummary({ id: 'b1', name: 'Mine', role: 'owner' }),
        fakeBoardSummary({ id: 'b2', name: 'Theirs', role: 'viewer' }),
      ]}
    />,
  )
  // Capability comes from each row's own role, not from the selected Board's.
  expect(screen.getAllByRole('button', { name: 'Delete…' })).toHaveLength(1)
})

test('an Account with no Boards is told where to make one', () => {
  render(<Harness initial={[]} />)
  expect(screen.getByText(/You have no boards/i)).toBeInTheDocument()
})

test('an Owner can rename a Board, committing on blur', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(screen.getAllByRole('button', { name: 'Rename' })[0])
  const field = screen.getByLabelText('Name for Personal')
  await user.clear(field)
  await user.type(field, 'Home')
  await user.tab()

  await waitFor(() => expect(boardNames()).toEqual(['Home', 'Work']))
})

test('Enter commits a rename without reaching for the mouse', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(screen.getAllByRole('button', { name: 'Rename' })[0])
  const field = screen.getByLabelText('Name for Personal')
  await user.clear(field)
  await user.type(field, 'Home{Enter}')

  await waitFor(() => expect(boardNames()).toEqual(['Home', 'Work']))
})

test('Escape abandons a rename', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(screen.getAllByRole('button', { name: 'Rename' })[0])
  const field = screen.getByLabelText('Name for Personal')
  await user.clear(field)
  await user.type(field, 'Discarded{Escape}')

  await waitFor(() => expect(boardNames()).toEqual(['Personal', 'Work']))
})

test('an empty name is refused and explained rather than silently kept', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(screen.getAllByRole('button', { name: 'Rename' })[0])
  await user.clear(screen.getByLabelText('Name for Personal'))
  await user.tab()

  expect(await screen.findByRole('alert')).toHaveTextContent(/Enter a board name/i)
  // The field stays open holding the rejected draft, so the mistake can be corrected in place
  // rather than retyped from scratch.
  expect(screen.getByLabelText('Name for Personal')).toHaveValue('')
  await user.type(screen.getByLabelText('Name for Personal'), '{Escape}')
  expect(boardNames()).toEqual(['Personal', 'Work'])
})

test('a name is trimmed on the way in', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(screen.getAllByRole('button', { name: 'Rename' })[0])
  const field = screen.getByLabelText('Name for Personal')
  await user.clear(field)
  await user.type(field, '   Spaced   ')
  await user.tab()

  await waitFor(() => expect(boardNames()).toEqual(['Spaced', 'Work']))
})

test('a rename the server refuses rolls back and explains', async () => {
  const user = userEvent.setup()
  render(<Harness overrides={{ renameBoard: () => Promise.resolve('permission denied') }} />)

  await user.click(screen.getAllByRole('button', { name: 'Rename' })[0])
  const field = screen.getByLabelText('Name for Personal')
  await user.clear(field)
  await user.type(field, 'Nope')
  await user.tab()

  expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
  expect(screen.getByLabelText('Name for Personal')).toHaveValue('Nope')
  // Escaping restores the committed name: the optimistic update was rolled back, not kept.
  await user.type(screen.getByLabelText('Name for Personal'), '{Escape}')
  expect(boardNames()).toEqual(['Personal', 'Work'])
})

test('Editors and Viewers get no rename control either', () => {
  render(
    <Harness
      initial={[
        fakeBoardSummary({ id: 'b1', name: 'Shared', role: 'editor' }),
        fakeBoardSummary({ id: 'b2', name: 'Readonly', role: 'viewer' }),
      ]}
    />,
  )
  expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument()
})
