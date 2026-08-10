import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { useTokenRedemption } from '../auth/redemption'
import { Spinner } from '../components/Spinner'
import { authCard, authLogo, authPage } from './authChrome'
import logoDark from '../assets/logo-dark.svg'

/**
 * Signup-confirmation landing. The emailed link carries ?token_hash=…&type=signup, redeemed
 * exactly once by `useTokenRedemption` — which returns a session, so there is no "confirm, then
 * come back and sign in" round trip.
 *
 * An existing session is never replaced: that covers a second click on the link and blocks session
 * fixation via an attacker-minted token (see the design spec's "Residual risk"). The guard is
 * `redeemDecision`, shared with ResetPassword.
 */
export function AuthConfirm() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const redemption = useTokenRedemption('signup')

  // Only leave for the board off *our own* redemption — `attempted` is what distinguishes it from
  // an unrelated session that was already there (which gets the refusal card instead).
  useEffect(() => {
    if (session && redemption.attempted) void navigate('/', { replace: true })
  }, [session, redemption.attempted, navigate])

  if (loading) return <Spinner />

  if (redemption.status === 'refused') {
    return (
      <div style={authPage}>
        <main style={authCard}>
          <h1 style={{ margin: '0 0 6px' }}>
            <img src={logoDark} alt="Magic Agenda" style={authLogo} />
          </h1>
          <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5, opacity: 0.75 }}>
            {redemption.hadToken
              ? 'You’re already signed in, so this confirmation link wasn’t used.'
              : 'You’re already signed in.'}
          </p>
          <Link to="/" style={{ color: '#a78bfa', fontWeight: 700, fontSize: 14 }}>
            Back to your board
          </Link>
        </main>
      </div>
    )
  }

  // A link that could not be checked is not a link that expired — #131.
  if (redemption.failure?.reason === 'offline') {
    return (
      <div style={authPage}>
        <main style={authCard}>
          <h1 style={{ margin: '0 0 6px' }}>
            <img src={logoDark} alt="Magic Agenda" style={authLogo} />
          </h1>
          <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5, opacity: 0.75 }}>
            Couldn’t reach the server to confirm your account. Check your connection and open the
            link again — it hasn’t been used.
          </p>
          <Link to="/login" style={{ color: '#a78bfa', fontWeight: 700, fontSize: 14 }}>
            Back to sign in
          </Link>
        </main>
      </div>
    )
  }

  if (redemption.status === 'failed' || (!session && !redemption.hadToken)) {
    return (
      <div style={authPage}>
        <main style={authCard}>
          <h1 style={{ margin: '0 0 6px' }}>
            <img src={logoDark} alt="Magic Agenda" style={authLogo} />
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
