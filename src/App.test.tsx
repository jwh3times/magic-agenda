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
