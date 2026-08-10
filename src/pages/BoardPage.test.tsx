import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { makeMockTasks } from '../data/mockTasks'
import type { Task } from '../types/task'

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
  tasks: {
    tasks: Task[]
    loading: boolean
    error: string | null
    clearError: ReturnType<typeof vi.fn>
    reload: ReturnType<typeof vi.fn>
    setTasks: ReturnType<typeof vi.fn>
    createTask: ReturnType<typeof vi.fn>
    updateTask: ReturnType<typeof vi.fn>
    removeTask: ReturnType<typeof vi.fn>
    toggleDone: ReturnType<typeof vi.fn>
    persistReorder: ReturnType<typeof vi.fn>
    rollForward: ReturnType<typeof vi.fn>
    getTemplate: ReturnType<typeof vi.fn>
    updateSeries: ReturnType<typeof vi.fn>
    deleteOccurrence: ReturnType<typeof vi.fn>
    deleteSeriesFuture: ReturnType<typeof vi.fn>
    offline: boolean
    savedAt: number | null
  }
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
  tasks: {
    tasks: [] as Task[],
    loading: false,
    error: null as string | null,
    clearError: vi.fn(),
    reload: vi.fn(),
    setTasks: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    removeTask: vi.fn(),
    toggleDone: vi.fn(),
    persistReorder: vi.fn(),
    rollForward: vi.fn(),
    getTemplate: vi.fn(),
    updateSeries: vi.fn(),
    deleteOccurrence: vi.fn(),
    deleteSeriesFuture: vi.fn(),
    offline: false,
    savedAt: null as number | null,
  },
}))

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => h.auth }))
vi.mock('../data/SettingsProvider', () => ({ useSettingsContext: () => h.settings }))
vi.mock('../data/useTasks', () => ({ useTasks: () => h.tasks }))

import { BoardPage } from './BoardPage'

afterEach(() => {
  h.auth.user = null
  h.settings.loading = false
  h.tasks.tasks = []
  h.tasks.loading = false
  h.tasks.offline = false
  h.tasks.savedAt = null
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
  h.tasks.tasks = makeMockTasks()
  h.tasks.offline = true
  h.tasks.savedAt = 1_700_000_000_000
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
