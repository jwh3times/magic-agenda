import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { makeMockTasks } from '../data/mockTasks'
import { fakeUseTasks } from '../data/fakeUseTasks'
import { useTasks } from '../data/useTasks'

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
}))

const tasks = fakeUseTasks()

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => h.auth }))
vi.mock('../data/SettingsProvider', () => ({ useSettingsContext: () => h.settings }))
vi.mock('../data/useTasks', () => ({ useTasks: vi.fn() }))
vi.mocked(useTasks).mockImplementation(() => tasks)

import { BoardPage } from './BoardPage'

afterEach(() => {
  h.auth.user = null
  h.settings.loading = false
  Object.assign(tasks, fakeUseTasks())
})

function renderPage() {
  return render(
    <MemoryRouter>
      <BoardPage />
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
