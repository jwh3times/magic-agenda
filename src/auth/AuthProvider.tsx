import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabaseAuthGateway, type AuthGateway, type RedeemType } from './authGateway'
import type { AuthOutcome, SignUpOutcome } from './authOutcome'
import { clearBoardView } from '../lib/viewStorage'
import { clearSnapshots } from '../data/snapshot'
import { clearLastUserId, writeLastUserId } from '../lib/lastUser'

// Recovery-session marker. Persisted per-tab so a reload of /auth/reset can't
// silently drop the "must set a new password" gate (the PASSWORD_RECOVERY event
// only fires when the emailed link is first redeemed, never on reload).
const RECOVERY_FLAG_KEY = 'ma-password-recovery'

/**
 * The auth interface for the whole app: session state *and* the actions that change it.
 *
 * Actions were page-local `supabase.auth.*` calls until #133 — seven of the ten call sites lived
 * in `Login`, `ResetPassword`, and `AuthConfirm`, which is why the redeem guard, the error copy,
 * and the redirect rule each had three-to-five encodings. Every action here resolves an outcome
 * and never rejects; see `AuthGateway`.
 *
 * `passwordRecovery` is per-tab (`sessionStorage`) while the last-user id and the offline
 * snapshots are per-device (`localStorage`) — a distinction callers cannot see from the types.
 */
interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  /** True while the session came from a password-recovery link and hasn't set a new password. */
  passwordRecovery: boolean
  clearPasswordRecovery: () => void
  signIn: (email: string, password: string) => Promise<AuthOutcome>
  signUp: (email: string, password: string) => Promise<SignUpOutcome>
  sendPasswordReset: (email: string) => Promise<AuthOutcome>
  startGoogleSignIn: () => Promise<AuthOutcome>
  setPassword: (password: string) => Promise<AuthOutcome>
  redeemToken: (tokenHash: string, type: RedeemType) => Promise<AuthOutcome>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * `gateway` is the seam's injection point: production gets the GoTrue-backed adapter, tests pass
 * `fakeAuthGateway()`. It must be **referentially stable** — it is a dependency of the effect that
 * subscribes to auth state, so a fresh object per render would resubscribe on every render.
 */
export function AuthProvider({
  children,
  gateway = supabaseAuthGateway,
}: {
  children: ReactNode
  gateway?: AuthGateway
}) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [passwordRecovery, setPasswordRecovery] = useState(
    () => sessionStorage.getItem(RECOVERY_FLAG_KEY) === '1',
  )

  useEffect(() => {
    let active = true
    void gateway.getSession().then((initial) => {
      if (!active) return
      setSession(initial)
      if (initial?.user.id) writeLastUserId(initial.user.id)
      setLoading(false)
    })
    const unsubscribe = gateway.onAuthStateChange((event, next) => {
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
        // Task text at rest is acceptable only because it does not outlive an explicit sign-out
        // on this device — a session that simply vanishes (offline, expiry, a dropped refresh)
        // leaves the snapshot in place on purpose, since that's what the offline board reads.
        // Account deletion signs out too, so it lands here as well.
        clearSnapshots()
        clearLastUserId()
      }
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [gateway])

  const clearPasswordRecovery = useCallback(() => {
    sessionStorage.removeItem(RECOVERY_FLAG_KEY)
    setPasswordRecovery(false)
  }, [])

  // Wrapped rather than passed through, so an adapter that uses `this` still works — and memoized
  // on `gateway` so the identities stay stable for effect dependencies (`useTokenRedemption`).
  const actions = useMemo(
    () => ({
      signIn: (email: string, password: string) => gateway.signIn(email, password),
      signUp: (email: string, password: string) => gateway.signUp(email, password),
      sendPasswordReset: (email: string) => gateway.sendPasswordReset(email),
      startGoogleSignIn: () => gateway.startGoogleSignIn(),
      setPassword: (password: string) => gateway.setPassword(password),
      redeemToken: (tokenHash: string, type: RedeemType) => gateway.redeemToken(tokenHash, type),
      signOut: () => gateway.signOut(),
    }),
    [gateway],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      passwordRecovery,
      clearPasswordRecovery,
      ...actions,
    }),
    [session, loading, passwordRecovery, clearPasswordRecovery, actions],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// oxlint-disable-next-line react/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
