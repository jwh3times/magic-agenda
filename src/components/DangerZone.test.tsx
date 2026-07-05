import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

type InvokeResponse = { data: { ok: boolean } | null; error: { message: string } | null }

const h = vi.hoisted(() => ({
  invoke: vi.fn(
    (): Promise<InvokeResponse> => Promise.resolve({ data: { ok: true }, error: null }),
  ),
  signOut: vi.fn(() => Promise.resolve()),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { functions: { invoke: h.invoke } },
}))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1' }, signOut: h.signOut }),
}))

import { DangerZone } from './DangerZone'

beforeEach(() => {
  h.invoke.mockClear()
  h.signOut.mockClear()
})

function renderZone() {
  return render(
    <MemoryRouter>
      <DangerZone />
    </MemoryRouter>,
  )
}

test('the delete button stays disabled until the user types delete', async () => {
  renderZone()
  const btn = screen.getByRole('button', { name: 'Delete my account' })
  expect(btn).toBeDisabled()
  await userEvent.type(screen.getByPlaceholderText('delete'), 'del')
  expect(btn).toBeDisabled()
  await userEvent.type(screen.getByPlaceholderText('delete'), 'ete')
  expect(btn).toBeEnabled()
})

test('confirming calls the delete-account function then signs out', async () => {
  renderZone()
  await userEvent.type(screen.getByPlaceholderText('delete'), 'delete')
  await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
  expect(h.invoke).toHaveBeenCalledWith('delete-account', { method: 'POST' })
  expect(h.signOut).toHaveBeenCalled()
})

test('a failed call surfaces an error and does not sign out', async () => {
  h.invoke.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
  renderZone()
  await userEvent.type(screen.getByPlaceholderText('delete'), 'delete')
  await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
  expect(await screen.findByText(/Could not delete your account/)).toBeInTheDocument()
  expect(h.signOut).not.toHaveBeenCalled()
})
