import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, expect, test } from 'vitest'
import { AuthProvider } from './AuthProvider'
import { ProtectedRoute } from './ProtectedRoute'
import { fakeAuthGateway, fakeSession, type FakeAuth } from './fakeAuthGateway'
import type { TotpFactor } from './mfa'

/**
 * The step-up gate end to end: the real `AuthProvider` and the real `ProtectedRoute`, driven
 * through the fake adapter. Stubbing `useAuth` here would test nothing — the whole question is
 * whether the provider's assurance read and the route's gate agree, and a stub is where those two
 * drift apart.
 */

let fake: FakeAuth

const FACTOR: TotpFactor = {
  id: 'factor-1',
  name: 'Authenticator',
  verified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  fake = fakeAuthGateway({ session: fakeSession() })
  fake.next.listTotpFactors = { ok: true, data: [FACTOR] }
})

function renderApp() {
  return render(
    <AuthProvider gateway={fake.gateway}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <div>the board</div>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

/**
 * The code field, once it will accept typing.
 *
 * It renders disabled until the factor list arrives, so `findByLabelText` alone returns a field
 * that silently swallows every keystroke — the assertion that then fails is the one about
 * `verifyTotp`, several lines away from the cause.
 */
async function codeField() {
  const field = await screen.findByLabelText('Six-digit code')
  await waitFor(() => expect(field).toBeEnabled())
  return field
}

/** A session that holds a verified factor but has not presented a code for it. */
function gated() {
  fake.next.getAssuranceLevel = { ok: true, data: { current: 'aal1', next: 'aal2' } }
}

test('a session with no factor reaches the board and is never asked for a code', async () => {
  renderApp()
  expect(await screen.findByText('the board')).toBeInTheDocument()
  expect(screen.queryByLabelText('Six-digit code')).not.toBeInTheDocument()
  // The gate never mounted, so it never went looking for factors either.
  expect(fake.calls.listTotpFactors).toBe(0)
})

test('a session that owes a code gets the prompt instead of the board', async () => {
  gated()
  renderApp()
  expect(await screen.findByLabelText('Six-digit code')).toBeInTheDocument()
  expect(screen.queryByText('the board')).not.toBeInTheDocument()
})

test('the board does not paint while the assurance level is still unknown', async () => {
  // The flash this prevents is not cosmetic: it is the protected content appearing for a frame
  // before the gate replaces it. `stepUpRequired` is null in this window, and ProtectedRoute has
  // to spin rather than treat it as "no code owed".
  fake.next.getAssuranceLevel = new Promise(() => {})
  renderApp()
  expect(await screen.findByText('Loading…')).toBeInTheDocument()
  expect(screen.queryByText('the board')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Six-digit code')).not.toBeInTheDocument()
})

test('a correct code verifies against the enrolled factor and the board follows the raised session', async () => {
  gated()
  const user = userEvent.setup()
  renderApp()

  await user.type(await codeField(), '123456')
  // GoTrue raises the session itself and emits MFA_CHALLENGE_VERIFIED; the provider re-reads the
  // assurance level off the new session rather than the page routing anywhere.
  fake.next.getAssuranceLevel = { ok: true, data: { current: 'aal2', next: 'aal2' } }
  await user.click(screen.getByRole('button', { name: 'Verify' }))

  expect(fake.calls.verifyTotp).toEqual([['factor-1', '123456']])
  fake.emit('MFA_CHALLENGE_VERIFIED', fakeSession())
  expect(await screen.findByText('the board')).toBeInTheDocument()
})

test('a wrong code reports itself, clears the field, and keeps the board hidden', async () => {
  gated()
  fake.next.verifyTotp = {
    ok: false,
    failure: { reason: 'invalid-code', message: 'That code isn’t right.' },
  }
  const user = userEvent.setup()
  renderApp()

  await user.type(await codeField(), '000000')
  await user.click(screen.getByRole('button', { name: 'Verify' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('That code isn’t right.')
  expect(screen.getByLabelText('Six-digit code')).toHaveValue('')
  expect(screen.queryByText('the board')).not.toBeInTheDocument()
})

test('the gate offers a way out, because there are no backup codes', async () => {
  gated()
  const user = userEvent.setup()
  renderApp()

  await screen.findByLabelText('Six-digit code')
  await user.click(screen.getByRole('button', { name: 'Sign out' }))
  expect(fake.calls.signOut).toBe(1)
})

test('an unreadable assurance level fails open rather than locking the account out', async () => {
  // Two-factor is not the authorization boundary — RLS keys on auth.uid() — so a read we cannot
  // complete must not cost the user their own board. Blocking would be unrecoverable: Supabase
  // issues no backup codes, so there is nothing the user could type to get past it.
  fake.next.getAssuranceLevel = {
    ok: false,
    failure: { reason: 'offline', message: 'Couldn’t reach the server.' },
  }
  renderApp()
  expect(await screen.findByText('the board')).toBeInTheDocument()
})

test('a gated sign-in never inherits the previous user’s cleared gate', async () => {
  // The provider keeps its answer across a token refresh so the board doesn't blink, which is
  // exactly what would leak here if the answer were not keyed to the user it was read for.
  renderApp()
  await screen.findByText('the board')

  gated()
  act(() => {
    fake.emit('SIGNED_OUT', null)
    fake.emit('SIGNED_IN', fakeSession('u2'))
  })

  // The assertion that matters is this one, and it is deliberately synchronous. The new user's
  // assurance read has not resolved yet, so a provider holding a bare boolean would still be
  // answering "no code owed" for the account that just left — and the board would be on screen
  // right here. Waiting for the gate instead would pass either way.
  expect(screen.queryByText('the board')).not.toBeInTheDocument()
  expect(await screen.findByLabelText('Six-digit code')).toBeInTheDocument()
})

test('several enrolled apps are named, because a code only verifies against its own', async () => {
  gated()
  fake.next.listTotpFactors = {
    ok: true,
    data: [FACTOR, { ...FACTOR, id: 'factor-2', name: 'Backup phone' }],
  }
  const user = userEvent.setup()
  renderApp()

  await user.selectOptions(await screen.findByLabelText('Authenticator'), 'factor-2')
  await user.type(await codeField(), '654321')
  await user.click(screen.getByRole('button', { name: 'Verify' }))

  expect(fake.calls.verifyTotp).toEqual([['factor-2', '654321']])
})

test('a factor removed elsewhere leaves a gate that explains itself instead of a dead button', async () => {
  // The session still carries the raised `next` level from sign-in, so the gate is up; the account
  // no longer has the factor behind it. Nothing the user types could pass, and the Verify button
  // is disabled with no explanation unless this case is named.
  gated()
  fake.next.listTotpFactors = { ok: true, data: [] }
  renderApp()

  expect(await screen.findByRole('alert')).toHaveTextContent(/No authenticator app is enrolled/)
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled()
  expect(screen.queryByText('the board')).not.toBeInTheDocument()
})
