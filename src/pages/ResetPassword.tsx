import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { authCard, authField, authPage, authSubmit } from './authChrome'
import logoDark from '../assets/logo-dark.svg'

// Mirror of Login's SIGNUP_MIN_PASSWORD — the Supabase dashboard policy is the real control.
const MIN_PASSWORD = 10

/**
 * Password-recovery landing page. The recovery link signs the user in
 * (detectSessionInUrl) before they arrive here; ProtectedRoute routes any
 * recovery session here until a new password is set.
 */
export function ResetPassword() {
  const { session, loading, clearPasswordRecovery } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!loading && !session) {
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
    const { error: err } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
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
