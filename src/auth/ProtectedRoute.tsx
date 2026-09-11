import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from './AuthProvider'
import { MfaChallenge } from './MfaChallenge'
import { Spinner } from '../components/Spinner'
import { useOnline } from '../lib/useOnline'
import { hasAnyBoardSnapshot } from '../data/snapshot'
import { readLastUserId } from '../lib/lastUser'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading, passwordRecovery, stepUpRequired } = useAuth()
  const online = useOnline()
  if (loading) return <Spinner />
  if (!session) {
    // supabase-js normally keeps a persisted session when a refresh fails on the network, but
    // it is free to drop one, and a login form that cannot reach the network is a dead end.
    // Render the last-known board read-only instead. Not an authorization decision: the data
    // is already on this device, and every write offline fails regardless.
    if (!online && !passwordRecovery && hasAnyBoardSnapshot(readLastUserId()))
      return <>{children}</>
    return <Navigate to="/login" replace />
  }
  // A recovery-link session must set a new password before reaching the board.
  if (passwordRecovery) return <Navigate to="/auth/reset" replace />
  // A session holding a verified TOTP factor owes a code before anything behind this route
  // renders. `null` is "not determined yet", and waiting it out is what keeps a gated sign-in
  // from painting the board for a frame before replacing it — see AuthProvider's `assurance`.
  if (stepUpRequired === null) return <Spinner />
  // Rendered here rather than redirected to, unlike the recovery gate above: there is no route
  // for it, so there is no URL a user can type to step around it.
  if (stepUpRequired) return <MfaChallenge />
  return <>{children}</>
}
