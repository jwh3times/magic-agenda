import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Spinner } from '../components/Spinner'

/**
 * OAuth landing route. The client parses tokens from the URL (detectSessionInUrl),
 * which fires onAuthStateChange; once the session resolves we leave for the board.
 */
export function AuthCallback() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading) navigate(session ? '/' : '/login', { replace: true })
  }, [loading, session, navigate])

  return <Spinner label="Signing you in…" />
}
