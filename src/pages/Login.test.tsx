import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, expect, test } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { fakeAuthGateway, type FakeAuth } from '../auth/fakeAuthGateway'
import { Login } from './Login'

// Driven through the real AuthProvider with the fake adapter. The previous version stubbed
// `useAuth` with 3 of its 6 members while the sibling suites stubbed 6 — drift that nothing
// caught, because a `vi.mock` factory is untyped. There is nothing left here to drift from.
let fake: FakeAuth

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  fake = fakeAuthGateway()
})

function renderLogin(
  initialEntries: Parameters<typeof MemoryRouter>[0]['initialEntries'] = ['/login'],
) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider gateway={fake.gateway}>
        <Login />
      </AuthProvider>
    </MemoryRouter>,
  )
}

test('forgot mode hides the password field and sends the reset email', async () => {
  renderLogin()
  await userEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
  expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument()

  await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'a@b.co')
  await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

  expect(fake.calls.sendPasswordReset).toEqual(['a@b.co'])
  // Same notice whether or not the account exists — never leak existence.
  expect(await screen.findByText(/If an account exists for that email/)).toBeInTheDocument()
})

test('back link returns from forgot mode to sign in', async () => {
  renderLogin()
  await userEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
  await userEvent.click(screen.getByRole('button', { name: 'Back to sign in' }))
  expect(screen.getByPlaceholderText('Password')).toBeInTheDocument()
})

test('shows the account-deleted goodbye notice when arriving from deletion', () => {
  renderLogin([{ pathname: '/login', state: { accountDeleted: true } }])
  expect(screen.getByText(/Your account and all of its data have been deleted/)).toBeInTheDocument()
})

test('a failed Google sign-in surfaces the message', async () => {
  fake.next.startGoogleSignIn = {
    ok: false,
    failure: { reason: 'unknown', message: 'oauth popup blocked' },
  }
  renderLogin()
  await userEvent.click(screen.getByRole('button', { name: /Continue with Google/ }))
  expect(await screen.findByText('oauth popup blocked')).toBeInTheDocument()
})

test('signup asks the user to check their email when confirmation is pending', async () => {
  fake.next.signUp = { ok: true, confirmationRequired: true }
  renderLogin()
  await userEvent.click(screen.getByRole('button', { name: 'Sign up' }))
  await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'a@b.co')
  await userEvent.type(screen.getByPlaceholderText('Password'), 'Longenough123!')
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

  expect(fake.calls.signUp).toEqual([['a@b.co', 'Longenough123!']])
  // Confirmation now signs the user in — the old copy said "…, then sign in."
  expect(await screen.findByText('Check your email to confirm your account.')).toBeInTheDocument()
})

test('signup with an immediate session shows no check-your-email notice', async () => {
  fake.next.signUp = { ok: true, confirmationRequired: false }
  renderLogin()
  await userEvent.click(screen.getByRole('button', { name: 'Sign up' }))
  await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'a@b.co')
  await userEvent.type(screen.getByPlaceholderText('Password'), 'Longenough123!')
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

  expect(fake.calls.signUp).toHaveLength(1)
  expect(screen.queryByText('Check your email to confirm your account.')).not.toBeInTheDocument()
})

test('a failed sign-in renders this app’s copy, not the GoTrue string', async () => {
  fake.next.signIn = {
    ok: false,
    failure: {
      reason: 'bad-credentials',
      message: 'That email and password don’t match an account.',
    },
  }
  renderLogin()
  await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'a@b.co')
  await userEvent.type(screen.getByPlaceholderText('Password'), 'wrongpassword')
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

  expect(
    await screen.findByText('That email and password don’t match an account.'),
  ).toBeInTheDocument()
  expect(screen.queryByText(/Invalid login credentials/)).not.toBeInTheDocument()
})

test('the submit button un-busies after a failure', async () => {
  fake.next.signIn = {
    ok: false,
    failure: { reason: 'offline', message: 'Couldn’t reach the server.' },
  }
  renderLogin()
  await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'a@b.co')
  await userEvent.type(screen.getByPlaceholderText('Password'), 'somepassword')
  const btn = screen.getByRole('button', { name: 'Sign in' })
  await userEvent.click(btn)
  expect(await screen.findByText('Couldn’t reach the server.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
})

test('the sign-in card is a main landmark with the page heading', () => {
  renderLogin()
  expect(screen.getByRole('main')).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1, name: 'Magic Agenda' })).toBeInTheDocument()
})

test('the logo is fluid so it cannot overflow the card', () => {
  renderLogin()
  const logo = screen.getByAltText('Magic Agenda')
  // Asserted on the inline style, not getComputedStyle: jsdom has no layout engine, so this is a
  // shape test. It catches a call site missed during the edit, which is the realistic regression —
  // the actual overflow is measured by the 390px check in tests/e2e/smoke.spec.ts.
  expect(logo.style.maxWidth).toBe('100%')
  expect(logo.style.height).toBe('auto')
})
