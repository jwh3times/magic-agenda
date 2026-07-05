import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  updateUser: vi.fn(() => Promise.resolve({ data: {}, error: null })),
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
  supabase: { auth: { updateUser: h.updateUser } },
}))

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => h.auth.current }))

import { ResetPassword } from './ResetPassword'

beforeEach(() => {
  h.updateUser.mockClear()
  h.auth.current.clearPasswordRecovery = h.clearPasswordRecovery
  h.clearPasswordRecovery.mockClear()
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/auth/reset']}>
      <ResetPassword />
    </MemoryRouter>,
  )
}

test('rejects mismatched passwords without calling supabase', async () => {
  h.auth.current.session = { user: { id: 'u1' } }
  renderPage()
  await userEvent.type(screen.getByPlaceholderText('New password'), 'longenough123!')
  await userEvent.type(screen.getByPlaceholderText('Confirm new password'), 'different123!')
  await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))
  expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument()
  expect(h.updateUser).not.toHaveBeenCalled()
})

test('updates the password and clears the recovery flag on success', async () => {
  h.auth.current.session = { user: { id: 'u1' } }
  renderPage()
  await userEvent.type(screen.getByPlaceholderText('New password'), 'longenough123!')
  await userEvent.type(screen.getByPlaceholderText('Confirm new password'), 'longenough123!')
  await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))
  expect(h.updateUser).toHaveBeenCalledWith({ password: 'longenough123!' })
  expect(h.clearPasswordRecovery).toHaveBeenCalled()
})

test('shows the expired-link screen when there is no session', () => {
  h.auth.current.session = null
  renderPage()
  expect(screen.getByText(/invalid or has expired/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
})
