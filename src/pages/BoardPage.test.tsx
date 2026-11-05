import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { makeMockTasks } from '../data/mockTasks'
import { fakeUseTasks } from '../data/fakeUseTasks'
import { fakeBoardDirectory, fakeBoardSession, fakeBoardSummary } from '../board/fakeBoardDirectory'
import { useTasks } from '../data/useTasks'
import type { UseBoardDirectory } from '../board/useBoardDirectory'
import { LabelDirectoryContext } from '../labels/labelDirectoryContext'
import { fakeLabelDirectory } from '../labels/fakeLabelDirectory'

// Mocks the three data sources BoardPage composes, so this test can drive the offline-boot
// scenario (no session, board hydrated from a snapshot) without dragging in Supabase or dnd-kit
// setup beyond what Board itself already needs.
interface MockSettings {
  settings: { theme: string; defaultView: string } | null
  loading: boolean
  saveTheme: ReturnType<typeof vi.fn>
}

const h = vi.hoisted<{
  auth: { user: { id: string } | null; signOut: ReturnType<typeof vi.fn> }
  settings: MockSettings
  role: 'owner' | 'editor' | 'viewer'
  /** null keeps the default one-Board directory; [] drives the zero-Board state. */
  boards: unknown[] | null
  /** A Board lost while open (#439). */
  lostAccess: string | null
  /** Extra directory fields for the zero-Board state: a failed load's `error`, `offline`, `reload`. */
  directory: Partial<UseBoardDirectory>
}>(() => ({
  auth: {
    user: null as { id: string } | null,
    signOut: vi.fn(),
  },
  settings: {
    settings: { theme: 'cork', defaultView: 'calendar' },
    loading: false,
    saveTheme: vi.fn(),
  },
  role: 'owner',
  boards: null,
  lostAccess: null,
  directory: {},
}))

const tasks = fakeUseTasks()
const labels = fakeLabelDirectory()

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => h.auth }))
vi.mock('../data/SettingsProvider', () => ({ useSettingsContext: () => h.settings }))
vi.mock('../board/BoardDirectoryProvider', () => ({
  useBoardDirectoryContext: () =>
    h.boards === null
      ? fakeBoardDirectory({ lostAccess: h.lostAccess })
      : fakeBoardDirectory({
          boards: h.boards as never,
          selectedBoardId: null,
          lostAccess: h.lostAccess,
          ...h.directory,
        }),
  useBoardSession: () => fakeBoardSession(fakeBoardSummary({ role: h.role })),
}))
vi.mock('../data/useTasks', () => ({ useTasks: vi.fn() }))
vi.mocked(useTasks).mockImplementation(() => tasks)

import { BoardPage } from './BoardPage'

afterEach(() => {
  h.auth.user = null
  h.settings.loading = false
  h.role = 'owner'
  h.boards = null
  h.lostAccess = null
  h.directory = {}
  Object.assign(tasks, fakeUseTasks())
  Object.assign(labels, fakeLabelDirectory())
})

function renderPage() {
  return render(
    <MemoryRouter>
      <LabelDirectoryContext.Provider value={labels}>
        <BoardPage />
      </LabelDirectoryContext.Provider>
    </MemoryRouter>,
  )
}

test('renders the offline board instead of spinning forever when there is no session', () => {
  // The offline-boot scenario ProtectedRoute now allows through: no session (so `user` is
  // null), but AuthProvider mirrored the last signed-in id before going offline, and useTasks
  // was able to hydrate from that user's last-known snapshot.
  localStorage.setItem('ma-last-user', 'u1')
  h.auth.user = null
  tasks.tasks = makeMockTasks()
  tasks.offline = true
  tasks.fallbackReason = 'network'
  tasks.savedAt = 1_700_000_000_000
  renderPage()
  expect(screen.getByText('Finish Q3 deck')).toBeInTheDocument()
  expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
})

test('still shows a spinner for a genuinely signed-in user still loading settings', () => {
  h.auth.user = { id: 'u1' }
  h.settings.loading = true
  renderPage()
  expect(screen.getByText('Loading…')).toBeInTheDocument()
})

test('waits for the selected Board’s Label Directory before rendering tasks', () => {
  h.auth.user = { id: 'u1' }
  tasks.tasks = makeMockTasks()
  labels.loading = true
  renderPage()
  expect(screen.getByText('Loading…')).toBeInTheDocument()
  expect(screen.queryByText('Finish Q3 deck')).not.toBeInTheDocument()
})

test('a Label snapshot makes the whole board read-only while offline', () => {
  h.auth.user = { id: 'u1' }
  tasks.tasks = makeMockTasks()
  labels.offline = true
  labels.fallbackReason = 'network'
  labels.savedAt = 1_700_000_000_000
  renderPage()
  expect(screen.getByText(/offline/i)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '+ New task' })).toBeDisabled()
})

test('an authentication failure keeps the saved board read-only without calling it offline', () => {
  h.auth.user = { id: 'u1' }
  tasks.tasks = makeMockTasks()
  tasks.offline = true
  tasks.fallbackReason = 'auth'
  tasks.error = 'JWT expired'
  tasks.savedAt = 1_700_000_000_000

  renderPage()

  expect(screen.getByText(/access couldn’t be verified/i)).toBeInTheDocument()
  expect(screen.queryByText(/^Offline\.$/i)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '+ New task' })).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent(/JWT expired/i)
})

test('a Viewer’s assignLabels capability disables Label assignment', async () => {
  h.auth.user = { id: 'u1' }
  h.role = 'viewer'
  tasks.tasks = makeMockTasks()
  renderPage()
  await userEvent.click(screen.getByText('Finish Q3 deck'))
  expect(screen.getByRole('button', { name: 'Work' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Unlabeled' })).toBeDisabled()
})

test.each(['owner', 'editor'] as const)('%s may assign Labels', async (role) => {
  h.auth.user = { id: 'u1' }
  h.role = role
  tasks.tasks = makeMockTasks()
  renderPage()
  await userEvent.click(screen.getByText('Finish Q3 deck'))
  expect(screen.getByRole('button', { name: 'Work' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Unlabeled' })).toBeEnabled()
})

test('an Account with no Boards gets the zero-Board screen, not an empty board', () => {
  // The failure this prevents is silent: `useTasks` was handed an empty board id, so it loads
  // nothing and reports no error — which renders as a board with no tasks and reads as data loss.
  // Reachable only by deleting your last Board, which is why it arrived with deletion.
  h.boards = []
  h.auth.user = { id: 'u1' }
  try {
    renderPage()
    expect(screen.getByRole('heading', { name: /No boards yet/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create board' })).toBeInTheDocument()
  } finally {
    h.boards = null
    h.auth.user = null
  }
})

test('a Board lost while open is named without saying whether it was removed or deleted (#439)', () => {
  h.boards = []
  h.lostAccess = 'Team'
  h.auth.user = { id: 'u1' }
  try {
    renderPage()
    // Losing your only Board lands on the zero-Board screen, and the notice must still appear there.
    expect(screen.getByText('You no longer have access to “Team”.')).toBeInTheDocument()
    expect(screen.queryByText(/removed|deleted/i)).toBeNull()
  } finally {
    h.boards = null
    h.lostAccess = null
    h.auth.user = null
  }
})

// #629: a failed directory load with no snapshot leaves `boards` empty, so the selection is null —
// the same shape as an Account with no Boards. Telling them apart is the directory's `error`.
test('a failed Board list load offers a retry instead of saying there are no boards (#629)', async () => {
  const reload = vi.fn(async () => {})
  h.boards = []
  h.directory = { error: 'Failed to fetch', reload }
  h.auth.user = { id: 'u1' }
  renderPage()
  expect(screen.queryByRole('heading', { name: /No boards yet/i })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Create board' })).toBeNull()
  expect(screen.getByText('Failed to fetch')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(reload).toHaveBeenCalledTimes(1)
})

test('a Board list shown from a snapshot keeps the zero-Board screen despite the load error (#629)', () => {
  // The offline fallback is unchanged: a snapshot was shown, so the error is the reason it is
  // stale, not the absence of a list.
  h.boards = []
  h.directory = { error: 'Failed to fetch', offline: true, fallbackReason: 'request-error' }
  h.auth.user = { id: 'u1' }
  renderPage()
  expect(screen.getByRole('heading', { name: /No boards yet/i })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
})
