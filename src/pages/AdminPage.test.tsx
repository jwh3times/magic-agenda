import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import type { AdminResult, AdminStats, AdminUserPage } from '../admin/adminApi'

const h = vi.hoisted(() => ({
  role: { isAdmin: true, loading: false },
  flags: [] as { key: string; enabled: boolean; description: string }[],
  reloadFlags: vi.fn(),
  stats: vi.fn(),
  users: vi.fn(),
  saveFlag: vi.fn(),
}))

vi.mock('../access/useRole', () => ({ useRole: () => h.role }))
vi.mock('../access/useFlags', () => ({
  useFlags: () => ({ flags: h.flags, loading: false, reload: h.reloadFlags }),
}))
vi.mock('../admin/adminApi', () => ({
  loadAdminStats: h.stats,
  loadAdminUsers: h.users,
  saveFeatureFlag: h.saveFlag,
}))
vi.mock('../data/SettingsProvider', () => ({
  useSettingsContext: () => ({ settings: { theme: 'cork' }, loading: false }),
}))

import { ADMIN_PAGE_SIZE, AdminPage } from './AdminPage'

const STATS: AdminStats = {
  accounts: 42,
  accountsWithMfa: 5,
  activeAccounts30d: 17,
  boards: 50,
  tasks: 900,
  completedTasks: 400,
  series: 12,
  daily: [
    { day: '2026-09-15', newAccounts: 2, newTasks: 30 },
    { day: '2026-09-16', newAccounts: 1, newTasks: 11 },
  ],
}

function usersPage(total: number, emails: (string | null)[]): AdminResult<AdminUserPage> {
  return {
    ok: true,
    data: {
      total,
      users: emails.map((email, i) => ({
        id: `u${i}`,
        email,
        createdAt: '2026-09-01T12:00:00Z',
        lastSignInAt: i === 0 ? null : '2026-09-16T08:00:00Z',
        hasMfa: i === 0,
        isAdmin: false,
        ownedBoards: 1,
        ownedTasks: 7,
      })),
    },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  h.role = { isAdmin: true, loading: false }
  h.flags = []
  h.stats.mockResolvedValue({ ok: true, data: STATS })
  h.users.mockResolvedValue(usersPage(2, ['first@example.test', 'second@example.test']))
})

function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/" element={<p>board home</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('a non-admin is sent home without any admin read', async () => {
  h.role = { isAdmin: false, loading: false }
  renderAdmin()
  expect(await screen.findByText('board home')).toBeInTheDocument()
  expect(h.stats).not.toHaveBeenCalled()
  expect(h.users).not.toHaveBeenCalled()
})

test('shows aggregate counts and the 30-day series, newest day first', async () => {
  renderAdmin()
  const overview = await screen.findByRole('region', { name: 'Overview' })
  await within(overview).findByText('900')
  expect(within(overview).getByText('Accounts').nextSibling).toHaveTextContent('42')
  const rows = within(overview).getAllByRole('row')
  expect(rows[1]).toHaveTextContent('2026-09-16')
  expect(rows[2]).toHaveTextContent('2026-09-15')
})

test('lists accounts with dates and counts, and pages through them', async () => {
  h.users
    .mockResolvedValueOnce(usersPage(ADMIN_PAGE_SIZE + 1, ['first@example.test']))
    .mockResolvedValueOnce(usersPage(ADMIN_PAGE_SIZE + 1, ['last@example.test']))
  renderAdmin()
  const accounts = await screen.findByRole('region', { name: 'Accounts' })
  const row = (await within(accounts).findByText('first@example.test')).closest('tr')!
  expect(row).toHaveTextContent('2026-09-01')
  expect(row).toHaveTextContent('Never')
  expect(within(accounts).getByText(/Page 1 of 2/)).toBeInTheDocument()
  expect(within(accounts).getByRole('button', { name: 'Previous' })).toBeDisabled()

  await userEvent.click(within(accounts).getByRole('button', { name: 'Next' }))
  expect(await within(accounts).findByText('last@example.test')).toBeInTheDocument()
  expect(h.users).toHaveBeenLastCalledWith(1, ADMIN_PAGE_SIZE)
  expect(within(accounts).getByRole('button', { name: 'Next' })).toBeDisabled()
})

test('a database refusal explains the two-factor requirement instead of showing data', async () => {
  const refused = { ok: false, reason: 'forbidden', message: 'refused' } as const
  h.stats.mockResolvedValue(refused)
  h.users.mockResolvedValue(refused)
  renderAdmin()
  const alerts = await screen.findAllByRole('alert')
  expect(alerts).toHaveLength(2)
  for (const alert of alerts) expect(alert).toHaveTextContent(/two-factor session/)
})

test('toggles a flag and saves its description, then refreshes the flag list', async () => {
  h.flags = [{ key: 'beta_board', enabled: false, description: 'old' }]
  h.saveFlag.mockResolvedValue({
    ok: true,
    data: { key: 'beta_board', enabled: true, description: 'old' },
  })
  renderAdmin()
  const flags = screen.getByRole('region', { name: 'Feature flags' })

  await userEvent.click(within(flags).getByRole('checkbox', { name: 'beta_board' }))
  expect(h.saveFlag).toHaveBeenCalledWith('beta_board', { enabled: true })
  await waitFor(() => expect(h.reloadFlags).toHaveBeenCalledTimes(1))

  const save = within(flags).getByRole('button', { name: 'Save description' })
  expect(save).toBeDisabled()
  const input = within(flags).getByRole('textbox', { name: 'Description for beta_board' })
  await userEvent.clear(input)
  await userEvent.type(input, 'new rollout')
  await userEvent.click(save)
  expect(h.saveFlag).toHaveBeenLastCalledWith('beta_board', { description: 'new rollout' })
})

test('a failed flag write is shown, and the list is not refreshed as if it saved', async () => {
  h.flags = [{ key: 'beta_board', enabled: false, description: '' }]
  h.saveFlag.mockResolvedValue({ ok: false, reason: 'failed', message: 'It may have been deleted' })
  renderAdmin()
  const flags = screen.getByRole('region', { name: 'Feature flags' })
  await userEvent.click(within(flags).getByRole('checkbox', { name: 'beta_board' }))
  const alert = await within(flags).findByRole('alert')
  expect(alert).toHaveTextContent('It may have been deleted')
  expect(alert).not.toHaveTextContent(/two-factor/)
  expect(h.reloadFlags).not.toHaveBeenCalled()
})

test('a page emptied by deletions offers a way back instead of a wrong total', async () => {
  h.users
    .mockResolvedValueOnce(usersPage(ADMIN_PAGE_SIZE + 1, ['first@example.test']))
    .mockResolvedValueOnce(usersPage(0, []))
    .mockResolvedValueOnce(usersPage(1, [null]))
  renderAdmin()
  const accounts = await screen.findByRole('region', { name: 'Accounts' })
  await userEvent.click(await within(accounts).findByRole('button', { name: 'Next' }))
  expect(await within(accounts).findByText(/No accounts on this page/)).toBeInTheDocument()
  expect(within(accounts).queryByText(/0 accounts/)).not.toBeInTheDocument()

  await userEvent.click(within(accounts).getByRole('button', { name: 'First page' }))
  expect(await within(accounts).findByText('(no email)')).toBeInTheDocument()
  expect(h.users).toHaveBeenLastCalledWith(0, ADMIN_PAGE_SIZE)
})
