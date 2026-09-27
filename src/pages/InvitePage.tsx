import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { MfaChallenge } from '../auth/MfaChallenge'
import { useBoardDirectoryContext } from '../board/BoardDirectoryProvider'
import { ROLE_LABELS } from '../board/role'
import { Spinner } from '../components/Spinner'
import {
  FINAL_FOR_INVITEE,
  acceptInvitation,
  declineInvitation,
  previewInvitation,
  type InvitationOutcome,
  type InvitationPreview,
} from '../invite/invitations'
import {
  adoptCapturedInvitation,
  clearPendingInvitation,
  readPendingInvitation,
} from '../invite/pendingInvitation'
import { authCard, authLogo, authPage, authSubmit } from './authChrome'
import logoDark from '../assets/logo-dark.svg'

const body = { margin: '0 0 14px', fontSize: 14, lineHeight: 1.5 } as const
const link = { color: '#a78bfa', fontWeight: 700, fontSize: 14 } as const

function Card({ children }: { children: ReactNode }) {
  return (
    <div style={authPage}>
      <main style={authCard}>
        <h1 style={{ margin: '0 0 6px' }}>
          <img src={logoDark} alt="Magic Agenda" style={authLogo} />
        </h1>
        {children}
      </main>
    </div>
  )
}

/**
 * `/invite` — where a Board Invitation link lands (#437). A public route: the invitee may not have
 * an Account yet.
 *
 * The token never reaches this component through the URL. `/auth-token-bootstrap.js` scrubbed it
 * from the address bar before the app loaded, and it is adopted here into the pending-invitation
 * store, which survives the sign-up confirmation email opening a new tab.
 *
 * - **Signed out:** no Board name, nothing about the Invitation — only "sign in or create an
 *   account". The preview command is authenticated-only, so this page cannot be used to enumerate
 *   Boards even by a script.
 * - **Signed in:** the same guards `HomeRoute` applies (recovery, two-factor step-up), then the
 *   preview and an explicit **Accept** — never automatic on load. The server re-checks that the
 *   caller's verified email is the one invited; this page only renders its answer.
 *
 * The held token is cleared on accept, decline, a refusal that can never succeed for this Account,
 * "not now", and sign-out (`AuthProvider`).
 */
export function InvitePage() {
  const { session, loading, passwordRecovery, stepUpRequired } = useAuth()
  const [token] = useState(() => {
    adoptCapturedInvitation()
    return readPendingInvitation()
  })

  if (loading) return <Spinner />
  if (!token) {
    return (
      <Card>
        <p style={body}>There is no invitation waiting here. Open the link you were sent again.</p>
        <Link to="/" style={link}>
          Go to Magic Agenda
        </Link>
      </Card>
    )
  }
  if (!session) {
    return (
      <Card>
        <p style={body}>
          You have been invited to a board. Sign in or create an account to see this invitation —
          use the email address it was sent to.
        </p>
        <Link to="/login" style={link}>
          Sign in or create an account
        </Link>
      </Card>
    )
  }
  if (passwordRecovery) return <Navigate to="/auth/reset" replace />
  if (stepUpRequired === null) return <Spinner />
  if (stepUpRequired) return <MfaChallenge />
  return <SignedInInvitation token={token} />
}

function SignedInInvitation({ token }: { token: string }) {
  const navigate = useNavigate()
  const { reload, selectBoard } = useBoardDirectoryContext()
  const [preview, setPreview] = useState<InvitationOutcome<InvitationPreview> | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void previewInvitation(token).then((outcome) => {
      if (!current) return
      if (!outcome.ok && FINAL_FOR_INVITEE.has(outcome.reason)) clearPendingInvitation()
      setPreview(outcome)
    })
    return () => {
      current = false
    }
  }, [token])

  const accept = async () => {
    setBusy(true)
    setFailure(null)
    const outcome = await acceptInvitation(token)
    if (!outcome.ok) {
      if (FINAL_FOR_INVITEE.has(outcome.reason)) clearPendingInvitation()
      setFailure(outcome.message)
      setBusy(false)
      return
    }
    clearPendingInvitation()
    await reload()
    selectBoard(outcome.value)
    void navigate('/', { replace: true })
  }

  const decline = async () => {
    setBusy(true)
    setFailure(null)
    const outcome = await declineInvitation(token)
    if (!outcome.ok && !FINAL_FOR_INVITEE.has(outcome.reason)) {
      setFailure(outcome.message)
      setBusy(false)
      return
    }
    clearPendingInvitation()
    void navigate('/', { replace: true })
  }

  const notNow = () => {
    // Forget it on this device; the link itself still works until it expires.
    clearPendingInvitation()
    void navigate('/', { replace: true })
  }

  if (preview === null) return <Spinner label="Opening invitation…" />

  if (!preview.ok) {
    return (
      <Card>
        <p role="alert" style={body}>
          {preview.message}
        </p>
        <Link to="/" style={link}>
          Go to your boards
        </Link>
      </Card>
    )
  }

  const { boardName, inviterName, role } = preview.value
  return (
    <Card>
      <p style={body}>
        {inviterName.trim() ? <strong>{inviterName}</strong> : 'Someone'} invited you to join{' '}
        <strong>{boardName}</strong> as {role === 'editor' ? 'an' : 'a'}{' '}
        <strong>{ROLE_LABELS[role]}</strong>.
      </p>
      <p data-testid="invitation-consent" style={{ ...body, opacity: 0.8 }}>
        Accepting gives you access to everything on this board, including attached files, and shows
        your name to its other members.
      </p>
      {failure && (
        <p role="alert" style={{ ...body, color: '#fca5a5' }}>
          {failure}
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button type="button" style={authSubmit} disabled={busy} onClick={() => void accept()}>
          {busy ? 'Joining…' : `Join ${boardName}`}
        </button>
        <button type="button" disabled={busy} onClick={() => void decline()}>
          Decline
        </button>
        <button type="button" disabled={busy} onClick={notNow}>
          Not now
        </button>
      </div>
    </Card>
  )
}
