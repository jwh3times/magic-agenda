import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import { useAuth } from '../auth/AuthProvider'
import { Spinner } from '../components/Spinner'
import { authCard, authPage } from './authChrome'
import logoDark from '../assets/logo-dark.svg'

/**
 * Signup-confirmation landing. The emailed link carries ?token_hash=…&type=signup,
 * redeemed here exactly once via verifyOtp — which returns a session, so there is no
 * "confirm, then come back and sign in" round trip. An existing session is never
 * replaced: that covers a second click on the link and blocks session fixation via an
 * attacker-minted token (see the design spec's "Residual risk").
 */
export function AuthConfirm() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  // One-shot: capture the token at mount; the redeem effect scrubs it from the URL.
  const [tokenHash] = useState(() => new URLSearchParams(window.location.search).get('token_hash'))
  const redeemed = useRef(false)
  const [refused, setRefused] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  useEffect(() => {
    // Redeem exactly once: the token is single-use and StrictMode double-invokes
    // effects. An existing session never redeems (fixation guard) — it flips
    // `refused` instead, which renders the already-signed-in card.
    if (loading || redeemed.current || refused) return
    if (session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRefused(true)
      return
    }
    if (!tokenHash) return
    redeemed.current = true
    window.history.replaceState(window.history.state, '', window.location.pathname)
    supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'signup' }).then(({ error: err }) => {
      if (err) setVerifyError(errorMessage(err))
    })
  }, [loading, session, tokenHash, refused])

  useEffect(() => {
    if (session && redeemed.current) navigate('/', { replace: true })
  }, [session, navigate])

  if (loading) return <Spinner />

  if (refused) {
    return (
      <div style={authPage}>
        <main style={authCard}>
          <h1 style={{ margin: '0 0 6px' }}>
            <img src={logoDark} alt="Magic Agenda" style={{ height: 110, display: 'block' }} />
          </h1>
          <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5, opacity: 0.75 }}>
            You’re already signed in, so this confirmation link wasn’t used.
          </p>
          <Link to="/" style={{ color: '#a78bfa', fontWeight: 700, fontSize: 14 }}>
            Back to your board
          </Link>
        </main>
      </div>
    )
  }

  if (verifyError || (!session && !tokenHash)) {
    return (
      <div style={authPage}>
        <main style={authCard}>
          <h1 style={{ margin: '0 0 6px' }}>
            <img src={logoDark} alt="Magic Agenda" style={{ height: 110, display: 'block' }} />
          </h1>
          <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5, opacity: 0.75 }}>
            This confirmation link is invalid or has expired. Try signing in — if your account is
            already confirmed it will work; otherwise sign up again for a fresh link.
          </p>
          <Link to="/login" style={{ color: '#a78bfa', fontWeight: 700, fontSize: 14 }}>
            Back to sign in
          </Link>
        </main>
      </div>
    )
  }

  return <Spinner label="Confirming your account…" />
}
