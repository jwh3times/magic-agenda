import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(() => Promise.resolve({ data: {}, error: null })),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: h.resetPasswordForEmail,
      signInWithPassword: vi.fn(() => Promise.resolve({ error: null })),
      signUp: vi.fn(() => Promise.resolve({ data: {}, error: null })),
      signInWithOAuth: vi.fn(() => Promise.resolve({ error: null })),
    },
  },
}))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: null, user: null, loading: false }),
}))

import { Login } from './Login'

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  )
}

test('forgot mode hides the password field and sends the reset email', async () => {
  renderLogin()
  await userEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
  expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument()

  await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'a@b.co')
  await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

  expect(h.resetPasswordForEmail).toHaveBeenCalledWith('a@b.co', {
    redirectTo: `${window.location.origin}/auth/reset`,
  })
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
  render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state: { accountDeleted: true } }]}>
      <Login />
    </MemoryRouter>,
  )
  expect(screen.getByText(/Your account and all of its data have been deleted/)).toBeInTheDocument()
})
