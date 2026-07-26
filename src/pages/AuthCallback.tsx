import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { Spinner } from '../components/Spinner'

/**
 * OAuth landing route. Google returns ?code=…, which auth-js exchanges via PKCE
 * (using the code-verifier stored when sign-in started); that fires
 * onAuthStateChange, and once the session resolves we leave for the board.
 * Implicit-flow fragment tokens are never adopted — see src/lib/supabase.ts.
 */
export function AuthCallback() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading) navigate(session ? '/' : '/login', { replace: true })
  }, [loading, session, navigate])

  return <Spinner label="Signing you in…" />
}
