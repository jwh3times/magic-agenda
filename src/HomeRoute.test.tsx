import { render, screen } from '@testing-library/react'
import { expect, test, vi, beforeEach } from 'vitest'

// `/` now branches instead of being gated by ProtectedRoute. These tests pin the three outcomes —
// especially the password-recovery redirect, which ProtectedRoute used to provide and which a
// naive `session ? <BoardPage/> : <Landing/>` would silently drop (session-fixation regression;
// see v1.2.19 and docs/specs/2026-07-25-pkce-auth-flow-design.md).

const h = vi.hoisted(() => ({
  auth: {
    session: null as unknown,
    loading: false,
    passwordRecovery: false,
    user: null as unknown,
    clearPasswordRecovery: vi.fn(),
    signOut: vi.fn(),
  },
}))

vi.mock('./auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => h.auth,
}))

// The board is lazy and drags in dnd-kit + Supabase; the branch is what matters here, not its body.
vi.mock('./pages/BoardPage', () => ({ BoardPage: () => <div>BOARD</div> }))

import App from './App'

beforeEach(() => {
  h.auth.session = null
  h.auth.loading = false
  h.auth.passwordRecovery = false
  window.history.pushState({}, '', '/')
})

test('signed out: renders the landing page instead of bouncing to /login', async () => {
  render(<App />)
  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
    'Your week, on sticky notes.',
  )
  expect(window.location.pathname).toBe('/')
})

test('signed in: renders the board at the same URL', async () => {
  h.auth.session = {}
  render(<App />)
  expect(await screen.findByText('BOARD')).toBeInTheDocument()
  expect(window.location.pathname).toBe('/')
})

test('a password-recovery session is still forced to /auth/reset, never to the board', async () => {
  h.auth.session = {}
  h.auth.passwordRecovery = true
  render(<App />)
  await screen.findByText((_, el) => el?.tagName === 'BODY')
  expect(screen.queryByText('BOARD')).not.toBeInTheDocument()
  expect(window.location.pathname).toBe('/auth/reset')
})

test('while the session is resolving, neither the landing page nor the board is shown', () => {
  h.auth.loading = true
  render(<App />)
  expect(screen.queryByText('BOARD')).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
})
