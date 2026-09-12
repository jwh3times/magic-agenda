import { render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi, beforeEach } from 'vitest'

// `/` now branches instead of being gated by ProtectedRoute. These tests pin the outcomes —
// especially the password-recovery redirect, which ProtectedRoute used to provide and which a
// naive `session ? <BoardPage/> : <Landing/>` would silently drop (session-fixation regression;
// see v1.2.19 and docs/specs/2026-07-25-pkce-auth-flow-design.md) — and the offline fallback,
// which must mirror ProtectedRoute's or the board becomes unreachable from `/` while offline
// (that divergence shipped once; see the Task 5 fix-round report).

interface MockAuth {
  session: unknown
  loading: boolean
  passwordRecovery: boolean
  // Stated rather than left off: `undefined` is falsy, so omitting it would let every test below
  // render the board while asserting nothing about the two-factor gate at all.
  stepUpRequired: boolean | null
  user: unknown
  clearPasswordRecovery: ReturnType<typeof vi.fn>
  signOut: ReturnType<typeof vi.fn>
  listTotpFactors: ReturnType<typeof vi.fn>
  verifyTotp: ReturnType<typeof vi.fn>
}

const h = vi.hoisted<{ auth: MockAuth }>(() => ({
  auth: {
    session: null,
    loading: false,
    passwordRecovery: false,
    stepUpRequired: false,
    user: null,
    clearPasswordRecovery: vi.fn(),
    signOut: vi.fn(),
    listTotpFactors: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: [{ id: 'factor-1', name: 'Authenticator', verified: true, createdAt: '2026-01-01' }],
      }),
    ),
    verifyTotp: vi.fn(() => Promise.resolve({ ok: true })),
  },
}))

vi.mock('./auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => h.auth,
}))

// The board is lazy and drags in dnd-kit + Supabase; the branch is what matters here, not its body.
vi.mock('./pages/BoardPage', () => ({ BoardPage: () => <div>BOARD</div> }))

import App from './App'

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true })
}

beforeEach(() => {
  h.auth.session = null
  h.auth.loading = false
  h.auth.passwordRecovery = false
  h.auth.stepUpRequired = false
  window.history.pushState({}, '', '/')
  setOnLine(true)
})

afterEach(() => setOnLine(true))

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

test('signed out and online: renders the landing page even with a snapshot on hand', async () => {
  localStorage.setItem('ma-last-user', 'u1')
  localStorage.setItem(
    'ma-snapshot-board.b1',
    JSON.stringify({ v: 9, userId: 'u1', boardId: 'b1', savedAt: 1, tasks: [], templates: [] }),
  )
  setOnLine(true)
  render(<App />)
  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
    'Your week, on sticky notes.',
  )
  expect(screen.queryByText('BOARD')).not.toBeInTheDocument()
})

test('signed out, offline, no snapshot: still renders the landing page', async () => {
  setOnLine(false)
  render(<App />)
  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
    'Your week, on sticky notes.',
  )
  expect(screen.queryByText('BOARD')).not.toBeInTheDocument()
})

test('signed out, offline, snapshot for the last user: renders the board instead of the landing page', async () => {
  localStorage.setItem('ma-last-user', 'u1')
  localStorage.setItem(
    'ma-snapshot-board.b1',
    JSON.stringify({ v: 9, userId: 'u1', boardId: 'b1', savedAt: 1, tasks: [], templates: [] }),
  )
  setOnLine(false)
  render(<App />)
  expect(await screen.findByText('BOARD')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
})

test('a lingering recovery flag blocks the offline fallback at / too', async () => {
  h.auth.passwordRecovery = true
  localStorage.setItem('ma-last-user', 'u1')
  localStorage.setItem(
    'ma-snapshot-board.b1',
    JSON.stringify({ v: 9, userId: 'u1', boardId: 'b1', savedAt: 1, tasks: [], templates: [] }),
  )
  setOnLine(false)
  render(<App />)
  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
    'Your week, on sticky notes.',
  )
  expect(screen.queryByText('BOARD')).not.toBeInTheDocument()
})

// ——— two-factor step-up ———
// The board lives at `/`, which is this component and NOT ProtectedRoute. #272 put the gate in
// ProtectedRoute first, which reaches /settings and nothing else — so without these two the
// feature would have shipped protecting the settings page while leaving every task on the board
// one password away.

test('a session that owes a TOTP code gets the prompt at / instead of the board', async () => {
  h.auth.session = {}
  h.auth.stepUpRequired = true
  render(<App />)
  expect(await screen.findByLabelText('Six-digit code')).toBeInTheDocument()
  expect(screen.queryByText('BOARD')).not.toBeInTheDocument()
  expect(window.location.pathname).toBe('/')
})

test('the board does not paint at / while the assurance level is still unknown', async () => {
  h.auth.session = {}
  h.auth.stepUpRequired = null
  render(<App />)
  expect(await screen.findByText('Loading…')).toBeInTheDocument()
  expect(screen.queryByText('BOARD')).not.toBeInTheDocument()
})
