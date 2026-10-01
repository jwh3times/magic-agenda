import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { fakeBoardDirectory } from '../board/fakeBoardDirectory'
import type { InvitationOutcome, InvitationPreview } from '../invite/invitations'

interface MockAuth {
  session: unknown
  user?: { id: string } | null
  loading: boolean
  passwordRecovery: boolean
  stepUpRequired: boolean | null
}

const h = vi.hoisted(() => ({
  auth: {
    session: null,
    loading: false,
    passwordRecovery: false,
    stepUpRequired: false,
  } satisfies MockAuth as MockAuth,
  preview: vi.fn(),
  accept: vi.fn(),
  decline: vi.fn(),
  reload: vi.fn(() => Promise.resolve()),
  selectBoard: vi.fn(),
  loadName: vi.fn(),
  saveName: vi.fn(),
  calls: [] as string[],
}))

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => h.auth }))
vi.mock('../auth/MfaChallenge', () => ({ MfaChallenge: () => <div>MFA</div> }))
vi.mock('../board/BoardDirectoryProvider', () => ({
  useBoardDirectoryContext: () =>
    fakeBoardDirectory({ reload: h.reload, selectBoard: h.selectBoard }),
}))
vi.mock('../data/accountProfile', async (importActual) => ({
  ...(await importActual<typeof import('../data/accountProfile')>()),
  loadDisplayName: h.loadName,
  saveDisplayName: h.saveName,
}))
vi.mock('../invite/invitations', async (importActual) => ({
  ...(await importActual<typeof import('../invite/invitations')>()),
  previewInvitation: h.preview,
  acceptInvitation: h.accept,
  declineInvitation: h.decline,
}))

import { InvitePage } from './InvitePage'
import { readPendingInvitation, savePendingInvitation } from '../invite/pendingInvitation'

const PREVIEW: InvitationOutcome<InvitationPreview> = {
  ok: true,
  value: { boardName: 'Team', inviterName: 'Olive', role: 'editor', expiresAt: '2026-10-10' },
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  h.auth.session = null
  h.auth.user = null
  h.auth.stepUpRequired = false
  h.calls = []
  h.loadName.mockResolvedValue({ ok: true, data: '' })
  h.saveName.mockImplementation((_id: string, name: string) => {
    h.calls.push('save')
    return Promise.resolve({ ok: true, data: name.trim() })
  })
  h.preview.mockResolvedValue(PREVIEW)
  h.accept.mockImplementation(() => {
    h.calls.push('accept')
    return Promise.resolve({ ok: true, value: 'b-team' })
  })
  h.decline.mockResolvedValue({ ok: true, value: undefined })
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/invite']}>
      <Routes>
        <Route path="/invite" element={<InvitePage />} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('adopts the token the bootstrap captured from the link', () => {
  let captured: string | null = 'from-link'
  window.__magicAgendaInvitationCapture = {
    read: () => captured,
    consume: () => {
      captured = null
    },
  }
  try {
    renderPage()
    expect(readPendingInvitation()).toBe('from-link')
  } finally {
    delete window.__magicAgendaInvitationCapture
  }
})

test('signed out: no Board name and no preview call, only a way to sign in', () => {
  savePendingInvitation('tok')
  renderPage()
  expect(
    screen.getByText(/Sign in or create an account to see this invitation/),
  ).toBeInTheDocument()
  expect(h.preview).not.toHaveBeenCalled()
  expect(screen.queryByText('Team')).toBeNull()
  // The token survives, so signing in resumes it.
  expect(readPendingInvitation()).toBe('tok')
})

test('without a held token there is nothing to show', () => {
  h.auth.session = {}
  renderPage()
  expect(screen.getByText(/no invitation waiting/)).toBeInTheDocument()
})

test('a signed-in session owing two-factor sees the challenge first', () => {
  savePendingInvitation('tok')
  h.auth.session = {}
  h.auth.stepUpRequired = true
  renderPage()
  expect(screen.getByText('MFA')).toBeInTheDocument()
  expect(h.preview).not.toHaveBeenCalled()
})

test('signed in: shows the offer and the consent, and accepts only on a click', async () => {
  savePendingInvitation('tok')
  h.auth.session = {}
  renderPage()
  expect(await screen.findByText(/invited you to join/)).toHaveTextContent('Olive')
  expect(screen.getByTestId('invitation-consent')).toHaveTextContent(
    'everything on this board, including attached files',
  )
  expect(h.accept).not.toHaveBeenCalled()

  await userEvent.click(screen.getByRole('button', { name: 'Join Team' }))
  expect(h.accept).toHaveBeenCalledWith('tok')
  await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
  expect(h.reload).toHaveBeenCalled()
  expect(h.selectBoard).toHaveBeenCalledWith('b-team')
  expect(readPendingInvitation()).toBeNull()
})

test('a mismatched email is explained and the dead token is dropped', async () => {
  savePendingInvitation('tok')
  h.auth.session = {}
  h.preview.mockResolvedValue({
    ok: false,
    reason: 'email-mismatch',
    message: 'This invitation was sent to a different email address.',
  })
  renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent('different email address')
  expect(readPendingInvitation()).toBeNull()
})

test('an unverified email keeps the token, since confirming the address fixes it', async () => {
  savePendingInvitation('tok')
  h.auth.session = {}
  h.preview.mockResolvedValue({
    ok: false,
    reason: 'email-unverified',
    message: 'Confirm your email address first.',
  })
  renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent('Confirm your email')
  expect(readPendingInvitation()).toBe('tok')
})

test('declining settles it and clears the token', async () => {
  savePendingInvitation('tok')
  h.auth.session = {}
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Decline' }))
  expect(h.decline).toHaveBeenCalledWith('tok')
  await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
  expect(readPendingInvitation()).toBeNull()
})

test('"Not now" forgets it on this device without declining', async () => {
  savePendingInvitation('tok')
  h.auth.session = {}
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Not now' }))
  expect(h.decline).not.toHaveBeenCalled()
  expect(readPendingInvitation()).toBeNull()
})

describe('asking an unnamed invitee for a Display Name (#476)', () => {
  beforeEach(() => {
    savePendingInvitation('tok')
    h.auth.session = {}
    h.auth.user = { id: 'acct-9' }
  })
  const nameField = () => screen.getByRole('textbox', { name: /Your name/ })

  test('a typed name is saved before joining, so the member never appears unnamed', async () => {
    renderPage()
    await screen.findByText(/invited you to join/)
    expect(h.loadName).toHaveBeenCalledWith('acct-9')
    await userEvent.type(nameField(), '  Ada  ')
    await userEvent.click(screen.getByRole('button', { name: 'Join Team' }))
    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
    expect(h.saveName).toHaveBeenCalledWith('acct-9', '  Ada  ')
    expect(h.calls).toEqual(['save', 'accept'])
  })

  test('the name is optional: a blank field joins without saving anything', async () => {
    renderPage()
    await screen.findByText(/invited you to join/)
    await userEvent.click(screen.getByRole('button', { name: 'Join Team' }))
    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
    expect(h.saveName).not.toHaveBeenCalled()
    expect(h.calls).toEqual(['accept'])
  })

  test('a failed save stops the join and says why', async () => {
    h.saveName.mockResolvedValue({ ok: false, message: 'violates check' })
    renderPage()
    await screen.findByText(/invited you to join/)
    await userEvent.type(nameField(), 'Ada')
    await userEvent.click(screen.getByRole('button', { name: 'Join Team' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/not joined yet.*violates check/)
    expect(h.accept).not.toHaveBeenCalled()
    expect(readPendingInvitation()).toBe('tok')
    expect(screen.getByRole('button', { name: 'Join Team' })).toBeEnabled()
  })

  test('a join that fails after the name saved does not ask or save again on retry', async () => {
    h.accept.mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'Try again.' })
    renderPage()
    await screen.findByText(/invited you to join/)
    await userEvent.type(nameField(), 'Ada')
    await userEvent.click(screen.getByRole('button', { name: 'Join Team' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again.')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText(/Members will see you as/)).toHaveTextContent('Ada')

    await userEvent.click(screen.getByRole('button', { name: 'Join Team' }))
    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
    expect(h.saveName).toHaveBeenCalledTimes(1)
  })

  test('an over-length name blocks joining until it is shortened', async () => {
    renderPage()
    await screen.findByText(/invited you to join/)
    await userEvent.click(nameField())
    await userEvent.paste('x'.repeat(81))
    expect(screen.getByRole('alert')).toHaveTextContent(/at most 80/)
    expect(screen.getByRole('button', { name: 'Join Team' })).toBeDisabled()
  })

  test('an Account that already has a name is not asked again', async () => {
    h.loadName.mockResolvedValue({ ok: true, data: 'Grace' })
    renderPage()
    expect(await screen.findByText(/Members will see you as/)).toHaveTextContent('Grace')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  test('if the name cannot be read, the prompt is skipped rather than blocking the join', async () => {
    h.loadName.mockResolvedValue({ ok: false, message: 'offline' })
    renderPage()
    await screen.findByText(/invited you to join/)
    expect(screen.queryByRole('textbox')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Join Team' }))
    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
  })
})
