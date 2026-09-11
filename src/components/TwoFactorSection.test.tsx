import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { fakeAuthGateway, fakeSession, type FakeAuth } from '../auth/fakeAuthGateway'
import type { TotpFactor } from '../auth/mfa'
import { TwoFactorSection } from './TwoFactorSection'

/**
 * Driven through the real `AuthProvider` and the fake adapter, like the rest of the auth suite —
 * a hand-built `vi.mock` of `useAuth` here would be four stubs that nothing keeps in step with
 * the six methods this component actually calls.
 */

let fake: FakeAuth

function factor(over: Partial<TotpFactor> = {}): TotpFactor {
  return {
    id: 'factor-1',
    name: 'Authenticator',
    verified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  fake = fakeAuthGateway({ session: fakeSession() })
})

function renderSection() {
  return render(
    <AuthProvider gateway={fake.gateway}>
      <TwoFactorSection />
    </AuthProvider>,
  )
}

const addButton = () => screen.getByRole('button', { name: 'Add authenticator app' })

test('an account with no factor is invited to add one', async () => {
  renderSection()
  expect(await screen.findByText(/Add an authenticator app to require/)).toBeInTheDocument()
  expect(addButton()).toBeInTheDocument()
})

test('enrolling shows the QR and the typed-by-hand key, then verifies against the new factor', async () => {
  const user = userEvent.setup()
  renderSection()
  await user.click(await screen.findByRole('button', { name: 'Add authenticator app' }))

  const qr = await screen.findByAltText(/QR code for enrolling/)
  // Percent-encoded, not the vendor's raw prepend: a `#` in the SVG would end the URL early.
  expect(qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
  expect(screen.getByLabelText('Or enter this key by hand')).toHaveValue('JBSWY3DPEHPK3PXP')

  fake.next.listTotpFactors = { ok: true, data: [factor()] }
  await user.type(screen.getByLabelText('Six-digit code'), '123456')
  await user.click(screen.getByRole('button', { name: 'Turn on two-factor' }))

  expect(fake.calls.verifyTotp).toEqual([['factor-1', '123456']])
  expect(await screen.findByText(/You’ll be asked for a six-digit code/)).toBeInTheDocument()
})

test('the new factor is named so it cannot collide with one already enrolled', async () => {
  // GoTrue rejects a duplicate friendly_name. Numbering past what exists is why there is no name
  // field for the user to fill in.
  fake.next.listTotpFactors = { ok: true, data: [factor()] }
  const user = userEvent.setup()
  renderSection()
  await user.click(await screen.findByRole('button', { name: 'Add authenticator app' }))
  expect(fake.calls.enrollTotp).toEqual(['Authenticator 2'])
})

test('cancelling an enrollment removes the factor it created', async () => {
  // `enroll` writes a real, unverified factor immediately. Abandoning it without unenrolling
  // would burn one of the account's ten slots every time the form is opened and closed.
  const user = userEvent.setup()
  renderSection()
  await user.click(await screen.findByRole('button', { name: 'Add authenticator app' }))
  await user.click(await screen.findByRole('button', { name: 'Cancel' }))

  expect(fake.calls.unenrollFactor).toEqual(['factor-1'])
  await waitFor(() => expect(addButton()).toBeInTheDocument())
})

test('a leaked unverified factor is listed so it can be cleared', async () => {
  // The list deliberately does not filter to verified factors: one left behind by a closed tab
  // still counts against the limit, and nothing else in the app can remove it.
  fake.next.listTotpFactors = { ok: true, data: [factor({ verified: false })] }
  renderSection()
  expect(await screen.findByText('not finished — remove it')).toBeInTheDocument()
  // And it is not reported as protecting the account.
  expect(screen.getByText(/Add an authenticator app to require/)).toBeInTheDocument()
})

test('a wrong code during enrollment is reported and the field cleared', async () => {
  fake.next.verifyTotp = {
    ok: false,
    failure: { reason: 'invalid-code', message: 'That code isn’t right.' },
  }
  const user = userEvent.setup()
  renderSection()
  await user.click(await screen.findByRole('button', { name: 'Add authenticator app' }))
  await user.type(await screen.findByLabelText('Six-digit code'), '000000')
  await user.click(screen.getByRole('button', { name: 'Turn on two-factor' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('That code isn’t right.')
  expect(screen.getByLabelText('Six-digit code')).toHaveValue('')
  // Still enrolling — a rejected code must not silently drop the secret the user just scanned.
  expect(screen.getByAltText(/QR code for enrolling/)).toBeInTheDocument()
})

test('removing an enrolled factor takes a confirmation', async () => {
  fake.next.listTotpFactors = { ok: true, data: [factor()] }
  const user = userEvent.setup()
  renderSection()

  await user.click(await screen.findByRole('button', { name: 'Remove' }))
  expect(fake.calls.unenrollFactor).toEqual([])
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(fake.calls.unenrollFactor).toEqual(['factor-1'])
})

test('the no-backup-codes warning appears only once a factor actually protects the account', async () => {
  fake.next.listTotpFactors = { ok: true, data: [factor()] }
  renderSection()
  expect(await screen.findByText(/issues no backup codes/)).toBeInTheDocument()
})

test('a failed enrollment is reported rather than opening an empty form', async () => {
  fake.next.enrollTotp = {
    ok: false,
    failure: { reason: 'too-many-factors', message: 'You’ve reached the limit.' },
  }
  const user = userEvent.setup()
  renderSection()
  await user.click(await screen.findByRole('button', { name: 'Add authenticator app' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('You’ve reached the limit.')
  expect(screen.queryByAltText(/QR code for enrolling/)).not.toBeInTheDocument()
})
