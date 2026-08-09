import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { useTokenRedemption } from '../auth/redemption'
import { MIN_PASSWORD, PASSWORD_RULE } from '../auth/passwordPolicy'
import { Spinner } from '../components/Spinner'
import { authCard, authField, authLogo, authPage, authSubmit } from './authChrome'
import logoDark from '../assets/logo-dark.svg'

/**
 * Password-recovery landing page. The emailed link carries ?token_hash=…&type=recovery, redeemed
 * exactly once by `useTokenRedemption` — which fires PASSWORD_RECOVERY, so AuthProvider raises the
 * per-tab recovery flag.
 *
 * The form renders on (session && passwordRecovery), never on "redemption succeeded in this
 * mount": the token is single-use, and a reload or ProtectedRoute bounce after it is spent must
 * still land on the form. A non-recovery session never redeems — that guard lives in
 * `redeemDecision`, shared with AuthConfirm.
 */
export function ResetPassword() {
  const {
    session,
    loading,
    passwordRecovery,
    clearPasswordRecovery,
    setPassword: setAccountPassword,
  } = useAuth()
  const navigate = useNavigate()
  const redemption = useTokenRedemption('recovery')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`)
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    const outcome = await setAccountPassword(password)
    setBusy(false)
    if (!outcome.ok) {
      setError(outcome.failure.message)
      return
    }
    clearPasswordRecovery()
    navigate('/', { replace: true })
  }

  if (loading) return <Spinner />

  const showForm = Boolean(session) && passwordRecovery

  if (showForm) {
    return (
      <div style={authPage}>
        <main style={authCard}>
          <h1 style={{ margin: '0 0 6px' }}>
            <img src={logoDark} alt="Magic Agenda" style={authLogo} />
          </h1>
          <p style={{ margin: '0 0 22px', opacity: 0.55, fontSize: 14 }}>
            Choose a new password for your account.
          </p>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <input
              type="password"
              required
              minLength={MIN_PASSWORD}
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={authField}
            />
            <input
              type="password"
              required
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              style={authField}
            />
            <div style={{ fontSize: 12, opacity: 0.5, lineHeight: 1.4 }}>{PASSWORD_RULE}</div>
            {error && (
              <div style={{ color: '#ff8b8b', fontSize: 13, lineHeight: 1.4 }}>{error}</div>
            )}
            <button
              type="submit"
              disabled={busy}
              style={{
                ...authSubmit,
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? 'Please wait…' : 'Set new password'}
            </button>
          </form>
        </main>
      </div>
    )
  }

  // An existing, non-recovery session: nothing was redeemed. The copy splits on whether there was
  // actually a link to refuse — telling a signed-in user with no link that their "reset link
  // wasn't used" was a real wrong claim before the guard moved into `redeemDecision`.
  if (redemption.status === 'refused') {
    return (
      <div style={authPage}>
        <main style={authCard}>
          <h1 style={{ margin: '0 0 6px' }}>
            <img src={logoDark} alt="Magic Agenda" style={authLogo} />
          </h1>
          <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5, opacity: 0.75 }}>
            {redemption.hadToken
              ? 'You’re already signed in, so this reset link wasn’t used. To reset a password, sign out first and request a new link.'
              : 'You’re already signed in. To reset your password, sign out first and request a new link.'}
          </p>
          <Link to="/" style={{ color: '#a78bfa', fontWeight: 700, fontSize: 14 }}>
            Back to your board
          </Link>
        </main>
      </div>
    )
  }

  // 'done' with no form yet means the redemption resolved but PASSWORD_RECOVERY hasn't landed.
  // Holding the spinner beats falling through to the expired card and making a false claim about
  // a link that just worked. (The event ordering that makes this transient is pinned by
  // verifyOtpContract.test.ts.)
  if (redemption.status === 'redeeming' || redemption.status === 'done')
    return <Spinner label="Checking your reset link…" />

  // A link that could not be checked is not a link that expired — #131. Saying "expired" here
  // would send a user with a perfectly good link off to request another one.
  if (redemption.failure?.reason === 'offline') {
    return (
      <div style={authPage}>
        <main style={authCard}>
          <h1 style={{ margin: '0 0 6px' }}>
            <img src={logoDark} alt="Magic Agenda" style={authLogo} />
          </h1>
          <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5, opacity: 0.75 }}>
            Couldn’t reach the server to check your reset link. Check your connection and open the
            link again — it hasn’t been used.
          </p>
          <Link to="/login" style={{ color: '#a78bfa', fontWeight: 700, fontSize: 14 }}>
            Back to sign in
          </Link>
        </main>
      </div>
    )
  }

  return (
    <div style={authPage}>
      <main style={authCard}>
        <h1 style={{ margin: '0 0 6px' }}>
          <img src={logoDark} alt="Magic Agenda" style={authLogo} />
        </h1>
        <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5, opacity: 0.75 }}>
          This password reset link is invalid or has expired. Request a new one from the sign-in
          page.
        </p>
        <Link to="/login" style={{ color: '#a78bfa', fontWeight: 700, fontSize: 14 }}>
          Back to sign in
        </Link>
      </main>
    </div>
  )
}
