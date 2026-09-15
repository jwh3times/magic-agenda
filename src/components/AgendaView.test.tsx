import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ThemeProvider } from '../theme/ThemeProvider'
import { AgendaView } from './AgendaView'
import { ymd, addDays } from '../lib/dates'
import { asTask, NO_RECUR, type Task, type TaskDraft } from '../types/task'
import { BoardActionContext, type BoardActions } from './boardActionContext'
import { LabelDirectoryContext } from '../labels/labelDirectoryContext'
import { fakeLabelDirectory } from '../labels/fakeLabelDirectory'
import { DueClockContext } from '../data/dueClockContext'

// Local factory — do NOT import from TaskCard.test.tsx (importing a test file
// registers and re-runs its tests inside this suite too).
function mkTask(over: Partial<TaskDraft> = {}): Task {
  return asTask({
    id: 't1',
    title: 'T',
    description: '',
    labelId: null,
    color: 'yellow',
    checklist: [],
    status: 'todo',
    completedAt: null,
    reopenStatus: 'todo',
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

const actions: BoardActions = {
  popId: null,
  onOpen: vi.fn(),
  onToggleCompletion: vi.fn(),
  onTogglePin: vi.fn(),
  onAddDay: vi.fn(),
  onAddInbox: vi.fn(),
  onAddStatus: vi.fn(),
}

test('overdue tasks appear once, in a top Overdue group with a roll-forward button', async () => {
  const yesterday = ymd(addDays(new Date(), -1))
  const onRollForward = vi.fn()
  const value = { ...actions, onRollForward }
  render(
    <ThemeProvider>
      <LabelDirectoryContext.Provider value={fakeLabelDirectory()}>
        <BoardActionContext.Provider value={value}>
          <AgendaView tasks={[mkTask({ id: 'late', title: 'Late thing', day: yesterday })]} />
        </BoardActionContext.Provider>
      </LabelDirectoryContext.Provider>
    </ThemeProvider>,
  )
  expect(screen.getByText('Overdue')).toBeInTheDocument()
  expect(screen.getAllByText('Late thing')).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Move all to today' }))
  expect(onRollForward).toHaveBeenCalledTimes(1)
})

test('a timed Task due earlier today is Overdue but has no roll-forward action', () => {
  render(
    <ThemeProvider>
      <LabelDirectoryContext.Provider value={fakeLabelDirectory()}>
        <DueClockContext.Provider
          value={{ nowMs: Date.parse('2026-07-10T10:00:00.000Z'), timezone: 'UTC' }}
        >
          <BoardActionContext.Provider value={actions}>
            <AgendaView tasks={[mkTask({ id: 'timed', title: 'Timed today', atTime: '09:00' })]} />
          </BoardActionContext.Provider>
        </DueClockContext.Provider>
      </LabelDirectoryContext.Provider>
    </ThemeProvider>,
  )
  expect(screen.getByText('Overdue')).toBeInTheDocument()
  expect(screen.getByText('Timed today')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Move all to today' })).not.toBeInTheDocument()
})
