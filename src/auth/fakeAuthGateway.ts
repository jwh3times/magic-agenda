import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import type { AuthGateway, RedeemType } from './authGateway'
import type { AuthOutcome, SignUpOutcome } from './authOutcome'

/**
 * The second adapter at the auth seam — the one that makes it a real seam rather than a
 * hypothetical one. Tests render the **real** `AuthProvider` with this in place of the GoTrue
 * adapter, so they exercise the provider's own wiring (the SIGNED_OUT cascade, the recovery flag,
 * the loading flip) instead of stubbing `useAuth` and drifting from it.
 *
 * Deliberately free of any test-framework import: it holds plain call logs and plain settable
 * results, so it can live beside the production adapter without dragging vitest into `src/`.
 * Nothing in the app imports it, so it never reaches the bundle.
 */

/** A `Session` with only the fields this app actually reads. */
export function fakeSession(userId = 'u1'): Session {
  return {
    access_token: 'fake-access-token',
    refresh_token: 'fake-refresh-token',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: userId,
      aud: 'authenticated',
      email: `${userId}@example.test`,
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    },
  } as unknown as Session
}

/** Each action resolves this. Assign a never-resolving promise to hold a call open. */
type Pending<T> = T | Promise<T>

export interface FakeAuth {
  /** Pass this to `<AuthProvider gateway={…}>`. Stable across renders. */
  gateway: AuthGateway
  calls: {
    getSession: number
    signIn: Array<[email: string, password: string]>
    signUp: Array<[email: string, password: string]>
    sendPasswordReset: string[]
    startGoogleSignIn: number
    setPassword: string[]
    redeemToken: Array<[tokenHash: string, type: RedeemType]>
    signOut: number
  }
  /** What each action returns next. Mutate before triggering the call. */
  next: {
    signIn: Pending<AuthOutcome>
    signUp: Pending<SignUpOutcome>
    sendPasswordReset: Pending<AuthOutcome>
    startGoogleSignIn: Pending<AuthOutcome>
    setPassword: Pending<AuthOutcome>
    redeemToken: Pending<AuthOutcome>
  }
  /** Push an auth state change to subscribers, exactly as GoTrue would. */
  emit(event: AuthChangeEvent, session: Session | null): void
  /** How many listeners are currently subscribed — proves teardown on unmount. */
  listenerCount(): number
}

export function fakeAuthGateway(options?: { session?: Session | null }): FakeAuth {
  let initial: Session | null = options?.session ?? null
  const listeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>()

  const calls: FakeAuth['calls'] = {
    getSession: 0,
    signIn: [],
    signUp: [],
    sendPasswordReset: [],
    startGoogleSignIn: 0,
    setPassword: [],
    redeemToken: [],
    signOut: 0,
  }

  const next: FakeAuth['next'] = {
    signIn: { ok: true },
    signUp: { ok: true, confirmationRequired: false },
    sendPasswordReset: { ok: true },
    startGoogleSignIn: { ok: true },
    setPassword: { ok: true },
    redeemToken: { ok: true },
  }

  const gateway: AuthGateway = {
    async getSession() {
      calls.getSession += 1
      return initial
    },
    onAuthStateChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async signIn(email, password) {
      calls.signIn.push([email, password])
      return next.signIn
    },
    async signUp(email, password) {
      calls.signUp.push([email, password])
      return next.signUp
    },
    async sendPasswordReset(email) {
      calls.sendPasswordReset.push(email)
      return next.sendPasswordReset
    },
    async startGoogleSignIn() {
      calls.startGoogleSignIn += 1
      return next.startGoogleSignIn
    },
    async setPassword(password) {
      calls.setPassword.push(password)
      return next.setPassword
    },
    async redeemToken(tokenHash, type) {
      calls.redeemToken.push([tokenHash, type])
      return next.redeemToken
    },
    async signOut() {
      calls.signOut += 1
    },
  }

  return {
    gateway,
    calls,
    next,
    emit(event, session) {
      initial = session
      for (const listener of listeners) listener(event, session)
    },
    listenerCount: () => listeners.size,
  }
}
