import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  verifyOtp: vi.fn(() => Promise.resolve({ data: {}, error: null })),
  auth: {
    current: {
      session: null as unknown,
      user: null as unknown,
      loading: false,
      passwordRecovery: false,
      clearPasswordRecovery: vi.fn(),
      signOut: vi.fn(),
    },
  },
}))

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { verifyOtp: h.verifyOtp } },
}))

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => h.auth.current }))

import { AuthConfirm } from './AuthConfirm'

beforeEach(() => {
  h.verifyOtp.mockClear()
  h.verifyOtp.mockImplementation(() => Promise.resolve({ data: {}, error: null }))
  h.auth.current.session = null
  window.history.replaceState(null, '', '/auth/confirm')
})

function pageTree() {
  return (
    <MemoryRouter initialEntries={['/auth/confirm']}>
      <Routes>
        <Route path="/auth/confirm" element={<AuthConfirm />} />
        <Route path="/" element={<div>BOARD</div>} />
        <Route path="/login" element={<div>LOGIN</div>} />
      </Routes>
    </MemoryRouter>
  )
}

test('redeems the token exactly once under StrictMode and scrubs it from the URL', async () => {
  window.history.replaceState(null, '', '/auth/confirm?token_hash=tok9&type=signup')
  render(<StrictMode>{pageTree()}</StrictMode>)
  await waitFor(() => expect(h.verifyOtp).toHaveBeenCalledTimes(1))
  expect(h.verifyOtp).toHaveBeenCalledWith({ token_hash: 'tok9', type: 'signup' })
  expect(window.location.search).toBe('')
})

test('a successful redemption lands on the board once the session arrives', async () => {
  window.history.replaceState(null, '', '/auth/confirm?token_hash=tok9&type=signup')
  const view = render(pageTree())
  await waitFor(() => expect(h.verifyOtp).toHaveBeenCalledTimes(1))
  // verifyOtp fired SIGNED_IN; simulate AuthProvider exposing the new session.
  h.auth.current.session = { user: { id: 'u1' } }
  view.rerender(pageTree())
  expect(await screen.findByText('BOARD')).toBeInTheDocument()
})

test('refuses to redeem over an existing session', () => {
  h.auth.current.session = { user: { id: 'u1' } }
  window.history.replaceState(null, '', '/auth/confirm?token_hash=tok9&type=signup')
  render(pageTree())
  expect(screen.getByText(/already signed in/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Back to your board' })).toHaveAttribute('href', '/')
  expect(h.verifyOtp).not.toHaveBeenCalled()
})

test('a failed redemption shows the error card with a link to sign in', async () => {
  h.verifyOtp.mockImplementation(() =>
    Promise.resolve({ data: {}, error: new Error('Token has expired') }),
  )
  window.history.replaceState(null, '', '/auth/confirm?token_hash=bad&type=signup')
  render(pageTree())
  expect(await screen.findByText(/invalid or has expired/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
})

test('a missing token shows the error card without calling verifyOtp', () => {
  render(pageTree())
  expect(screen.getByText(/invalid or has expired/)).toBeInTheDocument()
  expect(h.verifyOtp).not.toHaveBeenCalled()
})
