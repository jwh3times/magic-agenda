import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '../theme/ThemeProvider'
import { Board } from './Board'
import { applyToggleDone } from '../data/selectors'
import { makeMockTasks } from '../data/mockTasks'
import type { Task } from '../types/task'

// Mimics BoardPage's data ownership with local state (no Supabase) so Board stays hermetic.
function Harness() {
  const [tasks, setTasks] = useState<Task[]>(makeMockTasks)
  return (
    <ThemeProvider>
      <Board
        tasks={tasks}
        setTasks={setTasks}
        onCreate={(t) => setTasks((p) => [...p, t])}
        onUpdate={(t) => setTasks((p) => p.map((x) => (x.id === t.id ? t : x)))}
        onDelete={(id) => setTasks((p) => p.filter((x) => x.id !== id))}
        onToggleDone={(id) => setTasks((p) => applyToggleDone(p, id).tasks)}
        persistReorder={(next) => setTasks(next)}
      />
    </ThemeProvider>
  )
}

const renderBoard = () => render(<Harness />)

test('renders the calendar board with mock tasks and an inbox', () => {
  renderBoard()
  expect(screen.getByText('Finish Q3 deck')).toBeInTheDocument() // scheduled today
  expect(screen.getByText('Renew passport')).toBeInTheDocument() // inbox
  expect(screen.getByText('Inbox')).toBeInTheDocument()
})

test('switches between Calendar and Board (kanban) views', async () => {
  const user = userEvent.setup()
  renderBoard()

  // Status words also appear in the filter dropdown <option>s, so scope to the column <span>s.
  expect(screen.queryByText('In Progress', { selector: 'span' })).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Board' }))
  expect(screen.getByText('To Do', { selector: 'span' })).toBeInTheDocument()
  expect(screen.getByText('In Progress', { selector: 'span' })).toBeInTheDocument()
  expect(screen.getByText('Completed', { selector: 'span' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Calendar' }))
  expect(screen.getByText('Inbox')).toBeInTheDocument()
})

test('Week and Agenda views render', async () => {
  const user = userEvent.setup()
  renderBoard()

  await user.click(screen.getByRole('button', { name: 'Week' }))
  expect(screen.getByText('Finish Q3 deck')).toBeInTheDocument() // today falls in the current week
  expect(screen.getByText('Inbox')).toBeInTheDocument() // sidebar still present

  await user.click(screen.getByRole('button', { name: 'Agenda' }))
  expect(screen.getByText('Unscheduled · Inbox')).toBeInTheDocument()
  expect(screen.getByText('Finish Q3 deck')).toBeInTheDocument()
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

test('search hides non-matching tasks live', async () => {
  const user = userEvent.setup()
  renderBoard()

  expect(screen.getByText('Renew passport')).toBeInTheDocument()
  await user.type(screen.getByPlaceholderText('Search tasks…'), 'Finish')
  expect(screen.getByText('Finish Q3 deck')).toBeInTheDocument()
  expect(screen.queryByText('Renew passport')).not.toBeInTheDocument()
})
