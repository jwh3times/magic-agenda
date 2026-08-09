import { StrictMode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, expect, test } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { fakeAuthGateway, fakeSession, type FakeAuth } from '../auth/fakeAuthGateway'
import { AuthConfirm } from './AuthConfirm'

let fake: FakeAuth

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  fake = fakeAuthGateway()
  window.history.replaceState(null, '', '/auth/confirm')
})

function tree() {
  return (
    <MemoryRouter initialEntries={['/auth/confirm']}>
      <AuthProvider gateway={fake.gateway}>
        <Routes>
          <Route path="/auth/confirm" element={<AuthConfirm />} />
          <Route path="/" element={<div>BOARD</div>} />
          <Route path="/login" element={<div>LOGIN</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  )
}

test('redeems the token exactly once under StrictMode and scrubs it from the URL', async () => {
  window.history.replaceState(null, '', '/auth/confirm?token_hash=tok9&type=signup')
  render(<StrictMode>{tree()}</StrictMode>)
  await waitFor(() => expect(fake.calls.redeemToken).toEqual([['tok9', 'signup']]))
  expect(window.location.search).toBe('')
})

test('a successful redemption lands on the board once the session arrives', async () => {
  window.history.replaceState(null, '', '/auth/confirm?token_hash=tok9&type=signup')
  render(tree())
  await waitFor(() => expect(fake.calls.redeemToken).toHaveLength(1))
  // The real client fires SIGNED_IN from inside verifyOtp; the fake leaves that to the test.
  act(() => fake.emit('SIGNED_IN', fakeSession()))
  expect(await screen.findByText('BOARD')).toBeInTheDocument()
})

test('a session arriving mid-redemption does not flip to the refusal card', async () => {
  // The decision is latched once auth settles precisely for this: the real client fires SIGNED_IN
  // from inside verifyOtp, i.e. BEFORE the promise resolves. Re-deriving the decision from live
  // state at that moment says "already signed in — link unused" about the redemption in progress.
  fake.next.redeemToken = new Promise(() => {}) // still in flight
  window.history.replaceState(null, '', '/auth/confirm?token_hash=tok9&type=signup')
  render(tree())
  await waitFor(() => expect(fake.calls.redeemToken).toHaveLength(1))

  act(() => fake.emit('SIGNED_IN', fakeSession()))

  expect(screen.queryByText(/confirmation link wasn’t used/)).not.toBeInTheDocument()
  expect(await screen.findByText('BOARD')).toBeInTheDocument()
})

test('refuses to redeem over an existing session', async () => {
  fake = fakeAuthGateway({ session: fakeSession() })
  window.history.replaceState(null, '', '/auth/confirm?token_hash=tok9&type=signup')
  render(tree())
  expect(
    await screen.findByText('You’re already signed in, so this confirmation link wasn’t used.'),
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Back to your board' })).toHaveAttribute('href', '/')
  expect(fake.calls.redeemToken).toEqual([])
})

test('a signed-in visitor with no link stays on the board rather than being told one failed', async () => {
  fake = fakeAuthGateway({ session: fakeSession() })
  render(tree())
  expect(await screen.findByText('You’re already signed in.')).toBeInTheDocument()
  expect(screen.queryByText(/confirmation link wasn’t used/)).not.toBeInTheDocument()
})

test('a failed redemption shows the error card with a link to sign in', async () => {
  fake.next.redeemToken = {
    ok: false,
    failure: { reason: 'expired-link', message: 'This link is invalid or has expired.' },
  }
  window.history.replaceState(null, '', '/auth/confirm?token_hash=bad&type=signup')
  render(tree())
  expect(
    await screen.findByText(
      'This confirmation link is invalid or has expired. Try signing in — if your account is already confirmed it will work; otherwise sign up again for a fresh link.',
    ),
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
})

test('a redemption that could not reach the server does not claim the link expired', async () => {
  // #131 — the confirm side of the same defect.
  fake.next.redeemToken = {
    ok: false,
    failure: { reason: 'offline', message: 'Couldn’t reach the server.' },
  }
  window.history.replaceState(null, '', '/auth/confirm?token_hash=tok9&type=signup')
  render(tree())
  expect(
    await screen.findByText(/Couldn’t reach the server to confirm your account/),
  ).toBeInTheDocument()
  expect(screen.queryByText(/invalid or has expired/)).not.toBeInTheDocument()
})

test('a missing token shows the error card without redeeming', async () => {
  render(tree())
  expect(
    await screen.findByText(
      'This confirmation link is invalid or has expired. Try signing in — if your account is already confirmed it will work; otherwise sign up again for a fresh link.',
    ),
  ).toBeInTheDocument()
  expect(fake.calls.redeemToken).toEqual([])
})

// ——— landmarks ———

test('the error card is a main landmark with the page heading', async () => {
  render(tree())
  expect(await screen.findByRole('main')).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1, name: 'Magic Agenda' })).toBeInTheDocument()
})

test('the logo is fluid so it cannot overflow the card', async () => {
  render(tree())
  const logo = await screen.findByAltText('Magic Agenda')
  expect(logo.style.maxWidth).toBe('100%')
  expect(logo.style.height).toBe('auto')
})
