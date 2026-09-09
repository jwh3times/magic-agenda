import { supabase } from '../lib/supabase'
import { useLiveAccess } from './useLiveAccess'

export type AccountRole = 'admin' | null

async function readRole(userId: string): Promise<AccountRole> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data?.role === 'admin' ? 'admin' : null
}

/** This app role grants no Board permissions and is never read from JWT claims. */
export function useRole() {
  const { value: role, ...state } = useLiveAccess(readRole, null)
  return { role, isAdmin: role === 'admin', ...state }
}
