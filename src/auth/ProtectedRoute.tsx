import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { Spinner } from '../components/Spinner'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading, passwordRecovery } = useAuth()
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  // A recovery-link session must set a new password before reaching the board.
  if (passwordRecovery) return <Navigate to="/auth/reset" replace />
  return <>{children}</>
}
