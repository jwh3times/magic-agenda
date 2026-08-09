import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { failed, type AuthOutcome, type SignUpOutcome } from './authOutcome'

/** The two emailed-link types this app redeems. `email_change` and `invite` are not used here. */
export type RedeemType = 'recovery' | 'signup'

/**
 * The seam between this app and GoTrue.
 *
 * Two invariants hold for **every** method, and they are the reason the interface is worth having:
 *
 * 1. **Nothing rejects.** Failures are values (`AuthOutcome`), never exceptions. Callers do not
 *    need `try`/`catch`, and — the bug this closes (#131) — a rejected fetch can no longer leave a
 *    page stuck on a spinner because someone forgot a `.catch`.
 * 2. **No vendor type crosses it in the failure direction.** Callers branch on `AuthFailure.reason`,
 *    never on a GoTrue message, status, or error class.
 *
 * `Session` still crosses in the success direction. Narrowing that would touch the eleven modules
 * that read `session`/`user` off the auth context and is deliberately out of scope here — see the
 * note in #133.
 *
 * Implementations must be **referentially stable**: `AuthProvider` lists the gateway in the deps of
 * the effect that subscribes to auth state, so a fresh object per render would resubscribe on every
 * render.
 */
export interface AuthGateway {
  /** Resolves `null` both when signed out and when the session could not be read. */
  getSession(): Promise<Session | null>
  /** Returns its own unsubscribe function — the vendor's `{ data: { subscription } }` stays inside. */
  onAuthStateChange(listener: (event: AuthChangeEvent, session: Session | null) => void): () => void
  signIn(email: string, password: string): Promise<AuthOutcome>
  signUp(email: string, password: string): Promise<SignUpOutcome>
  sendPasswordReset(email: string): Promise<AuthOutcome>
  startGoogleSignIn(): Promise<AuthOutcome>
  /** Sets the password of the *current* session's user. Requires a live session. */
  setPassword(password: string): Promise<AuthOutcome>
  /** Redeems an emailed `token_hash`. Single-use: a second call with the same token fails. */
  redeemToken(tokenHash: string, type: RedeemType): Promise<AuthOutcome>
  signOut(): Promise<void>
}

/**
 * Where GoTrue sends the user back to. These are the app's own routes and must stay in lockstep
 * with three other places: the route table in `App.tsx`, the `additional_redirect_urls` allow-list
 * in `supabase/config.toml`, and `{{ .RedirectTo }}` in `supabase/templates/*.html`. They were
 * built inline at four call sites in `Login.tsx` before this module existed.
 */
const ROUTES = {
  passwordReset: '/auth/reset',
  signupConfirm: '/auth/confirm',
  oauthCallback: '/auth/callback',
} as const

const absolute = (path: string) => `${window.location.origin}${path}`

/** The production adapter. Module-level, so it is referentially stable by construction. */
export const supabaseAuthGateway: AuthGateway = {
  async getSession() {
    try {
      const { data } = await supabase.auth.getSession()
      return data.session
    } catch {
      // A rejection here used to leave `loading` true forever, stranding the whole app on a
      // spinner. Degrading to "signed out" is correct: the offline board reads the last-known
      // user id from localStorage, and every write is gated on a live session anyway.
      return null
    }
  },

  onAuthStateChange(listener) {
    const { data } = supabase.auth.onAuthStateChange(listener)
    return () => data.subscription.unsubscribe()
  },

  async signIn(email, password) {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return failed(error)
      return { ok: true }
    } catch (e) {
      return failed(e)
    }
  },

  async signUp(email, password) {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        // `{{ .RedirectTo }}` in the confirmation template resolves from this option.
        options: { emailRedirectTo: absolute(ROUTES.signupConfirm) },
      })
      if (error) return failed(error)
      // No session means GoTrue is waiting on the emailed confirmation link.
      return { ok: true, confirmationRequired: !data.session }
    } catch (e) {
      return failed(e)
    }
  },

  async sendPasswordReset(email) {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: absolute(ROUTES.passwordReset),
      })
      if (error) return failed(error)
      return { ok: true }
    } catch (e) {
      return failed(e)
    }
  },

  async startGoogleSignIn() {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: absolute(ROUTES.oauthCallback) },
      })
      if (error) return failed(error)
      return { ok: true }
    } catch (e) {
      return failed(e)
    }
  },

  async setPassword(password) {
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) return failed(error)
      return { ok: true }
    } catch (e) {
      return failed(e)
    }
  },

  async redeemToken(tokenHash, type) {
    try {
      // Ordering invariant, pinned by verifyOtpContract.test.ts: for `type: 'recovery'` this
      // emits PASSWORD_RECOVERY to onAuthStateChange subscribers BEFORE it resolves, which is
      // what lets AuthProvider raise the per-tab recovery flag in time for ResetPassword's gate.
      // Do not move this call behind an extra tick or wrap it in something that defers.
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      if (error) return failed(error)
      return { ok: true }
    } catch (e) {
      return failed(e)
    }
  },

  async signOut() {
    try {
      await supabase.auth.signOut()
    } catch {
      // Sign-out is best-effort: the SIGNED_OUT cascade in AuthProvider (clearing the board
      // snapshot, the last-user id, and the saved view) matters more than the network round trip,
      // and auth-js clears local storage before it calls the endpoint.
    }
  },
}
