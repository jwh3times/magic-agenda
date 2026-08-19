import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, test, vi } from 'vitest'
import { BoardDirectoryContext } from '../board/boardDirectoryContext'
import { fakeBoardDirectory } from '../board/fakeBoardDirectory'
import type { UseBoardDirectory } from '../board/useBoardDirectory'
import { ThemeProvider } from '../theme/ThemeProvider'
import { NoBoards } from './NoBoards'

function renderNoBoards(overrides: Partial<UseBoardDirectory> = {}) {
  const directory = fakeBoardDirectory({ boards: [], selectedBoardId: null, ...overrides })
  return render(
    <MemoryRouter>
      <ThemeProvider initial="cork">
        <BoardDirectoryContext.Provider value={directory}>
          <NoBoards />
        </BoardDirectoryContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

test('says plainly that there are no boards, rather than looking like an empty one', () => {
  renderNoBoards()
  expect(screen.getByRole('heading', { name: /No boards yet/i })).toBeInTheDocument()
})

test('carries its own main landmark and h1 rather than borrowing a modal exemption', () => {
  // ErrorScreen and Spinner are `position: fixed; inset: 0`, which axe's isModalOpen() heuristic
  // treats as an open modal — so landmark-one-main and page-has-heading-one pass for free against
  // them. A screen a user can sit in should earn those.
  const { container } = renderNoBoards()
  expect(container.querySelector('main')).not.toBeNull()
  expect(container.querySelector('h1')).not.toBeNull()
})

test('offers a way out: creating a board from here works', async () => {
  const user = userEvent.setup()
  const createBoard = vi.fn(() => Promise.resolve(null))
  renderNoBoards({ createBoard })

  await user.type(screen.getByLabelText('New board name'), 'Starting over')
  await user.click(screen.getByRole('button', { name: 'Create board' }))

  expect(createBoard).toHaveBeenCalledWith('Starting over')
})

test('Enter submits, so the single field does not need the mouse', async () => {
  const user = userEvent.setup()
  const createBoard = vi.fn(() => Promise.resolve(null))
  renderNoBoards({ createBoard })

  await user.type(screen.getByLabelText('New board name'), 'Via keyboard{Enter}')
  expect(createBoard).toHaveBeenCalledWith('Via keyboard')
})

test('a refused creation is explained rather than leaving a dead screen', async () => {
  const user = userEvent.setup()
  renderNoBoards({ createBoard: () => Promise.resolve('board limit reached') })

  await user.type(screen.getByLabelText('New board name'), 'Nope')
  await user.click(screen.getByRole('button', { name: 'Create board' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('board limit reached')
})

test('clears the field after a successful create, so a second board is not a retype', async () => {
  const user = userEvent.setup()
  renderNoBoards({ createBoard: () => Promise.resolve(null) })

  await user.type(screen.getByLabelText('New board name'), 'First')
  await user.click(screen.getByRole('button', { name: 'Create board' }))

  expect(await screen.findByLabelText('New board name')).toHaveValue('')
})
