import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { asTask, NO_RECUR, type Task, type TaskDraft } from '../types/task'
import { isOverdue } from './dueMoment'
import { DueClockProvider } from './DueClockProvider'
import { useDueClock } from './dueClockContext'

function task(over: Partial<TaskDraft> = {}): Task {
  return asTask({
    id: 'task-1',
    title: 'Task',
    description: '',
    labelId: null,
    color: 'yellow',
    checklist: [],
    status: 'todo',
    completedAt: null,
    reopenStatus: 'todo',
    archivedAt: null,
    day: '2026-07-10',
    atTime: '09:00',
    pinned: false,
    order: 0,
    korder: 0,
    ...NO_RECUR,
    ...over,
  })
}

function Probe({ task }: { task: Task }) {
  const { nowMs, timezone } = useDueClock()
  return <span>{isOverdue(task, nowMs, timezone) ? 'Overdue' : 'Not overdue'}</span>
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-10T08:59:59.999Z'))
})

afterEach(() => vi.useRealTimers())

test('refreshes derived state at the exact next Due Moment boundary', async () => {
  const timed = task()
  render(
    <DueClockProvider tasks={[timed]} timezone="UTC">
      <Probe task={timed} />
    </DueClockProvider>,
  )
  expect(screen.getByText('Not overdue')).toBeInTheDocument()

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2)
  })
  expect(screen.getByText('Overdue')).toBeInTheDocument()
})

test('catches up immediately when a sleeping tab becomes visible', () => {
  const timed = task()
  render(
    <DueClockProvider tasks={[timed]} timezone="UTC">
      <Probe task={timed} />
    </DueClockProvider>,
  )

  act(() => {
    vi.setSystemTime(new Date('2026-07-10T10:00:00.000Z'))
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(screen.getByText('Overdue')).toBeInTheDocument()
})

test('uses the current clock immediately when Tasks or Timezone change', () => {
  const timed = task()
  const { rerender } = render(
    <DueClockProvider tasks={[]} timezone="UTC">
      <Probe task={timed} />
    </DueClockProvider>,
  )
  expect(screen.getByText('Not overdue')).toBeInTheDocument()

  act(() => {
    vi.setSystemTime(new Date('2026-07-10T10:00:00.000Z'))
  })
  rerender(
    <DueClockProvider tasks={[timed]} timezone="UTC">
      <Probe task={timed} />
    </DueClockProvider>,
  )
  expect(screen.getByText('Overdue')).toBeInTheDocument()
})

test('refreshes immediately when a fixed Account Timezone changes', () => {
  vi.setSystemTime(new Date('2026-07-10T10:00:00.000Z'))
  const timed = task()
  const { rerender } = render(
    <DueClockProvider tasks={[timed]} timezone="America/Los_Angeles">
      <Probe task={timed} />
    </DueClockProvider>,
  )
  expect(screen.getByText('Not overdue')).toBeInTheDocument()

  rerender(
    <DueClockProvider tasks={[timed]} timezone="UTC">
      <Probe task={timed} />
    </DueClockProvider>,
  )
  expect(screen.getByText('Overdue')).toBeInTheDocument()
})
