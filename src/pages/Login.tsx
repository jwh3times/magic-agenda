import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import logoDark from '../assets/logo-dark.svg'

type Mode = 'signin' | 'signup'

const field: CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,.12)',
  background: 'rgba(255,255,255,.05)',
  color: '#eaf0ff',
  fontSize: 14,
  fontFamily: 'system-ui, sans-serif',
}

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
    <div
      style={{
        minHeight: '100%',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        background:
          'radial-gradient(1200px 600px at 70% -10%, rgba(124,92,255,.25), transparent 60%), #0b0f1f',
        fontFamily: 'system-ui, sans-serif',
        color: '#eaf0ff',
      }}
    >
      <div
        style={{
          width: 'min(400px, 100%)',
          background: 'rgba(255,255,255,.04)',
          border: '1px solid rgba(255,255,255,.1)',
          borderRadius: 18,
          padding: 28,
          boxShadow: '0 30px 80px rgba(0,0,0,.45)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <img
          src={logoDark}
          alt="Magic Agenda"
          style={{ height: 110, display: 'block', margin: '0 0 6px' }}
        />
        <p style={{ margin: '0 0 22px', opacity: 0.55, fontSize: 14 }}>
          {mode === 'signin' ? 'Welcome back — sign in to your board.' : 'Create your account.'}
        </p>

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

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={field}
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={field}
          />

          {error && <div style={{ color: '#ff8b8b', fontSize: 13, lineHeight: 1.4 }}>{error}</div>}
          {notice && (
            <div style={{ color: '#86efac', fontSize: 13, lineHeight: 1.4 }}>{notice}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{
              marginTop: 4,
              padding: '12px 14px',
              borderRadius: 10,
              border: 'none',
              background: '#7c5cff',
              color: '#fff',
              fontSize: 14,
              fontWeight: 800,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div style={{ marginTop: 18, fontSize: 13, opacity: 0.7, textAlign: 'center' }}>
          {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              setError(null)
              setNotice(null)
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#a78bfa',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 700,
              padding: 0,
            }}
          >
            {mode === 'signin' ? 'Sign up' : 'Sign in'}
          </button>
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
