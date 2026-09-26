import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { listBoardMembers, type BoardMember } from '../board/boardMembers'
import { changeMemberRole, leaveBoard, removeMember } from '../board/memberAdmin'
import type { BoardOutcome } from '../board/outcome'
import { asBoardRole, BOARD_ROLES, capabilitiesFor, ROLE_LABELS } from '../board/role'
import type { BoardSummary } from '../board/selection'

const hint: CSSProperties = { fontSize: 12, opacity: 0.7 }
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }
const danger = '#b42318'

/**
 * One Board's current members, and what the caller may do about them (#438).
 *
 * Shown only behind the `board-sharing` feature flag. The flag and `capabilitiesFor` decide what
 * is *offered*; the commands decide what happens, and every refusal comes back as a Board outcome
 * whose message is rendered as-is — including `last-owner`, which the UI does not try to predict,
 * because only the server holding the Board row lock knows whether another Owner still exists.
 *
 * The list is re-read after every change rather than patched locally: a change can fail, race
 * another Owner, or end the caller's own access, and the server's answer covers all three.
 */
export function MembersPanel({
  board,
  onClose,
  onOwnMembershipChanged,
}: {
  board: BoardSummary
  onClose: () => void
  /**
   * The caller's own Membership changed — ended, or their role changed — so the Board Directory,
   * which holds the role every capability here derives from, must reload.
   */
  onOwnMembershipChanged: () => void
}) {
  const can = capabilitiesFor(board.role)
  const [members, setMembers] = useState<BoardMember[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)

  const load = useCallback(async () => {
    const outcome = await listBoardMembers(board.id)
    if (outcome.ok) setMembers(outcome.value)
    else setError(outcome.failure.message)
    return outcome
  }, [board.id])

  useEffect(() => {
    let current = true
    void listBoardMembers(board.id).then((outcome) => {
      if (!current) return
      if (outcome.ok) setMembers(outcome.value)
      else setError(outcome.failure.message)
    })
    return () => {
      current = false
    }
  }, [board.id])

  const act = async (command: () => Promise<BoardOutcome>, ownMembership = false) => {
    setBusy(true)
    setError(null)
    const outcome = await command()
    setBusy(false)
    setRemoving(null)
    if (!outcome.ok) setError(outcome.failure.message)
    else if (ownMembership) onOwnMembershipChanged()
    const reread = await load()
    // Losing access to the list means this caller is no longer a member (e.g. demoted and then
    // removed by another Owner meanwhile): hand off to the directory rather than show a stale list.
    if (!reread.ok && reread.failure.reason === 'membership-ended') onOwnMembershipChanged()
  }

  const leave = async () => {
    setBusy(true)
    setError(null)
    const outcome = await leaveBoard(board.id)
    setBusy(false)
    setLeaving(false)
    if (outcome.ok) onOwnMembershipChanged()
    else setError(outcome.failure.message)
  }

  const nameOf = (member: BoardMember) => member.displayName.trim() || 'Unnamed member'

  return (
    <div
      role="group"
      aria-label={`Members of ${board.name}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      {error && (
        <div role="alert" style={{ color: danger, fontSize: 13 }}>
          {error}
        </div>
      )}
      {members === null && !error && <div style={hint}>Loading members…</div>}

      {members !== null && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {members.map((member) => {
            const self = member.membershipId === board.membershipId
            return (
              <li key={member.membershipId} style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={row}>
                  <span style={{ fontWeight: 600 }}>
                    {nameOf(member)}
                    {self && <span style={hint}> (you)</span>}
                  </span>
                  {member.email && <span style={hint}>{member.email}</span>}
                  <div style={{ flex: 1 }} />
                  {can.manageMembers ? (
                    <select
                      aria-label={`Role for ${nameOf(member)}`}
                      value={member.role}
                      disabled={busy}
                      onChange={(e) => {
                        const role = asBoardRole(e.target.value)
                        if (role) void act(() => changeMemberRole(member.membershipId, role), self)
                      }}
                    >
                      {BOARD_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span style={hint}>{ROLE_LABELS[member.role]}</span>
                  )}
                  {can.manageMembers && !self && removing !== member.membershipId && (
                    <button
                      type="button"
                      onClick={() => setRemoving(member.membershipId)}
                      disabled={busy}
                    >
                      Remove…
                    </button>
                  )}
                </div>
                {removing === member.membershipId && (
                  <div style={row}>
                    <span style={{ fontSize: 13.5 }}>
                      Remove {nameOf(member)}? They lose access to this board immediately.
                    </span>
                    <button
                      type="button"
                      onClick={() => void act(() => removeMember(member.membershipId))}
                      disabled={busy}
                      style={{ color: danger, borderColor: danger }}
                    >
                      Remove
                    </button>
                    <button type="button" onClick={() => setRemoving(null)} disabled={busy}>
                      Cancel
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div style={row}>
        {!leaving && (
          <button type="button" onClick={() => setLeaving(true)} disabled={busy}>
            Leave board…
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onClose} disabled={busy}>
          Hide
        </button>
      </div>
      {leaving && (
        <div style={row}>
          <span style={{ fontSize: 13.5 }}>
            Leave <strong>{board.name}</strong>? You lose access until someone invites you back.
          </span>
          <button
            type="button"
            onClick={() => void leave()}
            disabled={busy}
            style={{ color: danger, borderColor: danger }}
          >
            Leave
          </button>
          <button type="button" onClick={() => setLeaving(false)} disabled={busy}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
