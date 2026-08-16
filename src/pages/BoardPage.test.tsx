import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { makeMockTasks } from '../data/mockTasks'
import { fakeUseTasks } from '../data/fakeUseTasks'
import { fakeBoardDirectory, fakeBoardSession, fakeBoardSummary } from '../board/fakeBoardDirectory'
import { useTasks } from '../data/useTasks'
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
}))

const tasks = fakeUseTasks()
const labels = fakeLabelDirectory()

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => h.auth }))
vi.mock('../data/SettingsProvider', () => ({ useSettingsContext: () => h.settings }))
vi.mock('../board/BoardDirectoryProvider', () => ({
  useBoardDirectoryContext: () => fakeBoardDirectory(),
  useBoardSession: () => fakeBoardSession(fakeBoardSummary({ role: h.role })),
}))
vi.mock('../data/useTasks', () => ({ useTasks: vi.fn() }))
vi.mocked(useTasks).mockImplementation(() => tasks)

import { BoardPage } from './BoardPage'

afterEach(() => {
  h.auth.user = null
  h.settings.loading = false
  h.role = 'owner'
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
  labels.savedAt = 1_700_000_000_000
  renderPage()
  expect(screen.getByText(/offline/i)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '+ New task' })).toBeDisabled()
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
