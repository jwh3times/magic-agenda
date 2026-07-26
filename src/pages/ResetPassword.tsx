import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import { useAuth } from '../auth/AuthProvider'
import { Spinner } from '../components/Spinner'
import { authCard, authField, authPage, authSubmit } from './authChrome'
import logoDark from '../assets/logo-dark.svg'

// Mirror of Login's SIGNUP_MIN_PASSWORD — the Supabase dashboard policy is the real control.
const MIN_PASSWORD = 10

/**
 * Password-recovery landing page. The emailed link carries ?token_hash=…&type=recovery,
 * redeemed here exactly once via verifyOtp — which fires PASSWORD_RECOVERY, so
 * AuthProvider raises the per-tab recovery flag. The form renders on
 * (session && passwordRecovery), never on "verifyOtp succeeded in this mount": the token
 * is single-use, and a reload or ProtectedRoute bounce after it is spent must still land
 * on the form. A non-recovery session never redeems (session-fixation guard).
 */
export function ResetPassword() {
  const { session, loading, passwordRecovery, clearPasswordRecovery } = useAuth()
  const navigate = useNavigate()
  // One-shot: capture the token at mount; the redeem effect scrubs it from the URL.
  const [tokenHash] = useState(() =>
    new URLSearchParams(window.location.search).get('token_hash'),
  )
  const redeemed = useRef(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Redeem exactly once: the token is single-use and StrictMode double-invokes
    // effects. Any existing session skips redemption entirely.
    if (loading || redeemed.current || session || !tokenHash) return
    redeemed.current = true
    window.history.replaceState(window.history.state, '', window.location.pathname)
    supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' }).then(({ error: err }) => {
      if (err) setVerifyError(errorMessage(err))
    })
  }, [loading, session, tokenHash])

  if (loading) return <Spinner />

  const showForm = Boolean(session) && passwordRecovery

  if (!showForm && session) {
    return (
      <div style={authPage}>
        <div style={authCard}>
          <img
            src={logoDark}
            alt="Magic Agenda"
            style={{ height: 110, display: 'block', margin: '0 0 6px' }}
          />
          <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5, opacity: 0.75 }}>
            You're already signed in, so this reset link wasn't used. To reset a password, sign
            out first and request a new link.
          </p>
          <Link to="/" style={{ color: '#a78bfa', fontWeight: 700, fontSize: 14 }}>
            Back to your board
          </Link>
        </div>
      </div>
    )
  }

  if (!showForm && tokenHash && !verifyError) return <Spinner label="Checking your reset link…" />

  if (!showForm) {
    return (
      <div style={authPage}>
        <div style={authCard}>
          <img
            src={logoDark}
            alt="Magic Agenda"
            style={{ height: 110, display: 'block', margin: '0 0 6px' }}
          />
          <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5, opacity: 0.75 }}>
            This password reset link is invalid or has expired. Request a new one from the sign-in
            page.
          </p>
          <Link to="/login" style={{ color: '#a78bfa', fontWeight: 700, fontSize: 14 }}>
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

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
    try {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) throw err
    } catch (err) {
      setError(errorMessage(err))
      return
    } finally {
      setBusy(false)
    }
    clearPasswordRecovery()
    navigate('/', { replace: true })
  }

  return (
    <div style={authPage}>
      <div style={authCard}>
        <img
          src={logoDark}
          alt="Magic Agenda"
          style={{ height: 110, display: 'block', margin: '0 0 6px' }}
        />
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
          <div style={{ fontSize: 12, opacity: 0.5, lineHeight: 1.4 }}>
            At least 10 characters, including upper- and lower-case letters, a number, and a symbol.
          </div>
          {error && <div style={{ color: '#ff8b8b', fontSize: 13, lineHeight: 1.4 }}>{error}</div>}
          <button
            type="submit"
            disabled={busy}
            style={{ ...authSubmit, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Please wait…' : 'Set new password'}
          </button>
        </form>
      </div>
    </div>
  )
}
