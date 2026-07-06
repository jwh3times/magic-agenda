import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ThemeProvider } from '../theme/ThemeProvider'
import { AgendaView } from './AgendaView'
import { ymd, addDays } from '../lib/dates'
import { NO_RECUR, type Task } from '../types/task'
import type { BoardHandlers } from './boardHandlers'

// Local factory — do NOT import from TaskCard.test.tsx (importing a test file
// registers and re-runs its tests inside this suite too).
function mkTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'T',
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

const handlers: BoardHandlers = {
  onOpen: vi.fn(),
  onToggleDone: vi.fn(),
  onTogglePin: vi.fn(),
  onAddDay: vi.fn(),
  onAddInbox: vi.fn(),
  onAddStatus: vi.fn(),
}

test('overdue tasks appear once, in a top Overdue group with a roll-forward button', async () => {
  const yesterday = ymd(addDays(new Date(), -1))
  const onRollForward = vi.fn()
  render(
    <ThemeProvider>
      <AgendaView
        tasks={[mkTask({ id: 'late', title: 'Late thing', day: yesterday })]}
        handlers={handlers}
        pop={null}
        onRollForward={onRollForward}
      />
    </ThemeProvider>,
  )
  expect(screen.getByText('Overdue')).toBeInTheDocument()
  expect(screen.getAllByText('Late thing')).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Move all to today' }))
  expect(onRollForward).toHaveBeenCalledTimes(1)
})
