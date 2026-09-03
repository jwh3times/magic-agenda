import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ThemeProvider } from '../theme/ThemeProvider'
import { TaskCard, type TaskCardProps } from './TaskCard'
import { asTask, NO_RECUR, type Task, type TaskDraft } from '../types/task'
import { BoardActionContext, type BoardActions } from './boardActionContext'
import { LabelDirectoryContext } from '../labels/labelDirectoryContext'
import { fakeLabelDirectory } from '../labels/fakeLabelDirectory'

function mkTask(over: Partial<TaskDraft> = {}): Task {
  return asTask({
    id: 't1',
    title: 'Card under test',
    description: '',
    labelId: 'l1',
    color: 'yellow',
    checklist: [],
    status: 'todo',
    completedAt: null,
    reopenStatus: null,
    archivedAt: null,
    day: '2026-07-10',
    order: 0,
    korder: 0,
    atTime: null,
    pinned: false,
    ...NO_RECUR,
    ...over,
  })
}

function renderCard(
  task: Task,
  props: Partial<TaskCardProps> = {},
  actions: BoardActions | null = null,
) {
  return render(
    <ThemeProvider>
      <LabelDirectoryContext.Provider value={fakeLabelDirectory()}>
        <BoardActionContext.Provider value={actions}>
          <TaskCard task={task} variant="inbox" {...props} />
        </BoardActionContext.Provider>
      </LabelDirectoryContext.Provider>
    </ThemeProvider>,
  )
}

test('shows the selected Label name and its dot color', () => {
  renderCard(mkTask({ labelId: 'l1' }))
  const name = screen.getByText('Work')
  expect(name.previousElementSibling).toHaveStyle({ background: '#2563eb' })
})

test('shows a neutral Unlabeled presentation for a null or missing Label', () => {
  const { rerender } = renderCard(mkTask({ labelId: null }))
  expect(screen.getByText('Unlabeled')).toBeInTheDocument()

  rerender(
    <ThemeProvider>
      <LabelDirectoryContext.Provider value={fakeLabelDirectory()}>
        <BoardActionContext.Provider value={null}>
          <TaskCard task={mkTask({ labelId: 'deleted-label' })} variant="inbox" />
        </BoardActionContext.Provider>
      </LabelDirectoryContext.Provider>
    </ThemeProvider>,
  )
  expect(screen.getByText('Unlabeled')).toBeInTheDocument()
})

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
  renderCard(
    mkTask({ pinned: false }),
    {},
    {
      popId: null,
      onOpen,
      onTogglePin,
      onAddDay: vi.fn(),
      onAddInbox: vi.fn(),
      onAddStatus: vi.fn(),
    },
  )
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

test('the Completion control uses Complete and Reopen product language', () => {
  const actions: BoardActions = {
    popId: null,
    onOpen: vi.fn(),
    onToggleCompletion: vi.fn(),
    onAddDay: vi.fn(),
    onAddInbox: vi.fn(),
    onAddStatus: vi.fn(),
  }
  const { rerender } = renderCard(mkTask(), {}, actions)
  expect(screen.getByRole('button', { name: 'Complete' })).toBeInTheDocument()

  rerender(
    <ThemeProvider>
      <LabelDirectoryContext.Provider value={fakeLabelDirectory()}>
        <BoardActionContext.Provider value={actions}>
          <TaskCard task={mkTask({ status: 'completed', reopenStatus: 'todo' })} variant="inbox" />
        </BoardActionContext.Provider>
      </LabelDirectoryContext.Provider>
    </ThemeProvider>,
  )
  expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument()
})
