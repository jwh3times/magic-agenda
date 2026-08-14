import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

interface MockAuth {
  session: unknown
  user: unknown
  loading: boolean
  passwordRecovery: boolean
  clearPasswordRecovery: ReturnType<typeof vi.fn>
  signOut: ReturnType<typeof vi.fn>
}

const auth = vi.hoisted<{ current: MockAuth }>(() => ({
  current: {
    session: { user: { id: 'u1' } },
    user: { id: 'u1' },
    loading: false,
    passwordRecovery: false,
    clearPasswordRecovery: vi.fn(),
    signOut: vi.fn(),
  },
}))

vi.mock('./AuthProvider', () => ({ useAuth: () => auth.current }))

import { ProtectedRoute } from './ProtectedRoute'

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true })
}

afterEach(() => {
  setOnLine(true)
  auth.current.session = { user: { id: 'u1' } }
  auth.current.passwordRecovery = false
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <div>the board</div>
            </ProtectedRoute>
          }
        />
        <Route path="/auth/reset" element={<div>reset page</div>} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('renders children for a normal session', () => {
  auth.current.passwordRecovery = false
  renderAt('/')
  expect(screen.getByText('the board')).toBeInTheDocument()
})

test('redirects a recovery session to /auth/reset instead of the board', () => {
  auth.current.passwordRecovery = true
  renderAt('/')
  expect(screen.getByText('reset page')).toBeInTheDocument()
  expect(screen.queryByText('the board')).not.toBeInTheDocument()
})

test('redirects to login when signed out and online', () => {
  auth.current.session = null
  renderAt('/')
  expect(screen.getByText('login page')).toBeInTheDocument()
})

test('renders the board offline when a snapshot exists for the last user', () => {
  auth.current.session = null
  localStorage.setItem('ma-last-user', 'u1')
  localStorage.setItem(
    'ma-snapshot-board.b1',
    JSON.stringify({ v: 3, userId: 'u1', boardId: 'b1', savedAt: 1, tasks: [], templates: [] }),
  )
  setOnLine(false)
  renderAt('/')
  expect(screen.getByText('the board')).toBeInTheDocument()
})

test('still redirects offline when there is no snapshot', () => {
  auth.current.session = null
  setOnLine(false)
  renderAt('/')
  expect(screen.getByText('login page')).toBeInTheDocument()
})

test('a lingering recovery flag blocks the offline fallback too, even with a snapshot', () => {
  // Defense in depth: this state (no session, offline, snapshot present, recovery flag still
  // set from an interrupted recovery flow) should be unreachable in practice, but the offline
  // branch must not be the one that lets it through — it exists because of a real
  // session-fixation finding.
  auth.current.session = null
  auth.current.passwordRecovery = true
  localStorage.setItem('ma-last-user', 'u1')
  localStorage.setItem(
    'ma-snapshot-board.b1',
    JSON.stringify({ v: 3, userId: 'u1', boardId: 'b1', savedAt: 1, tasks: [], templates: [] }),
  )
  setOnLine(false)
  renderAt('/')
  expect(screen.getByText('login page')).toBeInTheDocument()
  expect(screen.queryByText('the board')).not.toBeInTheDocument()
})
