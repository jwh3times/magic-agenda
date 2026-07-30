import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  updateUser: vi.fn(() => Promise.resolve({ data: {}, error: null as Error | null })),
  verifyOtp: vi.fn(() => Promise.resolve({ data: {}, error: null as Error | null })),
  clearPasswordRecovery: vi.fn(),
  auth: {
    current: {
      session: { user: { id: 'u1' } } as unknown,
      user: { id: 'u1' } as unknown,
      loading: false,
      passwordRecovery: true,
      clearPasswordRecovery: vi.fn(),
      signOut: vi.fn(),
    },
  },
}))

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { updateUser: h.updateUser, verifyOtp: h.verifyOtp } },
}))

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => h.auth.current }))

import { ResetPassword } from './ResetPassword'

beforeEach(() => {
  h.updateUser.mockClear()
  h.verifyOtp.mockClear()
  h.verifyOtp.mockImplementation(() => Promise.resolve({ data: {}, error: null as Error | null }))
  h.auth.current.clearPasswordRecovery = h.clearPasswordRecovery
  h.clearPasswordRecovery.mockClear()
  h.auth.current.session = { user: { id: 'u1' } }
  h.auth.current.passwordRecovery = true
  // The component reads window.location.search directly (one-shot at mount).
  window.history.replaceState(null, '', '/auth/reset')
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/auth/reset']}>
      <ResetPassword />
    </MemoryRouter>,
  )
}

// ——— existing behavior, unchanged ———

test('rejects mismatched passwords without calling supabase', async () => {
  renderPage()
  await userEvent.type(screen.getByPlaceholderText('New password'), 'longenough123!')
  await userEvent.type(screen.getByPlaceholderText('Confirm new password'), 'different123!')
  await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))
  expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument()
  expect(h.updateUser).not.toHaveBeenCalled()
})

test('updates the password and clears the recovery flag on success', async () => {
  renderPage()
  await userEvent.type(screen.getByPlaceholderText('New password'), 'longenough123!')
  await userEvent.type(screen.getByPlaceholderText('Confirm new password'), 'longenough123!')
  await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))
  expect(h.updateUser).toHaveBeenCalledWith({ password: 'longenough123!' })
  expect(h.clearPasswordRecovery).toHaveBeenCalled()
})

test('a thrown (rejected) update surfaces an error and clears busy', async () => {
  h.updateUser.mockRejectedValueOnce(new Error('network exploded'))
  renderPage()
  await userEvent.type(screen.getByPlaceholderText('New password'), 'longenough123!')
  await userEvent.type(screen.getByPlaceholderText('Confirm new password'), 'longenough123!')
  const btn = screen.getByRole('button', { name: 'Set new password' })
  await userEvent.click(btn)
  expect(await screen.findByText('network exploded')).toBeInTheDocument()
  expect(h.clearPasswordRecovery).not.toHaveBeenCalled()
  expect(btn).toBeEnabled() // busy cleared, not stuck disabled
})

test('shows the expired-link screen when there is no session and no token', () => {
  h.auth.current.session = null
  h.auth.current.passwordRecovery = false
  renderPage()
  expect(
    screen.getByText(
      'This password reset link is invalid or has expired. Request a new one from the sign-in page.',
    ),
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
})

// ——— new: token_hash redemption ———

test('redeems the token exactly once under StrictMode and scrubs it from the URL', async () => {
  h.auth.current.session = null
  h.auth.current.passwordRecovery = false
  window.history.replaceState(null, '', '/auth/reset?token_hash=tok123&type=recovery')
  render(
    <StrictMode>
      <MemoryRouter initialEntries={['/auth/reset']}>
        <ResetPassword />
      </MemoryRouter>
    </StrictMode>,
  )
  await waitFor(() => expect(h.verifyOtp).toHaveBeenCalledTimes(1))
  expect(h.verifyOtp).toHaveBeenCalledWith({ token_hash: 'tok123', type: 'recovery' })
  expect(window.location.search).toBe('') // spent token never lingers in the URL/history
})

test('shows a spinner, not the error card, while the token is being redeemed', () => {
  h.auth.current.session = null
  h.auth.current.passwordRecovery = false
  h.verifyOtp.mockImplementation(() => new Promise(() => {})) // never resolves
  window.history.replaceState(null, '', '/auth/reset?token_hash=tok123&type=recovery')
  renderPage()
  expect(screen.getByText('Checking your reset link…')).toBeInTheDocument()
  expect(screen.queryByText(/invalid or has expired/)).not.toBeInTheDocument()
})

test('a failed redemption shows the invalid-or-expired card', async () => {
  h.auth.current.session = null
  h.auth.current.passwordRecovery = false
  h.verifyOtp.mockImplementation(() =>
    Promise.resolve({ data: {}, error: new Error('Token has expired') }),
  )
  window.history.replaceState(null, '', '/auth/reset?token_hash=bad&type=recovery')
  renderPage()
  expect(
    await screen.findByText(
      'This password reset link is invalid or has expired. Request a new one from the sign-in page.',
    ),
  ).toBeInTheDocument()
})

test('a recovery session with no token still gets the form (reload / re-entry)', () => {
  // After a successful verify the token is spent and scrubbed; reloading or being
  // bounced back by ProtectedRoute must land on the form, not the error card.
  renderPage()
  expect(screen.getByPlaceholderText('New password')).toBeInTheDocument()
  expect(h.verifyOtp).not.toHaveBeenCalled()
})

test('refuses to redeem over an existing non-recovery session', () => {
  h.auth.current.passwordRecovery = false
  window.history.replaceState(null, '', '/auth/reset?token_hash=tok123&type=recovery')
  renderPage()
  expect(
    screen.getByText(
      'You’re already signed in, so this reset link wasn’t used. To reset a password, sign out first and request a new link.',
    ),
  ).toBeInTheDocument()
  expect(h.verifyOtp).not.toHaveBeenCalled()
})

// ——— landmarks ———

test('the reset-password card is a main landmark with the page heading', () => {
  // Default beforeEach state (a live recovery session, no token) renders the form directly.
  renderPage()
  expect(screen.getByRole('main')).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1, name: 'Magic Agenda' })).toBeInTheDocument()
})

test('the logo is fluid so it cannot overflow the card', () => {
  // Default beforeEach state (a live recovery session, no token) renders the form directly.
  renderPage()
  const logo = screen.getByAltText('Magic Agenda')
  expect(logo.style.maxWidth).toBe('100%')
  expect(logo.style.height).toBe('auto')
})
