import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '../theme/ThemeProvider'
import { Board } from './Board'

const renderBoard = () =>
  render(
    <ThemeProvider>
      <Board />
    </ThemeProvider>,
  )

test('renders the calendar board with mock tasks and an inbox', () => {
  renderBoard()
  expect(screen.getByText('Finish Q3 deck')).toBeInTheDocument() // scheduled today
  expect(screen.getByText('Renew passport')).toBeInTheDocument() // inbox
  expect(screen.getByText('Inbox')).toBeInTheDocument()
})

test('switches between Calendar and Board (kanban) views', async () => {
  const user = userEvent.setup()
  renderBoard()

  expect(screen.queryByText('In Progress')).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Board' }))
  expect(screen.getByText('To Do')).toBeInTheDocument()
  expect(screen.getByText('In Progress')).toBeInTheDocument()
  expect(screen.getByText('Completed')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Calendar' }))
  expect(screen.getByText('Inbox')).toBeInTheDocument()
})

test('+ New task creates a task via the editor', async () => {
  const user = userEvent.setup()
  renderBoard()

  await user.click(screen.getByRole('button', { name: '+ New task' }))
  await user.type(screen.getByPlaceholderText('Task title…'), 'Water the plants')
  await user.click(screen.getByRole('button', { name: 'Add task' }))

  expect(screen.queryByPlaceholderText('Task title…')).not.toBeInTheDocument()
  expect(screen.getByText('Water the plants')).toBeInTheDocument()
})

test('clicking a card opens the editor prefilled', async () => {
  const user = userEvent.setup()
  renderBoard()

  await user.click(screen.getByText('Finish Q3 deck'))
  expect(screen.getByDisplayValue('Finish Q3 deck')).toBeInTheDocument()
  expect(screen.getByText('Edit task')).toBeInTheDocument()
})
