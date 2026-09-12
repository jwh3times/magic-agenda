import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { HistorySection } from './HistorySection'
import { TodayContext } from '../data/todayContext'
import { taskToRow } from '../data/mappers'
import { fakeBoardDirectory, fakeBoardSession, fakeBoardSummary } from '../board/fakeBoardDirectory'
import { NO_RECUR, type Task } from '../types/task'
import type { BoardRole } from '../board/role'

const BOARD = 'board-1'

const h = vi.hoisted(() => ({
  role: 'owner' as BoardRole,
  rows: [] as unknown[],
  loadError: null as { message: string } | null,
  updates: [] as Record<string, unknown>[],
  updateError: null as { message: string } | null,
}))

vi.mock('../data/loadBoardTasks', () => ({
  loadBoardTasks: vi.fn(() => Promise.resolve({ data: h.rows, error: h.loadError })),
}))

// The update echoes the payload back as the "returned row", except that it stands in for the
// lifecycle trigger on the one field the trigger overrules: the first Archive instant.
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: (payload: Record<string, unknown>) => ({
        eq: () => ({
          select: () => {
            h.updates.push(payload)
            if (h.updateError) return Promise.resolve({ data: null, error: h.updateError })
            const row = payload.archived_at
              ? { ...payload, archived_at: SERVER_ARCHIVED_AT }
              : payload
            return Promise.resolve({ data: [row], error: null })
          },
        }),
      }),
    }),
  },
}))

const SERVER_ARCHIVED_AT = '2026-09-12T09:00:00.000Z'

vi.mock('../board/BoardDirectoryProvider', () => ({
  useBoardDirectoryContext: () => ({ ...fakeBoardDirectory(), selectedBoardId: BOARD }),
  useBoardSession: () => fakeBoardSession(fakeBoardSummary({ role: h.role })),
}))

vi.mock('../data/SettingsProvider', () => ({
  useSettingsContext: () => ({ settings: { theme: 'cork', weekStart: 0, timezone: 'UTC' } }),
}))

function task(overrides: Partial<Task>): Task {
  return {
    id: 'task',
    title: 'Task',
    description: '',
    labelId: null,
    color: 'yellow',
    checklist: [],
    status: 'completed',
    completedAt: '2026-09-11T12:00:00.000Z',
    reopenStatus: 'doing',
    archivedAt: null,
    day: '2026-09-11',
    atTime: null,
    pinned: false,
    order: 0,
    korder: 0,
    ...NO_RECUR,
    ...overrides,
  } as Task
}

const seed = (...tasks: Task[]) => {
  // Through the real mapper, so the section reads rows exactly as the database hands them over.
  h.rows = tasks.map((t) => ({ ...taskToRow(t, BOARD), created_at: '', updated_at: '' }))
}

const renderSection = () =>
  render(
    <TodayContext.Provider value="2026-09-12">
      <HistorySection />
    </TodayContext.Provider>,
  )

const row = async (title: string) => (await screen.findByText(title)).closest('li') as HTMLElement

beforeEach(() => {
  h.role = 'owner'
  h.loadError = null
  h.updates = []
  h.updateError = null
  seed(
    task({ id: 'active', title: 'Ship report' }),
    task({ id: 'archived', title: 'File taxes', archivedAt: '2026-09-11T18:00:00.000Z' }),
    task({
      id: 'open',
      title: 'Still open',
      status: 'todo',
      completedAt: null,
      reopenStatus: 'todo',
    }),
  )
})

test('lists every currently Completed Task, marking active versus Archived, and omits active ones', async () => {
  renderSection()
  expect(within(await row('Ship report')).getByText('Completed')).toBeInTheDocument()
  expect(within(await row('File taxes')).getByText('Archived')).toBeInTheDocument()
  expect(screen.queryByText('Still open')).not.toBeInTheDocument()
})

test('reports the streak and this week’s throughput from current state', async () => {
  renderSection()
  // Both Completions are on Sep 11; today (Sep 12) is empty, so the one-day grace keeps a 1-day run.
  expect(await screen.findByTestId('completion-streak')).toHaveTextContent('1 day')
  expect(screen.getByRole('listitem', { name: /2 completed$/ })).toBeInTheDocument()
})

test('Viewer sees History read-only', async () => {
  h.role = 'viewer'
  renderSection()
  const active = await row('Ship report')
  expect(within(active).queryByRole('button')).not.toBeInTheDocument()
  expect(within(await row('File taxes')).queryByRole('button')).not.toBeInTheDocument()
})

test.each<BoardRole>(['owner', 'editor'])(
  '%s may Archive, keeping Completion intact',
  async (role) => {
    h.role = role
    const user = userEvent.setup()
    renderSection()
    await user.click(
      within(await row('Ship report')).getByRole('button', { name: 'Archive Ship report' }),
    )

    await waitFor(() => expect(h.updates).toHaveLength(1))
    expect(h.updates[0]).toMatchObject({
      status: 'done',
      completed_at: '2026-09-11T12:00:00.000Z',
    })
    expect(h.updates[0].archived_at).not.toBeNull()
    // The row now shows the server's state, and offers the inverse control.
    const updated = await row('Ship report')
    expect(within(updated).getByText('Archived')).toBeInTheDocument()
    expect(
      within(updated).getByRole('button', { name: 'Unarchive Ship report' }),
    ).toBeInTheDocument()
  },
)

test('Unarchive keeps the Task Completed with Completed At unchanged', async () => {
  const user = userEvent.setup()
  renderSection()
  await user.click(
    within(await row('File taxes')).getByRole('button', { name: 'Unarchive File taxes' }),
  )

  await waitFor(() => expect(h.updates).toHaveLength(1))
  expect(h.updates[0]).toMatchObject({
    status: 'done',
    completed_at: '2026-09-11T12:00:00.000Z',
    archived_at: null,
  })
  expect(within(await row('File taxes')).getByText('Completed')).toBeInTheDocument()
})

test('Reopen from Archive clears Completion and Archive and restores the remembered status', async () => {
  const user = userEvent.setup()
  renderSection()
  await user.click(
    within(await row('File taxes')).getByRole('button', { name: 'Reopen File taxes' }),
  )

  await waitFor(() => expect(h.updates).toHaveLength(1))
  expect(h.updates[0]).toMatchObject({
    status: 'doing',
    completed_at: null,
    archived_at: null,
  })
  // Current state, not a ledger: a Reopened Task leaves History.
  await waitFor(() => expect(screen.queryByText('File taxes')).not.toBeInTheDocument())
})

test('a failed write leaves the row as it was and says so', async () => {
  h.updateError = { message: 'nope' }
  const user = userEvent.setup()
  renderSection()
  await user.click(
    within(await row('Ship report')).getByRole('button', { name: 'Archive Ship report' }),
  )

  expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i)
  expect(within(await row('Ship report')).getByText('Completed')).toBeInTheDocument()
})

test('a failed load says so rather than rendering an empty History', async () => {
  h.loadError = { message: 'offline' }
  renderSection()
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i)
  expect(screen.queryByText(/no completed tasks/i)).not.toBeInTheDocument()
})
