import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import type { AuthResult } from '../auth/authOutcome'
import { nextFactorName, qrDataUri, type TotpEnrollment, type TotpFactor } from '../auth/mfa'

const hint: CSSProperties = { fontSize: 12, opacity: 0.7 }
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }
const CODE_LENGTH = 6

/**
 * Two-factor enrollment on `/settings`.
 *
 * Nothing here is an authorization boundary. GoTrue owns every decision — the factor limit, what a
 * code proves, whether an unverified factor counts — and the RLS policies key on `auth.uid()`
 * alone, so enrolling changes what a **sign-in** costs, not what a session may read. The step-up
 * gate that makes it mean anything lives in `ProtectedRoute`.
 *
 * The one non-obvious rule: **an abandoned enrollment must be unenrolled, not forgotten.**
 * `enroll` creates a real factor immediately, unverified; it grants nothing, but it occupies one
 * of the account's ten slots. Cancelling without removing it would let a user who opens and closes
 * this form ten times lock themselves out of ever enrolling again, with nothing on screen
 * explaining why. That is also why the list renders unverified factors instead of filtering them
 * out — one leaked by a closed tab has to be visible to be removable.
 */
export function TwoFactorSection() {
  const { listTotpFactors, enrollTotp, verifyTotp, unenrollFactor } = useAuth()
  const [factors, setFactors] = useState<TotpFactor[] | null>(null)
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null)
  const [code, setCode] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apply = useCallback((result: AuthResult<TotpFactor[]>) => {
    if (result.ok) setFactors(result.data)
    else {
      setFactors([])
      setError(result.failure.message)
    }
  }, [])
  // A promise chain rather than an `async` function on purpose: `react/set-state-in-effect`
  // cannot see past an await into where the state is actually set, so the async spelling reads to
  // it as a synchronous setState in the effect below and fails the lint.
  const reload = useCallback(() => listTotpFactors().then(apply), [listTotpFactors, apply])

  useEffect(() => {
    void reload()
  }, [reload])

  const start = async () => {
    setBusy(true)
    setError(null)
    // Named rather than numbered by the server: GoTrue rejects a duplicate `friendly_name`, and
    // generating one that is free is cheaper than asking the user for a name they don't care about.
    const result = await enrollTotp(nextFactorName(factors ?? []))
    if (result.ok) {
      setEnrollment(result.data)
      setCode('')
    } else setError(result.failure.message)
    setBusy(false)
  }

  const finish = async (e: FormEvent) => {
    e.preventDefault()
    if (!enrollment) return
    setBusy(true)
    setError(null)
    const outcome = await verifyTotp(enrollment.factorId, code)
    if (outcome.ok) {
      setEnrollment(null)
      setCode('')
      await reload()
    } else {
      setError(outcome.failure.message)
      setCode('')
    }
    setBusy(false)
  }

  const abandon = async () => {
    if (!enrollment) return
    setBusy(true)
    setError(null)
    const outcome = await unenrollFactor(enrollment.factorId)
    // The form closes either way. A refusal here leaves an unverified factor behind, which the
    // list below then shows with its own Remove button — a worse outcome than a clean cancel, but
    // a recoverable one, and holding the form open would strand the user in it instead.
    if (!outcome.ok) setError(outcome.failure.message)
    setEnrollment(null)
    setCode('')
    await reload()
    setBusy(false)
  }

  const remove = async (factorId: string) => {
    setBusy(true)
    setError(null)
    const outcome = await unenrollFactor(factorId)
    if (!outcome.ok) setError(outcome.failure.message)
    setRemoving(null)
    await reload()
    setBusy(false)
  }

  if (factors === null) return <div style={hint}>Loading…</div>

  const enrolled = factors.filter((f) => f.verified)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={hint}>
        {enrolled.length === 0
          ? 'Add an authenticator app to require a six-digit code as well as your password when you sign in.'
          : 'You’ll be asked for a six-digit code when you sign in.'}
      </div>

      {factors.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
          {factors.map((factor) => (
            <li key={factor.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={row}>
                <span style={{ fontWeight: 600 }}>{factor.name ?? 'Authenticator app'}</span>
                {!factor.verified && <span style={hint}>not finished — remove it</span>}
                <div style={{ flex: 1 }} />
                {removing === factor.id ? (
                  <>
                    <span style={hint}>Remove it?</span>
                    <button type="button" onClick={() => void remove(factor.id)} disabled={busy}>
                      {busy ? 'Removing…' : 'Confirm'}
                    </button>
                    <button type="button" onClick={() => setRemoving(null)} disabled={busy}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null)
                      setRemoving(factor.id)
                    }}
                    disabled={busy}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {enrollment ? (
        <form onSubmit={(e) => void finish(e)} style={{ display: 'grid', gap: 10, maxWidth: 360 }}>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
            Scan this with your authenticator app, then enter the code it shows.
          </p>
          <img
            src={qrDataUri(enrollment.qrCodeSvg)}
            alt="QR code for enrolling this account in your authenticator app"
            width={180}
            height={180}
            style={{ background: '#fff', borderRadius: 8, padding: 8, alignSelf: 'flex-start' }}
          />
          <label htmlFor="mfa-secret" style={hint}>
            Or enter this key by hand
          </label>
          <input
            id="mfa-secret"
            value={enrollment.secret}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            style={{ fontSize: 16, padding: '8px 10px', fontFamily: 'ui-monospace, monospace' }}
          />
          <label htmlFor="mfa-code" style={hint}>
            Six-digit code
          </label>
          <input
            id="mfa-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
            disabled={busy}
            // ≥16px so iOS Safari doesn't zoom on focus.
            style={{ fontSize: 16, padding: '8px 10px', letterSpacing: '0.2em', maxWidth: 180 }}
          />
          {error && (
            <div role="alert" style={{ color: '#b42318', fontSize: 13 }}>
              {error}
            </div>
          )}
          <div style={row}>
            <button type="submit" disabled={busy || code.length !== CODE_LENGTH}>
              {busy ? 'Verifying…' : 'Turn on two-factor'}
            </button>
            <button type="button" onClick={() => void abandon()} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          {error && (
            <div role="alert" style={{ color: '#b42318', fontSize: 13 }}>
              {error}
            </div>
          )}
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy}
            style={{ alignSelf: 'flex-start' }}
          >
            {busy ? 'Starting…' : 'Add authenticator app'}
          </button>
        </>
      )}

      {enrolled.length > 0 && (
        <div style={hint}>
          Magic Agenda issues no backup codes. If you lose your authenticator app, removing
          two-factor from your account needs support — keep a second app enrolled, or your recovery
          key somewhere safe.
        </div>
      )}
    </div>
  )
}
