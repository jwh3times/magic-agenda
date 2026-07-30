import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { ThemeProvider } from '../theme/ThemeProvider'
import { Board } from './Board'
import { applyToggleDone } from '../data/selectors'
import { makeMockTasks } from '../data/mockTasks'
import { OfflineContext } from '../data/offlineContext'
import { TodayContext } from '../data/todayContext'
import type { Task } from '../types/task'

// Mimics BoardPage's data ownership with local state (no Supabase) so Board stays hermetic.
// MemoryRouter is here because the inbox foot links to /privacy and /terms (ROADMAP 5.3); Board
// still owns no data and touches no network.
function Harness({ weekStart }: { weekStart?: number }) {
  const [tasks, setTasks] = useState<Task[]>(makeMockTasks)
  return (
    <MemoryRouter>
      <ThemeProvider>
        <Board
          tasks={tasks}
          setTasks={setTasks}
          onCreate={(t) => setTasks((p) => [...p, t])}
          onUpdate={(t) => setTasks((p) => p.map((x) => (x.id === t.id ? t : x)))}
          onDelete={(id) => setTasks((p) => p.filter((x) => x.id !== id))}
          onToggleDone={(id) => setTasks((p) => applyToggleDone(p, id).tasks)}
          persistReorder={(next) => setTasks(next)}
          getTemplate={() => undefined}
          updateSeries={() => {}}
          deleteOccurrence={() => {}}
          deleteSeriesFuture={() => {}}
          weekStart={weekStart}
        />
      </ThemeProvider>
    </MemoryRouter>
  )
}

const renderBoard = () => render(<Harness />)

const renderOffline = () =>
  render(
    <OfflineContext.Provider
      value={{ readOnly: true, savedAt: Date.parse('2026-07-27T12:41:00Z') }}
    >
      <Harness />
    </OfflineContext.Provider>,
  )

// DndContext always mounts its own hidden `role="status"` live region (dnd-kit's screen-reader
// drag announcer, @dnd-kit/accessibility's LiveRegion) regardless of drag activity or offline
// state — it renders with empty text content until a drag actually fires an announcement. So
// `getByRole('status')` alone is ambiguous (matches both it and the OfflineBanner); scope to the
// one with non-empty text to find the banner specifically.
const visibleStatus = () => screen.queryAllByRole('status').find((el) => el.textContent?.trim())

test('offline shows a banner naming when the board was saved', () => {
  renderOffline()
  expect(visibleStatus()).toHaveTextContent(/offline/i)
})

test('offline disables the add-task affordance', () => {
  renderOffline()
  expect(screen.getByRole('button', { name: '+ New task' })).toBeDisabled()
})

// dnd-kit's useDraggable/useSortable puts `aria-disabled` on the SortableCard wrapper (role
// "button") straight from the `disabled` option passed in, so this is an observable proxy for
// "drag is off" without simulating an actual pointer drag.
test('offline disables drag via the DragDisabledContext', () => {
  renderOffline()
  const card = screen.getByText('Renew passport').closest('[role="button"]')
  expect(card).toHaveAttribute('aria-disabled', 'true')
})

// TaskCard renders the pin/done toggles as plain <button>s only when handed a handler, falling
// back to a non-interactive <span> otherwise (see TaskCard.tsx) — this is the same mechanism
// the drag test above relies on, applied to the two per-card mutation affordances the brief
// missed (a coordinator-flagged Critical: neither was gated on readOnly).
test('offline disables the per-card done and pin toggles', () => {
  renderOffline()
  const card = screen.getByText('Renew passport').closest('[role="button"]') as HTMLElement
  expect(within(card).queryByRole('button', { name: 'Pin' })).not.toBeInTheDocument()
  expect(within(card).queryByRole('button', { name: 'Mark done' })).not.toBeInTheDocument()
})

test('online keeps the per-card done and pin toggles interactive', () => {
  renderBoard()
  const card = screen.getByText('Renew passport').closest('[role="button"]') as HTMLElement
  expect(within(card).getByRole('button', { name: 'Pin' })).toBeEnabled()
  expect(within(card).getByRole('button', { name: 'Mark done' })).toBeEnabled()
})

test('online leaves the board fully interactive', () => {
  renderBoard()
  expect(visibleStatus()).toBeUndefined()
  expect(screen.getByRole('button', { name: '+ New task' })).toBeEnabled()
})

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

// jsdom has no matchMedia, so every other test renders the desktop layout; this one stubs a
// phone-width match to exercise the mobile branches (stacked layout, collapsible inbox).
describe('mobile layout', () => {
  afterEach(() => vi.unstubAllGlobals())

  const stubMobile = () =>
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    )

  test('renders all views and a collapsible inbox on a phone-width screen', async () => {
    stubMobile()
    const user = userEvent.setup()
    renderBoard()

    // Calendar view: board + inbox render stacked; inbox header toggles its body.
    expect(screen.getByText('Finish Q3 deck')).toBeInTheDocument()
    expect(screen.getByText('Renew passport')).toBeInTheDocument()
    await user.click(screen.getByText('Inbox'))
    expect(screen.queryByText('Renew passport')).not.toBeInTheDocument() // collapsed
    await user.click(screen.getByText('Inbox'))
    expect(screen.getByText('Renew passport')).toBeInTheDocument() // expanded again

    await user.click(screen.getByRole('button', { name: 'Week' }))
    expect(screen.getByText('Finish Q3 deck')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Board' }))
    expect(screen.getByText('In Progress', { selector: 'span' })).toBeInTheDocument()
  })
})

test('mounts on the view stored in sessionStorage', () => {
  sessionStorage.setItem('ma-board-view', 'kanban')
  renderBoard()
  // Kanban shows the status columns; calendar/week show the Inbox instead.
  expect(screen.getByText('To Do', { selector: 'span' })).toBeInTheDocument()
})

test('switching views remembers the choice per tab', async () => {
  const user = userEvent.setup()
  renderBoard()
  await user.click(screen.getByRole('button', { name: 'Week' }))
  expect(sessionStorage.getItem('ma-board-view')).toBe('week')
})

test('opens on the month of the configured today, not the browser clock', () => {
  localStorage.clear() // readBoardView() wins over initialView; force the calendar view.
  // `shouldAdvanceTime` so dnd-kit's and Board's own timers still fire normally under fake time.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-07-28T12:00:00Z'))
  try {
    render(
      <TodayContext.Provider value="2026-03-15">
        <Harness />
      </TodayContext.Provider>,
    )
    // The browser clock says July; the user's timezone-resolved today is in March. Asserting the
    // absence of July is the half that actually proves `new Date()` is no longer the source.
    expect(screen.getByText('March 2026')).toBeInTheDocument()
    expect(screen.queryByText('July 2026')).not.toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})

test('renders a Monday-start month grid when configured', () => {
  localStorage.clear() // same reason as the anchor test: force the calendar view.
  render(<Harness weekStart={1} />)
  const headers = screen.getAllByText(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/)
  expect(headers).toHaveLength(7)
  expect(headers[0]).toHaveTextContent('Mon')
  expect(headers[6]).toHaveTextContent('Sun')
})

test('week view highlights the cell for the configured today, not the browser clock', async () => {
  localStorage.clear() // readBoardView() wins over initialView; force the calendar view.
  // `shouldAdvanceTime` so dnd-kit's and Board's own timers still fire normally under fake time.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-07-28T12:00:00Z'))
  try {
    const user = userEvent.setup()
    render(
      <TodayContext.Provider value="2026-03-15">
        <Harness />
      </TodayContext.Provider>,
    )
    await user.click(screen.getByRole('button', { name: 'Week' }))

    // 2026-03-15 is a Sunday, so it is the first cell of its own week — the browser clock's
    // today (Jul 28, a different week entirely) never appears on screen at all, so the only way
    // this assertion can pass is if the pinned context date drove the highlight.
    const pinnedCell = screen.getByText('15')
    expect(pinnedCell).toHaveStyle({ background: 'rgba(184,71,46,.14)' })

    // None of the other six day-number cells in the week carry that highlight.
    for (const dayNum of ['16', '17', '18', '19', '20', '21']) {
      expect(screen.getByText(dayNum)).not.toHaveStyle({ background: 'rgba(184,71,46,.14)' })
    }
  } finally {
    vi.useRealTimers()
  }
})

test('the board exposes the landmarks a screen reader navigates by', () => {
  // A tag-level check for <search>, not getByRole('search'): aria-query 5.3.0 has no <search>
  // mapping, so jsdom cannot resolve the implicit landmark role (see SearchFilterBar.test.tsx for
  // the full rationale — same component, same constraint).
  const { container } = renderBoard()
  expect(screen.getByRole('banner')).toBeInTheDocument()
  expect(container.querySelector('search')).not.toBeNull()
  expect(screen.getByRole('main')).toBeInTheDocument()
  expect(screen.getByRole('complementary', { name: 'Inbox' })).toBeInTheDocument()
})
