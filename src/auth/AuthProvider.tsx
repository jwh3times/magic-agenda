import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { clearBoardView } from '../lib/viewStorage'
import { clearSnapshots } from '../data/snapshot'
import { clearLastUserId, writeLastUserId } from '../lib/lastUser'

// Recovery-session marker. Persisted per-tab so a reload of /auth/reset can't
// silently drop the "must set a new password" gate (the PASSWORD_RECOVERY event
// only fires when the emailed link's hash is first parsed, never on reload).
const RECOVERY_FLAG_KEY = 'ma-password-recovery'

interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  /** True while the session came from a password-recovery link and hasn't set a new password. */
  passwordRecovery: boolean
  clearPasswordRecovery: () => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [passwordRecovery, setPasswordRecovery] = useState(
    () => sessionStorage.getItem(RECOVERY_FLAG_KEY) === '1',
  )

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session?.user.id) writeLastUserId(data.session.user.id)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      if (next?.user.id) writeLastUserId(next.user.id)
      if (event === 'PASSWORD_RECOVERY') {
        sessionStorage.setItem(RECOVERY_FLAG_KEY, '1')
        setPasswordRecovery(true)
      }
      // A recovery flow abandoned before setting a new password must not haunt the next sign-in.
      if (event === 'SIGNED_OUT') {
        sessionStorage.removeItem(RECOVERY_FLAG_KEY)
        setPasswordRecovery(false)
        // Next sign-in should land on the default view, not the signed-out user's last view.
        clearBoardView()
        // Task text at rest is acceptable only because it does not outlive the session on this
        // device. Account deletion signs out too, so it lands here as well.
        clearSnapshots()
        clearLastUserId()
      }
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const clearPasswordRecovery = useCallback(() => {
    sessionStorage.removeItem(RECOVERY_FLAG_KEY)
    setPasswordRecovery(false)
  }, [])

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        passwordRecovery,
        clearPasswordRecovery,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
