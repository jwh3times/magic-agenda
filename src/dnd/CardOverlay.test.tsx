import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { ThemeProvider } from '../theme/ThemeProvider'
import { LabelDirectoryContext } from '../labels/labelDirectoryContext'
import { fakeLabelDirectory } from '../labels/fakeLabelDirectory'
import { NO_RECUR, type Task } from '../types/task'
import { CardOverlay } from './CardOverlay'

const task = (labelId: string | null): Task => ({
  id: 't1',
  title: 'Dragged task',
  description: '',
  labelId,
  assigneeId: null,
  color: 'yellow',
  checklist: [],
  status: 'todo',
  completedAt: null,
  reopenStatus: 'todo',
  archivedAt: null,
  day: 'inbox',
  atTime: null,
  pinned: false,
  order: 0,
  korder: 0,
  ...NO_RECUR,
})

const renderOverlay = (labelId: string | null) =>
  render(
    <ThemeProvider>
      <LabelDirectoryContext.Provider value={fakeLabelDirectory()}>
        <CardOverlay task={task(labelId)} />
      </LabelDirectoryContext.Provider>
    </ThemeProvider>,
  )

test('the drag overlay uses the same Label presentation as cards', () => {
  renderOverlay('l1')
  expect(screen.getByText('Work')).toBeInTheDocument()
})

test('the drag overlay renders Unlabeled for a null assignment', () => {
  renderOverlay(null)
  expect(screen.getByText('Unlabeled')).toBeInTheDocument()
})

const renderToward = (target?: string) =>
  render(
    <ThemeProvider>
      <LabelDirectoryContext.Provider value={fakeLabelDirectory()}>
        <CardOverlay task={task('l1')} compact target={target} />
      </LabelDirectoryContext.Provider>
    </ThemeProvider>,
  )

test('the compact overlay says where the Task will land while it is over a target', () => {
  renderToward('Tue 10 Nov')
  expect(screen.getByText('→ Tue 10 Nov')).toBeInTheDocument()
  expect(screen.getByText('Dragged task')).toBeInTheDocument()
  expect(screen.queryByText('Work')).not.toBeInTheDocument()
})

test('the compact overlay keeps its Label over anything else', () => {
  renderToward(undefined)
  expect(screen.getByText('Work')).toBeInTheDocument()
  expect(screen.queryByText(/→/)).not.toBeInTheDocument()
})
