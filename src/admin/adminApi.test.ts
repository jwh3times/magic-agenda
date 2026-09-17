import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  updates: [] as { payload: Record<string, unknown>; key: unknown }[],
  updateResult: { data: [] as unknown[], error: null },
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: h.rpc,
    from: () => ({
      update: (payload: Record<string, unknown>) => ({
        eq: (_column: string, key: unknown) => ({
          select: () => {
            h.updates.push({ payload, key })
            return Promise.resolve(h.updateResult)
          },
        }),
      }),
    }),
  },
}))

import { loadAdminStats, loadAdminUsers, parseAdminStats, saveFeatureFlag } from './adminApi'

const STATS = {
  accounts: 12,
  accounts_with_mfa: 3,
  active_accounts_30d: 7,
  boards: 14,
  tasks: 480,
  completed_tasks: 200,
  series: 9,
  daily: [
    { day: '2026-09-15', new_accounts: 0, new_tasks: 4 },
    { day: '2026-09-16', new_accounts: 1, new_tasks: 2 },
  ],
}

beforeEach(() => {
  h.rpc.mockReset()
  h.updates = []
  h.updateResult = { data: [], error: null }
})

test('parses the aggregate stats payload into app names', () => {
  expect(parseAdminStats(STATS)).toEqual({
    accounts: 12,
    accountsWithMfa: 3,
    activeAccounts30d: 7,
    boards: 14,
    tasks: 480,
    completedTasks: 200,
    series: 9,
    daily: [
      { day: '2026-09-15', newAccounts: 0, newTasks: 4 },
      { day: '2026-09-16', newAccounts: 1, newTasks: 2 },
    ],
  })
})

test('rejects a malformed stats payload instead of rendering guesses', () => {
  expect(parseAdminStats(null)).toBeNull()
  expect(parseAdminStats({ ...STATS, tasks: '480' })).toBeNull()
  expect(parseAdminStats({ ...STATS, daily: [{ day: '2026-09-16', new_accounts: 1 }] })).toBeNull()
  expect(parseAdminStats({ ...STATS, daily: 'nope' })).toBeNull()
})

test('a database refusal is reported as forbidden, not as a generic failure', async () => {
  h.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'refused' } })
  expect(await loadAdminStats()).toEqual({ ok: false, reason: 'forbidden', message: 'refused' })
  h.rpc.mockResolvedValue({ data: null, error: { code: '08006', message: 'offline' } })
  expect(await loadAdminStats()).toEqual({ ok: false, reason: 'failed', message: 'offline' })
  h.rpc.mockResolvedValue({ data: { accounts: 1 }, error: null })
  expect(await loadAdminStats()).toMatchObject({ ok: false, reason: 'failed' })
})

test('loads one page of accounts with the total for paging', async () => {
  h.rpc.mockResolvedValue({
    data: [
      {
        id: 'u1',
        email: 'a@example.test',
        created_at: '2026-09-16T10:00:00Z',
        last_sign_in_at: null,
        has_mfa: true,
        is_admin: false,
        owned_boards: 1,
        owned_tasks: 5,
        total_count: 51,
      },
    ],
    error: null,
  })
  expect(await loadAdminUsers(2, 25)).toEqual({
    ok: true,
    data: {
      total: 51,
      users: [
        {
          id: 'u1',
          email: 'a@example.test',
          createdAt: '2026-09-16T10:00:00Z',
          lastSignInAt: null,
          hasMfa: true,
          isAdmin: false,
          ownedBoards: 1,
          ownedTasks: 5,
        },
      ],
    },
  })
  expect(h.rpc).toHaveBeenCalledWith('admin_users', { page_limit: 25, page_offset: 50 })
})

test('an empty page past the end still reports success', async () => {
  h.rpc.mockResolvedValue({ data: [], error: null })
  expect(await loadAdminUsers(9, 25)).toEqual({ ok: true, data: { total: 0, users: [] } })
})

test('a flag write that RLS filters to no rows is forbidden, not silently successful', async () => {
  expect(await saveFeatureFlag('beta', { enabled: true })).toMatchObject({
    ok: false,
    reason: 'forbidden',
  })
  h.updateResult = { data: [{ key: 'beta', enabled: true, description: 'x' }], error: null }
  expect(await saveFeatureFlag('beta', { enabled: true })).toEqual({
    ok: true,
    data: { key: 'beta', enabled: true, description: 'x' },
  })
  expect(h.updates[h.updates.length - 1]).toEqual({ payload: { enabled: true }, key: 'beta' })
})
