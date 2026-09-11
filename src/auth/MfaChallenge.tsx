import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from './AuthProvider'
import type { TotpFactor } from './mfa'
import logoDark from '../assets/logo-dark.svg'
import {
  authCard,
  authField,
  authLinkBtn,
  authLogo,
  authPage,
  authSubmit,
} from '../pages/authChrome'

/** GoTrue's TOTP codes are always six digits; `[auth.mfa.totp]` exposes no length to configure. */
const CODE_LENGTH = 6

/**
 * The step-up prompt: a session that holds a verified factor but has not presented a code yet.
 *
 * Rendered **in place** by `ProtectedRoute` rather than reached by a redirect, which is the one
 * structural difference from the password-recovery gate beside it. A route can be navigated away
 * from; this cannot, because there is no URL that corresponds to it.
 *
 * Sign out is not decoration. Supabase issues no backup codes, so a user who cannot produce one —
 * lost phone, wiped authenticator — needs a way off this screen that is not closing the tab, and
 * signing out is the only one the client can offer.
 */
export function MfaChallenge() {
  const { listTotpFactors, verifyTotp, signOut } = useAuth()
  const [factors, setFactors] = useState<TotpFactor[] | null>(null)
  const [factorId, setFactorId] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // One network read, and only on this screen. Reaching it at all means a password sign-in has
  // just succeeded, so the connection that produced the session is the one this borrows.
  useEffect(() => {
    let active = true
    void listTotpFactors().then((result) => {
      if (!active) return
      if (!result.ok) {
        setError(result.failure.message)
        setFactors([])
        return
      }
      const verified = result.data.filter((f) => f.verified)
      setFactors(verified)
      setFactorId(verified[0]?.id ?? '')
    })
    return () => {
      active = false
    }
  }, [listTotpFactors])

  // Nothing to do on success: `verify` saves the raised session and GoTrue emits
  // MFA_CHALLENGE_VERIFIED, so AuthProvider re-reads the assurance level and this screen is
  // replaced by the board. Navigating here ourselves would race that.
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const outcome = await verifyTotp(factorId, code)
    if (!outcome.ok) {
      setError(outcome.failure.message)
      setCode('')
    }
    setBusy(false)
  }

  const ready = factorId !== '' && code.length === CODE_LENGTH && !busy

  return (
    <div style={authPage}>
      <main style={authCard}>
        <h1 style={{ margin: '0 0 6px' }}>
          <img src={logoDark} alt="Magic Agenda" style={authLogo} />
        </h1>
        <p style={{ margin: '0 0 22px', opacity: 0.55, fontSize: 14 }}>
          Enter the six-digit code from your authenticator app.
        </p>

        <form onSubmit={(e) => void submit(e)} style={{ display: 'grid', gap: 10 }}>
          {/* A code is only valid for the factor that generated it, so several enrolled apps
              need naming rather than guessing. One is the overwhelmingly common case and gets
              no control at all. */}
          {factors !== null && factors.length > 1 && (
            <>
              <label htmlFor="mfa-factor" style={{ fontSize: 13, opacity: 0.7 }}>
                Authenticator
              </label>
              <select
                id="mfa-factor"
                value={factorId}
                onChange={(e) => setFactorId(e.target.value)}
                disabled={busy}
                style={authField}
              >
                {factors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name ?? 'Authenticator app'}
                  </option>
                ))}
              </select>
            </>
          )}

          <input
            aria-label="Six-digit code"
            value={code}
            // Digits only, and truncated rather than rejected: a paste of "123 456" should become
            // a usable code instead of silently doing nothing.
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            disabled={busy || factors === null}
            style={{ ...authField, letterSpacing: '0.35em', textAlign: 'center' }}
          />

          {/* The session says a factor is owed and the account says none exists — which happens
              when the last one is removed on another device between this sign-in and this render.
              Without this the Verify button is simply disabled forever, with nothing on screen
              saying why and no code that could ever enable it. */}
          {!error && factors !== null && factors.length === 0 && (
            <div role="alert" style={{ color: '#ff9d9d', fontSize: 13 }}>
              No authenticator app is enrolled on this account any more. Sign in again to continue.
            </div>
          )}

          {error && (
            <div role="alert" style={{ color: '#ff9d9d', fontSize: 13 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!ready}
            style={{ ...authSubmit, opacity: ready ? 1 : 0.55 }}
          >
            {busy ? 'Verifying…' : 'Verify'}
          </button>
        </form>

        <p style={{ margin: '18px 0 0', fontSize: 13, opacity: 0.55, lineHeight: 1.5 }}>
          Lost access to your authenticator? There are no backup codes — contact support to have
          two-factor removed from your account.
        </p>
        <button
          type="button"
          onClick={() => void signOut()}
          style={{ ...authLinkBtn, marginTop: 10 }}
        >
          Sign out
        </button>
      </main>
    </div>
  )
}
