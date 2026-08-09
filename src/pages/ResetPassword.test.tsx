import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, expect, test } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { fakeAuthGateway, fakeSession, type FakeAuth } from '../auth/fakeAuthGateway'
import { ResetPassword } from './ResetPassword'

let fake: FakeAuth

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  fake = fakeAuthGateway()
  // The redemption hook reads window.location.search directly (one-shot at mount).
  window.history.replaceState(null, '', '/auth/reset')
})

/** A live recovery session, as it exists after a redemption or across a reload. */
function liveRecoverySession() {
  sessionStorage.setItem('ma-password-recovery', '1')
  fake = fakeAuthGateway({ session: fakeSession() })
}

function tree() {
  return (
    <MemoryRouter initialEntries={['/auth/reset']}>
      <AuthProvider gateway={fake.gateway}>
        <Routes>
          <Route path="/auth/reset" element={<ResetPassword />} />
          <Route path="/" element={<div>BOARD</div>} />
          <Route path="/login" element={<div>LOGIN</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  )
}

// ——— the form ———

test('rejects mismatched passwords without calling the gateway', async () => {
  liveRecoverySession()
  render(tree())
  await userEvent.type(await screen.findByPlaceholderText('New password'), 'longenough123!')
  await userEvent.type(screen.getByPlaceholderText('Confirm new password'), 'different123!')
  await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))
  expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument()
  expect(fake.calls.setPassword).toEqual([])
})

test('updates the password, clears the recovery flag, and lands on the board', async () => {
  liveRecoverySession()
  render(tree())
  await userEvent.type(await screen.findByPlaceholderText('New password'), 'longenough123!')
  await userEvent.type(screen.getByPlaceholderText('Confirm new password'), 'longenough123!')
  await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))

  expect(fake.calls.setPassword).toEqual(['longenough123!'])
  expect(await screen.findByText('BOARD')).toBeInTheDocument()
  expect(sessionStorage.getItem('ma-password-recovery')).toBeNull()
})

test('a failed update surfaces the message, keeps the flag, and clears busy', async () => {
  liveRecoverySession()
  fake.next.setPassword = {
    ok: false,
    failure: { reason: 'same-password', message: 'That’s already your current password.' },
  }
  render(tree())
  await userEvent.type(await screen.findByPlaceholderText('New password'), 'longenough123!')
  await userEvent.type(screen.getByPlaceholderText('Confirm new password'), 'longenough123!')
  await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))

  expect(await screen.findByText('That’s already your current password.')).toBeInTheDocument()
  // The gate must stay up: a failed update means the password was NOT changed.
  expect(sessionStorage.getItem('ma-password-recovery')).toBe('1')
  expect(screen.getByRole('button', { name: 'Set new password' })).toBeEnabled()
})

// ——— redemption ———

test('redeems the token exactly once under StrictMode and scrubs it from the URL', async () => {
  window.history.replaceState(null, '', '/auth/reset?token_hash=tok123&type=recovery')
  render(<StrictMode>{tree()}</StrictMode>)
  await waitFor(() => expect(fake.calls.redeemToken).toEqual([['tok123', 'recovery']]))
  expect(window.location.search).toBe('') // spent token never lingers in the URL/history
})

test('shows a spinner, not the error card, while the token is being redeemed', async () => {
  fake.next.redeemToken = new Promise(() => {}) // never resolves
  window.history.replaceState(null, '', '/auth/reset?token_hash=tok123&type=recovery')
  render(tree())
  expect(await screen.findByText('Checking your reset link…')).toBeInTheDocument()
  expect(screen.queryByText(/invalid or has expired/)).not.toBeInTheDocument()
})

test('a failed redemption shows the invalid-or-expired card', async () => {
  fake.next.redeemToken = {
    ok: false,
    failure: { reason: 'expired-link', message: 'This link is invalid or has expired.' },
  }
  window.history.replaceState(null, '', '/auth/reset?token_hash=bad&type=recovery')
  render(tree())
  expect(
    await screen.findByText(
      'This password reset link is invalid or has expired. Request a new one from the sign-in page.',
    ),
  ).toBeInTheDocument()
})

test('a redemption that could not reach the server does not claim the link expired', async () => {
  // #131. The token has already been scrubbed from the URL at this point, so telling the user to
  // request a new link would be wrong twice over — the link is still good and still unused.
  fake.next.redeemToken = {
    ok: false,
    failure: { reason: 'offline', message: 'Couldn’t reach the server.' },
  }
  window.history.replaceState(null, '', '/auth/reset?token_hash=tok123&type=recovery')
  render(tree())
  expect(
    await screen.findByText(/Couldn’t reach the server to check your reset link/),
  ).toBeInTheDocument()
  expect(screen.queryByText(/invalid or has expired/)).not.toBeInTheDocument()
})

test('a recovery session with no token still gets the form (reload / re-entry)', async () => {
  // After a successful verify the token is spent and scrubbed; reloading or being bounced back
  // by ProtectedRoute must land on the form, not the error card.
  liveRecoverySession()
  render(tree())
  expect(await screen.findByPlaceholderText('New password')).toBeInTheDocument()
  expect(fake.calls.redeemToken).toEqual([])
})

// ——— the session-fixation guard ———

test('refuses to redeem over an existing non-recovery session', async () => {
  fake = fakeAuthGateway({ session: fakeSession() }) // signed in, no recovery flag
  window.history.replaceState(null, '', '/auth/reset?token_hash=tok123&type=recovery')
  render(tree())
  expect(
    await screen.findByText(
      'You’re already signed in, so this reset link wasn’t used. To reset a password, sign out first and request a new link.',
    ),
  ).toBeInTheDocument()
  expect(fake.calls.redeemToken).toEqual([])
})

test('a signed-in visitor with no link is not told a link went unused', async () => {
  // The old single-branch refusal claimed "this reset link wasn't used" even when the URL
  // carried no link at all.
  fake = fakeAuthGateway({ session: fakeSession() })
  render(tree())
  expect(
    await screen.findByText(/You’re already signed in\. To reset your password/),
  ).toBeInTheDocument()
  expect(screen.queryByText(/this reset link wasn’t used/)).not.toBeInTheDocument()
})

test('shows the expired-link screen when there is no session and no token', async () => {
  render(tree())
  expect(
    await screen.findByText(
      'This password reset link is invalid or has expired. Request a new one from the sign-in page.',
    ),
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
})

// ——— landmarks ———

test('the reset-password card is a main landmark with the page heading', async () => {
  liveRecoverySession()
  render(tree())
  expect(await screen.findByRole('main')).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1, name: 'Magic Agenda' })).toBeInTheDocument()
})

test('the logo is fluid so it cannot overflow the card', async () => {
  liveRecoverySession()
  render(tree())
  const logo = await screen.findByAltText('Magic Agenda')
  expect(logo.style.maxWidth).toBe('100%')
  expect(logo.style.height).toBe('auto')
})
