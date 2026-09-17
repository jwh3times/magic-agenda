import { supabase } from '../lib/supabase'
import type { FeatureFlag } from '../access/useFlags'

/**
 * The admin dashboard's only door to the database (#274). Every read is an aggregate RPC that
 * refuses unless the caller is a live admin on a two-factor session; nothing here can reach Task
 * content, and nothing here should ever be taught to.
 */

export interface AdminStats {
  accounts: number
  accountsWithMfa: number
  activeAccounts30d: number
  boards: number
  tasks: number
  completedTasks: number
  series: number
  /** Thirty UTC days, oldest first. */
  daily: { day: string; newAccounts: number; newTasks: number }[]
}

export interface AdminUser {
  id: string
  /** Null for an Account with no email identity (the generated type cannot say so). */
  email: string | null
  createdAt: string
  lastSignInAt: string | null
  hasMfa: boolean
  isAdmin: boolean
  ownedBoards: number
  ownedTasks: number
}

export interface AdminUserPage {
  users: AdminUser[]
  total: number
}

export type AdminResult<T> =
  { ok: true; data: T } | { ok: false; reason: 'forbidden' | 'failed'; message: string }

const INSUFFICIENT_PRIVILEGE = '42501'

function failure(error: { code?: string; message: string }): AdminResult<never> {
  return {
    ok: false,
    reason: error.code === INSUFFICIENT_PRIVILEGE ? 'forbidden' : 'failed',
    message: error.message,
  }
}

const isCount = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0

export function parseAdminStats(value: unknown): AdminStats | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const counts = [
    v.accounts,
    v.accounts_with_mfa,
    v.active_accounts_30d,
    v.boards,
    v.tasks,
    v.completed_tasks,
    v.series,
  ]
  if (!counts.every(isCount) || !Array.isArray(v.daily)) return null
  const daily: AdminStats['daily'] = []
  for (const entry of v.daily as unknown[]) {
    const d = (entry ?? {}) as Record<string, unknown>
    if (typeof d.day !== 'string' || !isCount(d.new_accounts) || !isCount(d.new_tasks)) return null
    daily.push({ day: d.day, newAccounts: d.new_accounts, newTasks: d.new_tasks })
  }
  return {
    accounts: v.accounts as number,
    accountsWithMfa: v.accounts_with_mfa as number,
    activeAccounts30d: v.active_accounts_30d as number,
    boards: v.boards as number,
    tasks: v.tasks as number,
    completedTasks: v.completed_tasks as number,
    series: v.series as number,
    daily,
  }
}

export async function loadAdminStats(): Promise<AdminResult<AdminStats>> {
  const { data, error } = await supabase.rpc('admin_stats')
  if (error) return failure(error)
  const stats = parseAdminStats(data)
  return stats
    ? { ok: true, data: stats }
    : { ok: false, reason: 'failed', message: 'Unexpected statistics response.' }
}

/** `page` is zero-based. */
export async function loadAdminUsers(
  page: number,
  pageSize: number,
): Promise<AdminResult<AdminUserPage>> {
  const { data, error } = await supabase.rpc('admin_users', {
    page_limit: pageSize,
    page_offset: page * pageSize,
  })
  if (error) return failure(error)
  const rows = data ?? []
  return {
    ok: true,
    data: {
      total: rows[0]?.total_count ?? 0,
      users: rows.map((row) => ({
        id: row.id,
        email: row.email ?? null,
        createdAt: row.created_at,
        lastSignInAt: row.last_sign_in_at ?? null,
        hasMfa: row.has_mfa,
        isAdmin: row.is_admin,
        ownedBoards: row.owned_boards,
        ownedTasks: row.owned_tasks,
      })),
    },
  }
}

/**
 * Keys are immutable through the Data API, and creating or deleting a flag stays in SQL (see
 * docs/runbooks/roles-and-feature-flags.md). An update that matches no row is never a success, but
 * it is not necessarily a refusal either: RLS hides a non-admin's target, and a flag deleted in SQL
 * since the list loaded looks the same.
 */
export async function saveFeatureFlag(
  key: string,
  patch: Partial<Pick<FeatureFlag, 'enabled' | 'description'>>,
): Promise<AdminResult<FeatureFlag>> {
  const { data, error } = await supabase
    .from('feature_flags')
    .update(patch)
    .eq('key', key)
    .select('key, enabled, description')
  if (error) return failure(error)
  const row = data?.[0]
  return row
    ? { ok: true, data: row }
    : {
        ok: false,
        reason: 'failed',
        message: 'The flag was not updated. It may have been deleted, or your admin role removed.',
      }
}
