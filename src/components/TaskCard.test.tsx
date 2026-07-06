import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
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
