import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { MfaChallenge } from '../auth/MfaChallenge'
import { useBoardDirectoryContext } from '../board/BoardDirectoryProvider'
import { ROLE_LABELS } from '../board/role'
import { Spinner } from '../components/Spinner'
import {
  DISPLAY_NAME_MAX,
  displayNameError,
  loadDisplayName,
  normalizeDisplayName,
  saveDisplayName,
} from '../data/accountProfile'
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
import { authCard, authField, authLogo, authPage, authSubmit } from './authChrome'
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

/**
 * The invitee's stored Display Name, or `undefined` while loading. A failed read is `null`: the
 * name prompt is a courtesy, so not knowing the name skips it rather than blocking the join.
 */
function useOwnDisplayName(accountId: string | null): string | null | undefined {
  const [name, setName] = useState<{ accountId: string | null; value: string | null }>()
  useEffect(() => {
    if (!accountId) return
    let current = true
    void loadDisplayName(accountId).then((result) => {
      if (current) setName({ accountId, value: result.ok ? result.data : null })
    })
    return () => {
      current = false
    }
  }, [accountId])
  if (!accountId) return null
  return name?.accountId === accountId ? name.value : undefined
}

function SignedInInvitation({ token }: { token: string }) {
  const navigate = useNavigate()
  const accountId = useAuth().user?.id ?? null
  const storedName = useOwnDisplayName(accountId)
  // Set once a name typed here has been saved, so a retried join neither asks nor saves again.
  const [savedName, setSavedName] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState('')
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

  const currentName = savedName ?? storedName
  // Ask only an Account known to have no name (#476). It is optional and never blocks joining.
  const askForName = currentName === ''
  const nameInvalid = askForName ? displayNameError(normalizeDisplayName(nameDraft)) : null

  const accept = async () => {
    setBusy(true)
    setFailure(null)
    // The name is saved FIRST, so the new member is never listed unnamed and the Owner's records
    // of the join carry it. A failed save stops the join: the user can fix it or clear the field.
    if (askForName && accountId && normalizeDisplayName(nameDraft)) {
      const saved = await saveDisplayName(accountId, nameDraft)
      if (!saved.ok) {
        setFailure(`Your name was not saved, so you have not joined yet. ${saved.message}`)
        setBusy(false)
        return
      }
      setSavedName(saved.data)
    }
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

  if (preview === null || storedName === undefined) return <Spinner label="Opening invitation…" />

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
      {askForName ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '0 0 14px' }}>
          <label htmlFor="invite-display-name" style={{ fontSize: 14, fontWeight: 700 }}>
            Your name <span style={{ fontWeight: 400, opacity: 0.75 }}>(optional)</span>
          </label>
          <input
            id="invite-display-name"
            value={nameDraft}
            autoComplete="name"
            disabled={busy}
            aria-invalid={nameInvalid ? true : undefined}
            aria-describedby="invite-display-name-hint"
            onChange={(e) => setNameDraft(e.target.value)}
            style={authField}
          />
          <span id="invite-display-name-hint" style={{ fontSize: 13, opacity: 0.75 }}>
            What the board&rsquo;s members see instead of &ldquo;Unnamed member&rdquo;. Up to{' '}
            {DISPLAY_NAME_MAX} characters; you can change it later in Settings → Profile.
          </span>
          {nameInvalid && (
            <span role="alert" style={{ fontSize: 13, color: '#fca5a5' }}>
              {nameInvalid}
            </span>
          )}
        </div>
      ) : (
        currentName && (
          <p style={{ ...body, opacity: 0.8 }}>
            Members will see you as <strong>{currentName}</strong>. You can change it in Settings →
            Profile.
          </p>
        )
      )}
      {failure && (
        <p role="alert" style={{ ...body, color: '#fca5a5' }}>
          {failure}
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          type="button"
          style={authSubmit}
          disabled={busy || !!nameInvalid}
          onClick={() => void accept()}
        >
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
