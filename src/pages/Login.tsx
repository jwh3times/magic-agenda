import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import logoDark from '../assets/logo-dark.svg'
import { authCard, authField, authLinkBtn, authPage, authSubmit } from './authChrome'

type Mode = 'signin' | 'signup' | 'forgot'

// Client mirror of the Supabase password policy (min length 10 + complexity). The dashboard setting
// is the real control; this only makes signup fail fast. Applied in signup mode only — sign-in must
// accept any legacy password shorter than the current minimum.
const SIGNUP_MIN_PASSWORD = 10

export function Login() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (session) navigate('/', { replace: true })
  }, [session, navigate])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (mode === 'forgot') {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/reset`,
        })
        if (err) throw err
        setNotice('If an account exists for that email, a password reset link is on its way.')
        return
      }
      if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({ email, password })
        if (err) throw err
        if (!data.session) setNotice('Check your email to confirm your account, then sign in.')
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password })
        if (err) throw err
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const google = async () => {
    setError(null)
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (err) setError(err.message)
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
          {mode === 'signin'
            ? 'Welcome back — sign in to your board.'
            : mode === 'signup'
              ? 'Create your account.'
              : 'Enter your email and we’ll send you a reset link.'}
        </p>

        {mode !== 'forgot' && (
          <>
            <button
              type="button"
              onClick={google}
              style={{
                width: '100%',
                padding: '11px 14px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,.14)',
                background: '#fff',
                color: '#1f1f1f',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
              }}
            >
              <span style={{ fontWeight: 800, color: '#4285F4' }}>G</span> Continue with Google
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.1)' }} />
              <span style={{ fontSize: 12, opacity: 0.4 }}>or</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.1)' }} />
            </div>
          </>
        )}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={authField}
          />
          {mode !== 'forgot' && (
            <>
              <input
                type="password"
                required
                minLength={mode === 'signup' ? SIGNUP_MIN_PASSWORD : undefined}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={authField}
              />
              {mode === 'signup' && (
                <div style={{ fontSize: 12, opacity: 0.5, lineHeight: 1.4 }}>
                  At least 10 characters, including upper- and lower-case letters, a number, and a
                  symbol.
                </div>
              )}
            </>
          )}

          {mode === 'signin' && (
            <button
              type="button"
              onClick={() => {
                setMode('forgot')
                setError(null)
                setNotice(null)
              }}
              style={{ ...authLinkBtn, alignSelf: 'flex-end', fontSize: 12 }}
            >
              Forgot password?
            </button>
          )}

          {error && <div style={{ color: '#ff8b8b', fontSize: 13, lineHeight: 1.4 }}>{error}</div>}
          {notice && (
            <div style={{ color: '#86efac', fontSize: 13, lineHeight: 1.4 }}>{notice}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{ ...authSubmit, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
          >
            {busy
              ? 'Please wait…'
              : mode === 'signin'
                ? 'Sign in'
                : mode === 'signup'
                  ? 'Create account'
                  : 'Send reset link'}
          </button>
        </form>

        <div style={{ marginTop: 18, fontSize: 13, opacity: 0.7, textAlign: 'center' }}>
          {mode === 'forgot' ? (
            <button
              type="button"
              onClick={() => {
                setMode('signin')
                setError(null)
                setNotice(null)
              }}
              style={authLinkBtn}
            >
              Back to sign in
            </button>
          ) : (
            <>
              {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'signin' ? 'signup' : 'signin')
                  setError(null)
                  setNotice(null)
                }}
                style={authLinkBtn}
              >
                {mode === 'signin' ? 'Sign up' : 'Sign in'}
              </button>
            </>
          )}
        </div>

        <div style={{ marginTop: 14, fontSize: 12, opacity: 0.4, textAlign: 'center' }}>
          <Link to="/privacy" style={{ color: 'inherit' }}>
            Privacy
          </Link>{' '}
          ·{' '}
          <Link to="/terms" style={{ color: 'inherit' }}>
            Terms
          </Link>
        </div>
      </div>
    </div>
  )
}
