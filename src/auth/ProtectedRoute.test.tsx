import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, test, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  current: {
    session: { user: { id: 'u1' } } as unknown,
    user: { id: 'u1' } as unknown,
    loading: false,
    passwordRecovery: false,
    clearPasswordRecovery: vi.fn(),
    signOut: vi.fn(),
  },
}))

vi.mock('./AuthProvider', () => ({ useAuth: () => auth.current }))

import { ProtectedRoute } from './ProtectedRoute'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <div>the board</div>
            </ProtectedRoute>
          }
        />
        <Route path="/auth/reset" element={<div>reset page</div>} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('renders children for a normal session', () => {
  auth.current.passwordRecovery = false
  renderAt('/')
  expect(screen.getByText('the board')).toBeInTheDocument()
})

test('redirects a recovery session to /auth/reset instead of the board', () => {
  auth.current.passwordRecovery = true
  renderAt('/')
  expect(screen.getByText('reset page')).toBeInTheDocument()
  expect(screen.queryByText('the board')).not.toBeInTheDocument()
})
