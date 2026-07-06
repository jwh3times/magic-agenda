import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ThemeProvider } from '../theme/ThemeProvider'
import { TaskCard, type TaskCardProps } from './TaskCard'
import { NO_RECUR, type Task } from '../types/task'

function mkTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Card under test',
    description: '',
    category: 'work',
    color: 'yellow',
    checklist: [],
    status: 'todo',
    done: false,
    day: '2026-07-10',
    order: 0,
    korder: 0,
    atTime: null,
    pinned: false,
    ...NO_RECUR,
    ...over,
  }
}

function renderCard(task: Task, props: Partial<TaskCardProps> = {}) {
  return render(
    <ThemeProvider>
      <TaskCard task={task} variant="inbox" {...props} />
    </ThemeProvider>,
  )
}

test('shows a compact time chip when the task has a due time', () => {
  renderCard(mkTask({ atTime: '14:30' }))
  expect(screen.getByText('2:30pm')).toBeInTheDocument()
})

test('shows no time chip for all-day tasks', () => {
  renderCard(mkTask({ atTime: null }))
  expect(screen.queryByText(/am|pm/)).not.toBeInTheDocument()
})

test('the pin tap-target toggles without opening the editor', async () => {
  const onTogglePin = vi.fn()
  const onOpen = vi.fn()
  renderCard(mkTask({ pinned: false }), { onTogglePin, onOpen })
  await userEvent.click(screen.getByRole('button', { name: 'Pin' }))
  expect(onTogglePin).toHaveBeenCalledWith('t1')
  expect(onOpen).not.toHaveBeenCalled()
})

test('no pin button renders when no handler is provided (drag overlay)', () => {
  renderCard(mkTask({ pinned: true }))
  expect(screen.queryByRole('button', { name: /Pin|Unpin/ })).not.toBeInTheDocument()
})

test('kanban card with a due time shows only the time chip, not the day chip', () => {
  renderCard(mkTask({ atTime: '14:30', day: '2026-07-10' }), { variant: 'kanban' })
  expect(screen.getByText('2:30pm')).toBeInTheDocument()
  expect(screen.queryByText('Jul 10')).not.toBeInTheDocument()
})

test('kanban card with no due time still shows the day chip', () => {
  renderCard(mkTask({ atTime: null, day: '2026-07-10' }), { variant: 'kanban' })
  expect(screen.getByText('Jul 10')).toBeInTheDocument()
  expect(screen.queryByText(/am|pm/)).not.toBeInTheDocument()
})
