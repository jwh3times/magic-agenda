import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import type { AuthGateway, RedeemType } from './authGateway'
import type { AuthOutcome, AuthResult, SignUpOutcome } from './authOutcome'
import type { AssuranceLevels, TotpEnrollment, TotpFactor } from './mfa'

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
    enrollTotp: string[]
    verifyTotp: Array<[factorId: string, code: string]>
    listTotpFactors: number
    unenrollFactor: string[]
    getAssuranceLevel: number
  }
  /** What each action returns next. Mutate before triggering the call. */
  next: {
    signIn: Pending<AuthOutcome>
    signUp: Pending<SignUpOutcome>
    sendPasswordReset: Pending<AuthOutcome>
    startGoogleSignIn: Pending<AuthOutcome>
    setPassword: Pending<AuthOutcome>
    redeemToken: Pending<AuthOutcome>
    enrollTotp: Pending<AuthResult<TotpEnrollment>>
    verifyTotp: Pending<AuthOutcome>
    listTotpFactors: Pending<AuthResult<TotpFactor[]>>
    unenrollFactor: Pending<AuthOutcome>
    /**
     * What the gate reads. Default `aal1`/`aal1` — a user with no factor — so every existing test
     * that renders a signed-in route keeps rendering it.
     */
    getAssuranceLevel: Pending<AuthResult<AssuranceLevels>>
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
    enrollTotp: [],
    verifyTotp: [],
    listTotpFactors: 0,
    unenrollFactor: [],
    getAssuranceLevel: 0,
  }

  const next: FakeAuth['next'] = {
    signIn: { ok: true },
    signUp: { ok: true, confirmationRequired: false },
    sendPasswordReset: { ok: true },
    startGoogleSignIn: { ok: true },
    setPassword: { ok: true },
    redeemToken: { ok: true },
    enrollTotp: {
      ok: true,
      data: {
        factorId: 'factor-1',
        qrCodeSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        secret: 'JBSWY3DPEHPK3PXP',
        uri: 'otpauth://totp/Magic%20Agenda:u1@example.test?secret=JBSWY3DPEHPK3PXP',
      },
    },
    verifyTotp: { ok: true },
    listTotpFactors: { ok: true, data: [] },
    unenrollFactor: { ok: true },
    getAssuranceLevel: { ok: true, data: { current: 'aal1', next: 'aal1' } },
  }

  const gateway: AuthGateway = {
    getSession() {
      calls.getSession += 1
      return Promise.resolve(initial)
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
    signOut() {
      calls.signOut += 1
      return Promise.resolve()
    },
    async enrollTotp(friendlyName) {
      calls.enrollTotp.push(friendlyName)
      return next.enrollTotp
    },
    async verifyTotp(factorId, code) {
      calls.verifyTotp.push([factorId, code])
      return next.verifyTotp
    },
    async listTotpFactors() {
      calls.listTotpFactors += 1
      return next.listTotpFactors
    },
    async unenrollFactor(factorId) {
      calls.unenrollFactor.push(factorId)
      return next.unenrollFactor
    },
    async getAssuranceLevel() {
      calls.getAssuranceLevel += 1
      return next.getAssuranceLevel
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
