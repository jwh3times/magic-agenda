import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { MIN_PASSWORD, PASSWORD_RULE } from '../auth/passwordPolicy'
import logoDark from '../assets/logo-dark.svg'
import { authCard, authField, authLinkBtn, authLogo, authPage, authSubmit } from './authChrome'

type Mode = 'signin' | 'signup' | 'forgot'

/**
 * Google's official mark, inline. Their branding guidelines require the real multi-colour "G" on a
 * "Continue with Google" button rather than a substitute glyph. Inline SVG because `public/_headers`
 * sets `script-src 'self'` and we add no external asset hosts for this.
 */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  )
}

export function Login() {
  const { session, signIn, signUp, sendPasswordReset, startGoogleSignIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // One-shot: capture the flag at mount, then scrub it from history.state so a
  // later reload of /login can't resurrect the "account deleted" notice.
  const [accountDeleted] = useState(() =>
    Boolean((location.state as { accountDeleted?: boolean } | null)?.accountDeleted),
  )
  const noticeCleared = useRef(false)
  useEffect(() => {
    if (accountDeleted && !noticeCleared.current) {
      noticeCleared.current = true
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [accountDeleted, navigate, location.pathname])
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (session) navigate('/', { replace: true })
  }, [session, navigate])

  // No try/catch anywhere below: every auth action resolves an outcome and never rejects
  // (see AuthGateway), so a failure is a value to render rather than a control-flow event.
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)

    if (mode === 'forgot') {
      const outcome = await sendPasswordReset(email)
      // Deliberately the same notice whether or not an account exists — this form must not
      // become an account-enumeration oracle.
      if (outcome.ok)
        setNotice('If an account exists for that email, a password reset link is on its way.')
      else setError(outcome.failure.message)
    } else if (mode === 'signup') {
      const outcome = await signUp(email, password)
      if (!outcome.ok) setError(outcome.failure.message)
      else if (outcome.confirmationRequired) setNotice('Check your email to confirm your account.')
    } else {
      const outcome = await signIn(email, password)
      if (!outcome.ok) setError(outcome.failure.message)
    }

    setBusy(false)
  }

  const google = async () => {
    setError(null)
    const outcome = await startGoogleSignIn()
    if (!outcome.ok) setError(outcome.failure.message)
  }

  return (
    <div style={authPage}>
      <main style={authCard}>
        <h1 style={{ margin: '0 0 6px' }}>
          <img src={logoDark} alt="Magic Agenda" style={authLogo} />
        </h1>
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
              <GoogleMark /> Continue with Google
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
                minLength={mode === 'signup' ? MIN_PASSWORD : undefined}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={authField}
              />
              {mode === 'signup' && (
                <div style={{ fontSize: 12, opacity: 0.5, lineHeight: 1.4 }}>{PASSWORD_RULE}</div>
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

          {accountDeleted && (
            <div style={{ color: '#86efac', fontSize: 13, lineHeight: 1.4 }}>
              Your account and all of its data have been deleted. Thanks for trying Magic Agenda.
            </div>
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
      </main>
    </div>
  )
}
