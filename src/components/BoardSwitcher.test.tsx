import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { expect, test } from 'vitest'
import { BoardDirectoryContext } from '../board/boardDirectoryContext'
import { fakeBoardDirectory, fakeBoardSummary } from '../board/fakeBoardDirectory'
import type { BoardSummary } from '../board/selection'
import type { UseBoardDirectory } from '../board/useBoardDirectory'
import { ThemeProvider } from '../theme/ThemeProvider'
import { BoardSwitcher } from './BoardSwitcher'

const TWO_BOARDS: BoardSummary[] = [
  fakeBoardSummary({ id: 'b1', name: 'Personal' }),
  fakeBoardSummary({ id: 'b2', name: 'Work' }),
]

function Wrap({ children }: { children: ReactNode }) {
  return <ThemeProvider initial="cork">{children}</ThemeProvider>
}

/**
 * The switcher against a directory whose selection and creation are backed by real React state, so
 * a switch or a create actually re-renders. No module mocking: the context is its own module, so
 * the real provider value can simply be supplied.
 */
function Harness({
  initial = TWO_BOARDS,
  overrides = {},
}: {
  initial?: BoardSummary[]
  overrides?: Partial<UseBoardDirectory>
}) {
  const [boards, setBoards] = useState(initial)
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(initial[0]?.id ?? null)

  const directory: UseBoardDirectory = {
    ...fakeBoardDirectory({ boards }),
    boards,
    selectedBoardId,
    selectBoard: (id) => setSelectedBoardId(id),
    createBoard: (name) => {
      const created = fakeBoardSummary({ id: `new-${boards.length}`, name })
      setBoards((current) => [...current, created])
      setSelectedBoardId(created.id)
      return Promise.resolve(null)
    },
    ...overrides,
  }

  return (
    <Wrap>
      <BoardDirectoryContext.Provider value={directory}>
        <BoardSwitcher />
      </BoardDirectoryContext.Provider>
    </Wrap>
  )
}

test('renders nothing without a Board Directory, so the Toolbar stands alone', () => {
  const { container } = render(
    <Wrap>
      <BoardSwitcher />
    </Wrap>,
  )
  expect(container).toBeEmptyDOMElement()
})

test('lists every Board with the selected one showing', () => {
  render(<Harness />)
  expect(screen.getByLabelText('Board')).toHaveValue('b1')
  expect(screen.getByRole('option', { name: 'Personal' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'Work' })).toBeInTheDocument()
})

test('choosing another Board switches to it', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.selectOptions(screen.getByLabelText('Board'), 'b2')
  await waitFor(() => expect(screen.getByLabelText('Board')).toHaveValue('b2'))
})

test('choosing New board opens the creator in place, without switching Board', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.selectOptions(screen.getByLabelText('Board'), '__new__')

  expect(screen.getByLabelText('New board name')).toBeInTheDocument()
  // Replaced rather than joined: a slot that grows a second row is how the mobile toolbar breaks.
  expect(screen.queryByLabelText('Board')).not.toBeInTheDocument()
})

test('creating a Board adds it and opens it', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.selectOptions(screen.getByLabelText('Board'), '__new__')
  await user.type(screen.getByLabelText('New board name'), 'Side project')
  await user.click(screen.getByRole('button', { name: 'Create' }))

  const select = await screen.findByLabelText('Board')
  expect(screen.getByRole('option', { name: 'Side project' })).toBeInTheDocument()
  expect(select).toHaveValue('new-2')
})

test('Cancel abandons creation and restores the switcher unchanged', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.selectOptions(screen.getByLabelText('Board'), '__new__')
  await user.type(screen.getByLabelText('New board name'), 'Discarded')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))

  expect(await screen.findByLabelText('Board')).toHaveValue('b1')
  expect(screen.queryByRole('option', { name: 'Discarded' })).not.toBeInTheDocument()
})

test('Escape abandons creation too', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.selectOptions(screen.getByLabelText('Board'), '__new__')
  await user.type(screen.getByLabelText('New board name'), 'Discarded{Escape}')

  expect(await screen.findByLabelText('Board')).toHaveValue('b1')
})

test('a refused creation explains itself and keeps the draft for correction', async () => {
  const user = userEvent.setup()
  render(<Harness overrides={{ createBoard: () => Promise.resolve('board limit reached') }} />)

  await user.selectOptions(screen.getByLabelText('Board'), '__new__')
  await user.type(screen.getByLabelText('New board name'), 'One too many')
  await user.click(screen.getByRole('button', { name: 'Create' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('board limit reached')
  // Still in the creator with the typed name intact — a refusal must not discard the user's input.
  expect(screen.getByLabelText('New board name')).toHaveValue('One too many')
})

test('an empty directory renders nothing rather than an empty dropdown', () => {
  render(<Harness initial={[]} />)
  expect(screen.queryByLabelText('Board')).not.toBeInTheDocument()
})
