import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { ROLE_LABELS } from '../board/role'
import {
  createInvitation,
  listPendingInvitations,
  revokeInvitation,
  type InvitationRole,
  type PendingInvitation,
} from '../invite/invitations'
import { invitationLink } from '../invite/pendingInvitation'
import { useThemeOrDefault } from '../theme/ThemeProvider'
import { Button, Select, TextInput } from './controls'

const hint: CSSProperties = { fontSize: 12, opacity: 0.7 }
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }
const ROLES: readonly InvitationRole[] = ['editor', 'viewer']

/**
 * An Owner's side of Board Invitations (#437), inside `MembersPanel` and so behind the
 * `board-sharing` flag.
 *
 * v1 delivery is the Owner's own channel: creating an Invitation shows a link **once** — the server
 * keeps only its hash — for the Owner to copy and send. The copy says what the link is and is not:
 * it works only for someone signed in with the invited address, so it is safe to send by any
 * means, but it grants the whole Board, attached files included, which is the consent the invitee
 * sees too.
 */
export function InvitationsSection({ boardId, boardName }: { boardId: string; boardName: string }) {
  const { conf } = useThemeOrDefault()
  const [pending, setPending] = useState<PendingInvitation[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InvitationRole>('editor')
  const [link, setLink] = useState<{ email: string; url: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const outcome = await listPendingInvitations(boardId)
    if (outcome.ok) setPending(outcome.value)
    else setError(outcome.message)
  }, [boardId])

  useEffect(() => {
    let current = true
    void listPendingInvitations(boardId).then((outcome) => {
      if (!current) return
      if (outcome.ok) setPending(outcome.value)
      else setError(outcome.message)
    })
    return () => {
      current = false
    }
  }, [boardId])

  const create = async () => {
    setBusy(true)
    setError(null)
    setCopied(false)
    const outcome = await createInvitation(boardId, email, role)
    setBusy(false)
    if (!outcome.ok) {
      setError(outcome.message)
      return
    }
    setLink({ email: email.trim(), url: invitationLink(outcome.value) })
    setEmail('')
    await load()
  }

  const revoke = async (invitation: PendingInvitation) => {
    setBusy(true)
    setError(null)
    const outcome = await revokeInvitation(invitation.id)
    setBusy(false)
    if (!outcome.ok) setError(outcome.message)
    await load()
  }

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
    } catch {
      setError('Could not copy. Select the link and copy it yourself.')
    }
  }

  return (
    <div
      role="group"
      aria-label={`Invite people to ${boardName}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
        Invite someone by email. You get a link to send them yourself; it works only for someone
        signed in with that address, for 14 days, and only once. They will see everything on this
        board, including attached files.
      </p>
      <form
        style={row}
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <TextInput
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          aria-label="Email address to invite"
          disabled={busy}
          style={{ padding: '6px 8px', flex: '1 1 200px' }}
        />
        <Select
          aria-label="Role for the invitation"
          value={role}
          onChange={(e) => setRole(e.target.value === 'viewer' ? 'viewer' : 'editor')}
          disabled={busy}
          style={{ padding: '6px 8px' }}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" variant="primary" disabled={busy || email.trim() === ''}>
          Create link
        </Button>
      </form>

      {error && (
        <div role="alert" style={{ color: conf.dangerFg, fontSize: 13 }}>
          {error}
        </div>
      )}

      {link && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={hint}>
            Link for {link.email}. This is the only time it is shown — copy it now.
          </div>
          <TextInput
            readOnly
            value={link.url}
            aria-label={`Invitation link for ${link.email}`}
            onFocus={(e) => e.currentTarget.select()}
            style={{ padding: '6px 8px', width: '100%' }}
          />
          <div style={row}>
            <Button size="sm" variant="primary" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button size="sm" onClick={() => setLink(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {pending.map((invitation) => (
            <li key={invitation.id} style={row}>
              <span>{invitation.email}</span>
              <span style={hint}>
                {ROLE_LABELS[invitation.role]} · pending until{' '}
                {new Date(invitation.expiresAt).toLocaleDateString()}
              </span>
              <div style={{ flex: 1 }} />
              <Button
                size="sm"
                variant="danger"
                onClick={() => void revoke(invitation)}
                disabled={busy}
                aria-label={`Revoke invitation for ${invitation.email}`}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
