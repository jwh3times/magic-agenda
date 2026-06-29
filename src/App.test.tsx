import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

test('renders the calendar board with mock tasks and an inbox', () => {
  render(<App />)
  expect(screen.getByText('Finish Q3 deck')).toBeInTheDocument() // scheduled today
  expect(screen.getByText('Renew passport')).toBeInTheDocument() // inbox
  expect(screen.getByText('Inbox')).toBeInTheDocument()
})

test('switches between Calendar and Board (kanban) views', async () => {
  const user = userEvent.setup()
  render(<App />)

  // Kanban columns are not present in the calendar view.
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
  render(<App />)

  await user.click(screen.getByRole('button', { name: '+ New task' }))
  const title = screen.getByPlaceholderText('Task title…')
  await user.type(title, 'Water the plants')
  await user.click(screen.getByRole('button', { name: 'Add task' }))

  // Modal closed and the new task is on the board.
  expect(screen.queryByPlaceholderText('Task title…')).not.toBeInTheDocument()
  expect(screen.getByText('Water the plants')).toBeInTheDocument()
})

test('clicking a card opens the editor prefilled', async () => {
  const user = userEvent.setup()
  render(<App />)

  await user.click(screen.getByText('Finish Q3 deck'))
  expect(screen.getByDisplayValue('Finish Q3 deck')).toBeInTheDocument()
  expect(screen.getByText('Edit task')).toBeInTheDocument()
})
