import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { ThemeProvider } from '../theme/ThemeProvider'
import { Board } from './Board'
import { applyToggleCompletion } from '../data/selectors'
import { planBulkUpdate } from '../data/bulk'
import { makeMockTasks } from '../data/mockTasks'
import { ymd } from '../lib/dates'
import { OfflineContext } from '../data/offlineContext'
import { TodayContext } from '../data/todayContext'
import { TaskBoardContext, type TaskBoard } from '../data/taskBoardContext'
import { asTask, type Task, type ViewName } from '../types/task'
import { LabelDirectoryContext } from '../labels/labelDirectoryContext'
import { MOCK_LABEL_DIRECTORY } from '../data/mockLabels'

// Mimics BoardPage's data ownership with local state (no Supabase) so Board stays hermetic.
// MemoryRouter is here because the inbox foot links to /privacy and /terms (ROADMAP 5.3); Board
// still owns no data and touches no network.
function Harness({
  weekStart,
  initialView,
  canAssignLabels,
  seed,
  keyboardShortcuts,
  bulkFails = false,
}: {
  weekStart?: number
  initialView?: ViewName
  canAssignLabels?: boolean
  seed?: Task[]
  keyboardShortcuts?: boolean
  /** The data layer refused or rolled back every bulk write. */
  bulkFails?: boolean
}) {
  const [tasks, setTasks] = useState<Task[]>(() => seed ?? makeMockTasks())
  const taskBoard: TaskBoard = {
    tasks,
    previewReorder: setTasks,
    persistReorder: setTasks,
    // This in-memory adapter applies the scope-free cases only; recurrence dispatch is tested
    // directly through resolveSave/resolveDelete in src/data/series.test.ts.
    saveTask: (_orig, draft, isNew) => {
      // The editor hands back a flat draft; the board holds real Tasks.
      const saved = asTask(draft)
      setTasks((prev) =>
        isNew ? [...prev, saved] : prev.map((task) => (task.id === saved.id ? saved : task)),
      )
    },
    updateTask: (task) =>
      setTasks((prev) => prev.map((current) => (current.id === task.id ? task : current))),
    deleteTask: (id) => setTasks((prev) => prev.filter((task) => task.id !== id)),
    toggleCompletion: (id) =>
      setTasks((prev) => applyToggleCompletion(prev, id, '2026-09-03T15:00:00.000Z').tasks),
    rollForward: () => {},
    // Plain Tasks only, like saveTask above; Series bulk semantics are tested in series.test.ts.
    bulkUpdate: (ids, change) => {
      if (bulkFails) return false
      setTasks((prev) => planBulkUpdate(prev, ids, change, '2026-09-03T15:00:00.000Z').tasks)
      return true
    },
    bulkDelete: (ids) => {
      if (bulkFails) return false
      setTasks((prev) => prev.filter((task) => !ids.has(task.id)))
      return true
    },
    getTemplate: () => undefined,
  }
  return (
    <MemoryRouter>
      <ThemeProvider>
        <LabelDirectoryContext.Provider value={MOCK_LABEL_DIRECTORY}>
          <TaskBoardContext.Provider value={taskBoard}>
            <Board
              weekStart={weekStart}
              initialView={initialView}
              canAssignLabels={canAssignLabels}
              keyboardShortcuts={keyboardShortcuts}
            />
          </TaskBoardContext.Provider>
        </LabelDirectoryContext.Provider>
      </ThemeProvider>
    </MemoryRouter>
  )
}

const renderBoard = () => render(<Harness />)

const renderOffline = () =>
  render(
    <OfflineContext.Provider
      value={{
        readOnly: true,
        fallbackReason: 'network',
        savedAt: Date.parse('2026-07-27T12:41:00Z'),
        timezone: null,
      }}
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

// TaskCard renders the Pin and Completion controls as buttons only when handed handlers, falling
// back to a non-interactive <span> otherwise (see TaskCard.tsx) — this is the same mechanism
// the drag test above relies on, applied to the two per-card mutation affordances the brief
// missed (a coordinator-flagged Critical: neither was gated on readOnly).
test('offline disables the per-card Completion and Pin controls', () => {
  renderOffline()
  const card = screen.getByText('Renew passport').closest('[role="button"]') as HTMLElement
  expect(within(card).queryByRole('button', { name: 'Pin' })).not.toBeInTheDocument()
  expect(within(card).queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument()
})

test('online keeps the per-card Completion and Pin controls interactive', () => {
  renderBoard()
  const card = screen.getByText('Renew passport').closest('[role="button"]') as HTMLElement
  expect(within(card).getByRole('button', { name: 'Pin' })).toBeEnabled()
  expect(within(card).getByRole('button', { name: 'Complete' })).toBeEnabled()
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

  // Workflow Status words also appear in the filter dropdown, so scope to the column spans.
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

test('new tasks start Unlabeled', async () => {
  const user = userEvent.setup()
  renderBoard()
  await user.click(screen.getByRole('button', { name: '+ New task' }))
  expect(screen.getByRole('button', { name: 'Unlabeled' })).toHaveAttribute('aria-pressed', 'true')
})

test('the Board’s assignLabels capability gates editor Label controls', async () => {
  const user = userEvent.setup()
  render(<Harness canAssignLabels={false} />)
  await user.click(screen.getByRole('button', { name: '+ New task' }))
  expect(screen.getByRole('button', { name: 'Unlabeled' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Work' })).toBeDisabled()
})

test('clicking a card opens the editor prefilled', async () => {
  const user = userEvent.setup()
  renderBoard()

  await user.click(screen.getByText('Finish Q3 deck'))
  expect(screen.getByDisplayValue('Finish Q3 deck')).toBeInTheDocument()
  expect(screen.getByText('Edit task')).toBeInTheDocument()
})

// ——— keyboard access to the editor (#281) ———
// Before this, a card's only tab stop answered Space AND Enter, both claimed by dnd-kit's
// KeyboardSensor — so a keyboard user could reorder the whole board and never open a task. The
// pointer path is TaskCard's onClick, which a keyboard never reaches.

const cardFor = (title: string) => screen.getByText(title).closest('[role="button"]') as HTMLElement

test('Enter on a focused card opens the editor', async () => {
  const user = userEvent.setup()
  renderBoard()

  cardFor('Finish Q3 deck').focus()
  await user.keyboard('{Enter}')

  expect(screen.getByDisplayValue('Finish Q3 deck')).toBeInTheDocument()
  expect(screen.getByText('Edit task')).toBeInTheDocument()
})

test('Space is left to the drag sensor and does not open the editor', async () => {
  // The two actions share one tab stop, so the split only works if each key keeps its own job.
  const user = userEvent.setup()
  renderBoard()

  cardFor('Finish Q3 deck').focus()
  await user.keyboard('[Space]')

  expect(screen.queryByText('Edit task')).not.toBeInTheDocument()
})

test('Enter aimed at a nested card control does not also open the editor', async () => {
  // The pin and completion buttons sit inside the focusable card, so their keydown bubbles to it.
  // Without the target guard, every Enter on a nested control would fire two actions at once — the
  // button's own, and the editor on top of it.
  //
  // Asserted as "the editor stayed shut" rather than "the task got pinned" on purpose: jsdom does
  // not synthesise the click a real browser fires for Enter on a <button>, so the pin half is not
  // observable here. The bubbling half — the part the guard exists for — is, because keydown
  // bubbles either way.
  const user = userEvent.setup()
  renderBoard()

  for (const name of ['Pin', 'Complete']) {
    within(cardFor('Finish Q3 deck')).getByRole('button', { name }).focus()
    await user.keyboard('{Enter}')
    expect(screen.queryByText('Edit task')).not.toBeInTheDocument()
  }
})

test('Enter dropping a card mid-drag does not also open the editor', async () => {
  // Enter is still a DROP key (KEYBOARD_CODES.end), so dropping a card must not also open it.
  //
  // This asserts the OUTCOME, not the mechanism, and the distinction is worth stating: under jsdom
  // the drop Enter never reaches SortableCard's handler at all, because starting a keyboard drag
  // moves focus away from the card. The `isDragging` clause that would catch it otherwise is
  // therefore NOT exercised here — removing it leaves this test green. It stays in the source
  // because jsdom's focus behaviour is not a promise about real browsers.
  const user = userEvent.setup()
  renderBoard()

  cardFor('Finish Q3 deck').focus()
  await user.keyboard('[Space]')
  await user.keyboard('{Enter}')

  expect(screen.queryByText('Edit task')).not.toBeInTheDocument()
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
  render(<Harness initialView="week" />)
  // Kanban shows the status columns; calendar/week show the Inbox instead.
  expect(screen.getByText('To Do', { selector: 'span' })).toBeInTheDocument()
})

test('uses the configured default view when this tab has no stored choice', () => {
  sessionStorage.removeItem('ma-board-view')
  render(<Harness initialView="agenda" />)
  expect(screen.getByText('Unscheduled · Inbox')).toBeInTheDocument()
})

test('switching views remembers the choice per tab', async () => {
  const user = userEvent.setup()
  renderBoard()
  await user.click(screen.getByRole('button', { name: 'Week' }))
  expect(sessionStorage.getItem('ma-board-view')).toBe('week')
})

test('opens on the month of the configured today, not the browser clock', () => {
  sessionStorage.removeItem('ma-board-view')
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
  sessionStorage.removeItem('ma-board-view')
  render(<Harness weekStart={1} />)
  const headers = screen.getAllByText(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/)
  expect(headers).toHaveLength(7)
  expect(headers[0]).toHaveTextContent('Mon')
  expect(headers[6]).toHaveTextContent('Sun')
})

test('week view highlights the cell for the configured today, not the browser clock', async () => {
  sessionStorage.removeItem('ma-board-view')
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

describe('Archived Tasks are absent from every ordinary Board view', () => {
  // Scheduled today so the card falls inside every view's window — calendar month, week, agenda,
  // and the Completed kanban column — which is what makes the positive control below meaningful.
  const completedToday = (archivedAt: string | null): Task[] => [
    ...makeMockTasks(),
    asTask({
      ...makeMockTasks()[0],
      id: 'archive-probe',
      title: 'Archived chore',
      day: ymd(new Date()),
      status: 'completed',
      completedAt: '2026-09-03T15:00:00.000Z',
      reopenStatus: 'todo',
      archivedAt,
      recurFreq: 'none',
      recurUntil: null,
      recurParentId: null,
      occurrenceDate: null,
    }),
  ]
  const views: ViewName[] = ['calendar', 'week', 'agenda', 'kanban']

  test.each(views)('%s view shows a Completed Task but hides it once Archived', (view) => {
    // Positive control first: without it, a view that never rendered Completed cards at all
    // would make the absence assertion pass for the wrong reason.
    const { unmount } = render(<Harness initialView={view} seed={completedToday(null)} />)
    expect(screen.getByText('Archived chore')).toBeInTheDocument()
    unmount()

    render(<Harness initialView={view} seed={completedToday('2026-09-04T08:00:00.000Z')} />)
    expect(screen.queryByText('Archived chore')).not.toBeInTheDocument()
  })

  test('search never surfaces an Archived Task', async () => {
    const user = userEvent.setup()
    render(<Harness seed={completedToday('2026-09-04T08:00:00.000Z')} />)
    await user.type(screen.getByPlaceholderText('Search tasks…'), 'Archived chore')
    expect(screen.queryByText('Archived chore')).not.toBeInTheDocument()
  })
})

describe('keyboard shortcuts and the command palette (#269)', () => {
  const palette = () => screen.queryByRole('dialog', { name: 'Command palette' })
  const editorTitle = () => screen.queryByPlaceholderText('Task title…')

  test('Ctrl+K opens the command palette', async () => {
    const user = userEvent.setup()
    renderBoard()
    expect(palette()).not.toBeInTheDocument()
    await user.keyboard('{Control>}k{/Control}')
    expect(palette()).toBeInTheDocument()
  })

  test('n opens a new task, but not while typing in the search field', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.click(screen.getByPlaceholderText('Search tasks…'))
    await user.keyboard('n')
    expect(editorTitle()).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search tasks…')).toHaveValue('n')

    await user.click(document.body)
    await user.keyboard('n')
    expect(editorTitle()).toBeInTheDocument()
  })

  test('with shortcuts turned off, letters do nothing but Ctrl+K still opens the palette', async () => {
    const user = userEvent.setup()
    render(<Harness keyboardShortcuts={false} />)
    await user.keyboard('n?')
    expect(editorTitle()).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument()
    await user.keyboard('{Control>}k{/Control}')
    expect(palette()).toBeInTheDocument()
  })

  test('number keys switch views', async () => {
    const user = userEvent.setup()
    sessionStorage.removeItem('ma-board-view')
    renderBoard()
    await user.keyboard('2')
    expect(sessionStorage.getItem('ma-board-view')).toBe('week')
    await user.keyboard('4')
    expect(screen.getByText('To Do', { selector: 'span' })).toBeInTheDocument()
    sessionStorage.removeItem('ma-board-view')
  })

  test('/ focuses the search field without typing a slash into it', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.keyboard('/')
    const search = screen.getByPlaceholderText('Search tasks…')
    expect(search).toHaveFocus()
    expect(search).toHaveValue('')
  })

  test('? opens the keyboard shortcuts overlay', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.keyboard('?')
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
  })

  test('quick-add from the palette creates the task immediately and says where it went', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('Water the ferns tomorrow{Enter}')
    expect(palette()).not.toBeInTheDocument()
    expect(screen.getByText('Water the ferns')).toBeInTheDocument()
    expect(screen.getByText(/^Added “Water the ferns” to /)).toBeInTheDocument()
  })

  test('no shortcut fires while the task editor is open, not even Ctrl+K', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.keyboard('n')
    expect(editorTitle()).toBeInTheDocument()
    await user.keyboard('{Control>}k{/Control}')
    expect(palette()).not.toBeInTheDocument()
  })

  test('a read-only board offers neither New task nor quick-add in the palette', async () => {
    const user = userEvent.setup()
    renderOffline()
    await user.keyboard('{Control>}k{/Control}')
    expect(screen.queryByRole('option', { name: 'New task' })).not.toBeInTheDocument()
    await user.keyboard('groceries')
    expect(screen.queryByRole('option', { name: /^Add task/ })).not.toBeInTheDocument()
  })
})

// ——— bulk multi-select (#270) ———

describe('selection mode', () => {
  const toolbar = () => screen.getByRole('toolbar', { name: 'Bulk actions' })

  test('Ctrl-click selects a card instead of opening it, and enters selection mode', async () => {
    const user = userEvent.setup()
    renderBoard()

    await user.keyboard('{Control>}')
    await user.click(screen.getByText('Finish Q3 deck'))
    await user.keyboard('{/Control}')

    expect(screen.queryByText('Edit task')).not.toBeInTheDocument()
    expect(cardFor('Finish Q3 deck')).toHaveAttribute('aria-pressed', 'true')
    expect(within(toolbar()).getByText('1 selected')).toBeInTheDocument()
  })

  test('the Select toggle makes plain clicks and Enter toggle selection, and disables drag', async () => {
    const user = userEvent.setup()
    renderBoard()

    await user.click(screen.getByRole('button', { name: '☑ Select' }))
    expect(within(toolbar()).getByText('0 selected')).toBeInTheDocument()
    expect(within(toolbar()).getByRole('button', { name: 'Delete' })).toBeDisabled()
    // Drag is off while selecting, but the card is an available toggle, so it must not be
    // announced as a disabled button (dnd-kit's own aria-disabled is overridden here).
    expect(cardFor('Call plumber')).not.toHaveAttribute('aria-disabled', 'true')
    expect(cardFor('Call plumber')).toHaveAttribute('aria-pressed', 'false')

    await user.click(screen.getByText('Call plumber'))
    cardFor('Pay rent').focus()
    await user.keyboard('{Enter}')
    expect(screen.queryByText('Edit task')).not.toBeInTheDocument()
    expect(within(toolbar()).getByText('2 selected')).toBeInTheDocument()

    // Toggling again deselects.
    await user.click(screen.getByText('Call plumber'))
    expect(within(toolbar()).getByText('1 selected')).toBeInTheDocument()
  })

  test('Move sends the selection to the Inbox and says so', async () => {
    const user = userEvent.setup()
    renderBoard()
    const inbox = screen.getByRole('complementary')
    expect(within(inbox).queryByText('Call plumber')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '☑ Select' }))
    await user.click(screen.getByText('Call plumber'))
    await user.click(screen.getByText('Pay rent'))
    await user.click(within(toolbar()).getByRole('button', { name: 'To Inbox' }))

    expect(within(inbox).getByText('Call plumber')).toBeInTheDocument()
    expect(within(inbox).getByText('Pay rent')).toBeInTheDocument()
    expect(await screen.findByText('Moved 2 tasks to Inbox')).toBeInTheDocument()
    // The selection survives an update, so actions can be chained.
    expect(within(toolbar()).getByText('2 selected')).toBeInTheDocument()
  })

  test('status applies to every selected card and counts only the cards it changed', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.click(screen.getByRole('button', { name: '☑ Select' }))
    await user.click(screen.getByText('Call plumber'))
    await user.click(screen.getByText('Pay rent'))

    // "Pay rent" is already Completed in the seed board.
    await user.selectOptions(within(toolbar()).getByLabelText('Set status'), 'completed')
    expect(await screen.findByText('Set 1 task to Completed')).toBeInTheDocument()
    for (const title of ['Call plumber', 'Pay rent']) {
      expect(within(cardFor(title)).getByRole('button', { name: 'Reopen' })).toBeInTheDocument()
    }
  })

  test('delete asks for confirmation, removes the selection, and leaves selection mode', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.click(screen.getByRole('button', { name: '☑ Select' }))
    await user.click(screen.getByText('Call plumber'))
    await user.click(screen.getByText('Pay rent'))

    await user.click(within(toolbar()).getByRole('button', { name: 'Delete' }))
    expect(within(toolbar()).getByText('Delete 2 tasks?')).toBeInTheDocument()
    await user.click(within(toolbar()).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Call plumber')).toBeInTheDocument()

    await user.click(within(toolbar()).getByRole('button', { name: 'Delete' }))
    await user.click(within(toolbar()).getByRole('button', { name: 'Confirm delete' }))
    expect(screen.queryByText('Call plumber')).not.toBeInTheDocument()
    expect(screen.queryByText('Pay rent')).not.toBeInTheDocument()
    expect(await screen.findByText('Deleted 2 tasks')).toBeInTheDocument()
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument()
  })

  test('Escape while confirming a delete cancels the confirmation, not the selection', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.click(screen.getByRole('button', { name: '☑ Select' }))
    await user.click(screen.getByText('Call plumber'))
    await user.click(within(toolbar()).getByRole('button', { name: 'Delete' }))
    await user.keyboard('{Escape}')
    expect(within(toolbar()).queryByText('Delete 1 task?')).not.toBeInTheDocument()
    expect(within(toolbar()).getByText('1 selected')).toBeInTheDocument()
  })

  test('a refused bulk write announces nothing and keeps the selection', async () => {
    const user = userEvent.setup()
    render(<Harness bulkFails />)
    await user.click(screen.getByRole('button', { name: '☑ Select' }))
    await user.click(screen.getByText('Call plumber'))

    await user.click(within(toolbar()).getByRole('button', { name: 'To Inbox' }))
    await user.click(within(toolbar()).getByRole('button', { name: 'Delete' }))
    await user.click(within(toolbar()).getByRole('button', { name: 'Confirm delete' }))

    expect(screen.queryByText(/^Moved|^Deleted/)).not.toBeInTheDocument()
    expect(within(toolbar()).getByText('1 selected')).toBeInTheDocument()
  })

  test('Escape in the search field is left to the field', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.click(screen.getByRole('button', { name: '☑ Select' }))
    await user.click(screen.getByLabelText('Search tasks'))
    await user.keyboard('{Escape}')
    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).toBeInTheDocument()
  })

  test('Escape and Done leave selection mode and clear the selection', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.click(screen.getByRole('button', { name: '☑ Select' }))
    await user.click(screen.getByText('Call plumber'))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument()
    expect(cardFor('Call plumber')).not.toHaveAttribute('aria-pressed')

    await user.click(screen.getByRole('button', { name: '☑ Select' }))
    expect(within(toolbar()).getByText('0 selected')).toBeInTheDocument()
    await user.click(within(toolbar()).getByRole('button', { name: 'Done' }))
    // A plain click opens the editor again.
    await user.click(screen.getByText('Call plumber'))
    expect(screen.getByText('Edit task')).toBeInTheDocument()
  })

  test('a card hidden by search is dropped from the selection', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.click(screen.getByRole('button', { name: '☑ Select' }))
    await user.click(screen.getByText('Call plumber'))
    await user.click(screen.getByText('Pay rent'))
    await user.type(screen.getByLabelText('Search tasks'), 'plumber')
    expect(within(toolbar()).getByText('1 selected')).toBeInTheDocument()
  })

  test('a read-only board offers no selection at all', async () => {
    const user = userEvent.setup()
    renderOffline()
    expect(screen.queryByRole('button', { name: '☑ Select' })).not.toBeInTheDocument()
    await user.keyboard('{Control>}')
    await user.click(screen.getByText('Renew passport'))
    await user.keyboard('{/Control}')
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument()
  })
})
