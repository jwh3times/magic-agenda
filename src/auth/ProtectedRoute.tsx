import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from './AuthProvider'
import { Spinner } from '../components/Spinner'
import { useOnline } from '../lib/useOnline'
import { hasBoardSnapshot } from '../data/snapshot'
import { readLastUserId } from '../lib/lastUser'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading, passwordRecovery } = useAuth()
  const online = useOnline()
  if (loading) return <Spinner />
  if (!session) {
    // supabase-js normally keeps a persisted session when a refresh fails on the network, but
    // it is free to drop one, and a login form that cannot reach the network is a dead end.
    // Render the last-known board read-only instead. Not an authorization decision: the data
    // is already on this device, and every write offline fails regardless.
    if (!online && hasBoardSnapshot(readLastUserId())) return <>{children}</>
    return <Navigate to="/login" replace />
  }
  // A recovery-link session must set a new password before reaching the board.
  if (passwordRecovery) return <Navigate to="/auth/reset" replace />
  return <>{children}</>
}
