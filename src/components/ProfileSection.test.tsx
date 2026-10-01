import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  user: { id: 'acct-1' } as { id: string } | null,
  load: vi.fn(),
  save: vi.fn(),
}))

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: h.user }) }))
vi.mock('../data/accountProfile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/accountProfile')>()),
  loadDisplayName: h.load,
  saveDisplayName: h.save,
}))

import { ProfileSection } from './ProfileSection'

beforeEach(() => {
  vi.resetAllMocks()
  h.user = { id: 'acct-1' }
  h.load.mockResolvedValue({ ok: true, data: '' })
})

const field = () => screen.getByRole('textbox', { name: 'Display name' })
const save = () => screen.getByRole('button', { name: 'Save' })

test('loads the stored name, and Save stays off until it changes', async () => {
  h.load.mockResolvedValue({ ok: true, data: 'Ada' })
  render(<ProfileSection />)
  await waitFor(() => expect(field()).toHaveValue('Ada'))
  expect(h.load).toHaveBeenCalledWith('acct-1')
  expect(save()).toBeDisabled()
  // Whitespace alone is not a change: the stored name is trimmed.
  await userEvent.type(field(), '  ')
  expect(save()).toBeDisabled()
})

test('saves a new name and confirms it', async () => {
  h.save.mockResolvedValue({ ok: true, data: 'Jerry' })
  render(<ProfileSection />)
  await waitFor(() => expect(field()).toBeEnabled())
  await userEvent.type(field(), 'Jerry')
  await userEvent.click(save())
  expect(h.save).toHaveBeenCalledWith('acct-1', 'Jerry')
  expect(await screen.findByRole('status')).toHaveTextContent('Saved.')
  expect(save()).toBeDisabled()
})

test('Enter in the field saves too', async () => {
  h.save.mockResolvedValue({ ok: true, data: 'Jerry' })
  render(<ProfileSection />)
  await waitFor(() => expect(field()).toBeEnabled())
  await userEvent.type(field(), 'Jerry{Enter}')
  expect(h.save).toHaveBeenCalledWith('acct-1', 'Jerry')
})

test('an over-length name is flagged and cannot be saved', async () => {
  render(<ProfileSection />)
  await waitFor(() => expect(field()).toBeEnabled())
  await userEvent.click(field())
  await userEvent.paste('x'.repeat(81))
  expect(screen.getByRole('alert')).toHaveTextContent(/at most 80/)
  expect(field()).toHaveAttribute('aria-invalid', 'true')
  expect(save()).toBeDisabled()
})

test('a refused save shows why and keeps the draft', async () => {
  h.save.mockResolvedValue({ ok: false, message: 'Your name was not saved.' })
  render(<ProfileSection />)
  await waitFor(() => expect(field()).toBeEnabled())
  await userEvent.type(field(), 'Jerry')
  await userEvent.click(save())
  expect(await screen.findByRole('alert')).toHaveTextContent('Your name was not saved.')
  expect(field()).toHaveValue('Jerry')
})

test('clearing the name says the account will show as unnamed', async () => {
  h.load.mockResolvedValue({ ok: true, data: 'Ada' })
  h.save.mockResolvedValue({ ok: true, data: '' })
  render(<ProfileSection />)
  await waitFor(() => expect(field()).toHaveValue('Ada'))
  await userEvent.clear(field())
  await userEvent.click(save())
  expect(await screen.findByRole('status')).toHaveTextContent('Unnamed member')
})

test('without a live session there is no field to save from', () => {
  h.user = null
  render(<ProfileSection />)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.getByText(/back online/)).toBeInTheDocument()
  expect(h.load).not.toHaveBeenCalled()
})
