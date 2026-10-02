import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { listBoardMembers, type BoardMember } from '../board/boardMembers'
import { memberName } from '../board/boardMembersContext'
import {
  changeMemberRole,
  leaveBoard,
  MEMBER_LABEL_MAX,
  removeMember,
  setMemberLabel,
} from '../board/memberAdmin'
import type { BoardOutcome } from '../board/outcome'
import { asBoardRole, BOARD_ROLES, capabilitiesFor, ROLE_LABELS } from '../board/role'
import type { BoardSummary } from '../board/selection'
import { readRemindUnassigned, writeRemindUnassigned } from '../board/reminderOptIn'
import { useThemeOrDefault } from '../theme/ThemeProvider'
import { Button, Checkbox, Select, TextInput } from './controls'
import { rowListStyle } from '../theme/controls'
import { InvitationsSection } from './InvitationsSection'

const hint: CSSProperties = { fontSize: 12, opacity: 0.7 }
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }

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
  const { conf } = useThemeOrDefault()
  const [members, setMembers] = useState<BoardMember[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  // The member whose Owner-private label is being edited (#490), and the draft.
  const [labeling, setLabeling] = useState<string | null>(null)
  const [labelDraft, setLabelDraft] = useState('')
  // Reminder opt-in for unassigned Tasks (#441): null until read.
  const [remindUnassigned, setRemindUnassigned] = useState<boolean | null>(null)

  useEffect(() => {
    let current = true
    void readRemindUnassigned(board.membershipId).then((value) => {
      if (current) setRemindUnassigned(value)
    })
    return () => {
      current = false
    }
  }, [board.membershipId])

  const toggleRemindUnassigned = async (value: boolean) => {
    setRemindUnassigned(value)
    const failure = await writeRemindUnassigned(board.membershipId, value)
    if (failure) {
      setRemindUnassigned(!value)
      setError(failure)
    }
  }

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

  // The label when the caller is an Owner and set one, else the member's own name (#490).
  const nameOf = (member: BoardMember) => memberName(member)
  const ownName = (member: BoardMember) => member.displayName.trim() || 'Unnamed member'

  const startLabel = (member: BoardMember) => {
    setRemoving(null)
    setLabeling(member.membershipId)
    setLabelDraft(member.nickname ?? '')
  }
  const saveLabel = (member: BoardMember, nickname: string) => {
    setLabeling(null)
    void act(() => setMemberLabel(member.membershipId, nickname))
  }
  const labelTooLong = Array.from(labelDraft.trim()).length > MEMBER_LABEL_MAX

  return (
    <div
      role="group"
      aria-label={`Members of ${board.name}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      {error && (
        <div role="alert" style={{ color: conf.dangerFg, fontSize: 13 }}>
          {error}
        </div>
      )}
      {members === null && !error && <div style={hint}>Loading members…</div>}

      {members !== null && (
        <ul style={rowListStyle(6)}>
          {members.map((member) => {
            const self = member.membershipId === board.membershipId
            return (
              <li key={member.membershipId} style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={row}>
                  <span style={{ fontWeight: 600 }}>
                    {nameOf(member)}
                    {self && <span style={hint}> (you)</span>}
                  </span>
                  {/* A labelled member's own name stays visible, so an Owner can still tell who it is. */}
                  {member.nickname && <span style={hint}>{ownName(member)}</span>}
                  {member.email && <span style={hint}>{member.email}</span>}
                  <div style={{ flex: 1 }} />
                  {can.manageMembers ? (
                    <Select
                      aria-label={`Role for ${nameOf(member)}`}
                      value={member.role}
                      disabled={busy}
                      style={{ padding: '5px 8px' }}
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
                    </Select>
                  ) : (
                    <span style={hint}>{ROLE_LABELS[member.role]}</span>
                  )}
                  {can.manageMembers && !self && labeling !== member.membershipId && (
                    <Button size="sm" onClick={() => startLabel(member)} disabled={busy}>
                      Name…
                    </Button>
                  )}
                  {can.manageMembers && !self && removing !== member.membershipId && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        setLabeling(null)
                        setRemoving(member.membershipId)
                      }}
                      disabled={busy}
                    >
                      Remove…
                    </Button>
                  )}
                </div>
                {labeling === member.membershipId && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (!labelTooLong && !busy) saveLabel(member, labelDraft)
                    }}
                    style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}
                  >
                    <div style={{ ...row, flexWrap: 'nowrap', minWidth: 0 }}>
                      <TextInput
                        aria-label={`Name on this board for ${ownName(member)}`}
                        value={labelDraft}
                        placeholder={ownName(member)}
                        autoFocus
                        disabled={busy}
                        aria-invalid={labelTooLong ? true : undefined}
                        onChange={(e) => setLabelDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setLabeling(null)
                        }}
                        style={{ flex: 1, minWidth: 0, padding: '6px 8px' }}
                      />
                      <Button
                        type="submit"
                        size="sm"
                        variant="primary"
                        disabled={busy || labelTooLong}
                        style={{ flexShrink: 0 }}
                      >
                        Save
                      </Button>
                    </div>
                    <div style={row}>
                      <span style={hint}>
                        Only this board&rsquo;s owners see this name. Up to {MEMBER_LABEL_MAX}{' '}
                        characters.
                      </span>
                      <div style={{ flex: 1 }} />
                      {member.nickname && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => saveLabel(member, '')}
                          disabled={busy}
                        >
                          Clear name
                        </Button>
                      )}
                      <Button size="sm" onClick={() => setLabeling(null)} disabled={busy}>
                        Cancel
                      </Button>
                    </div>
                    {labelTooLong && (
                      <div role="alert" style={{ color: conf.dangerFg, fontSize: 13 }}>
                        Use at most {MEMBER_LABEL_MAX} characters.
                      </div>
                    )}
                  </form>
                )}
                {removing === member.membershipId && (
                  <div style={row}>
                    <span style={{ fontSize: 13.5 }}>
                      Remove {nameOf(member)}? They lose access to this board immediately.
                    </span>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void act(() => removeMember(member.membershipId))}
                      disabled={busy}
                    >
                      Remove
                    </Button>
                    <Button size="sm" onClick={() => setRemoving(null)} disabled={busy}>
                      Cancel
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {members !== null && members.length > 1 && remindUnassigned !== null && (
        // Only on a Board more than one person is on: alone, every timed Task reminds you anyway.
        <label style={{ ...row, fontSize: 13.5 }}>
          <Checkbox
            checked={remindUnassigned}
            onChange={(e) => void toggleRemindUnassigned(e.target.checked)}
          />
          Also remind me about unassigned tasks on this board
        </label>
      )}

      {can.manageMembers && <InvitationsSection boardId={board.id} boardName={board.name} />}

      <div style={row}>
        {!leaving && (
          <Button size="sm" variant="danger" onClick={() => setLeaving(true)} disabled={busy}>
            Leave board…
          </Button>
        )}
        <div style={{ flex: 1 }} />
        <Button size="sm" onClick={onClose} disabled={busy}>
          Hide
        </Button>
      </div>
      {leaving && (
        <div style={row}>
          <span style={{ fontSize: 13.5 }}>
            Leave <strong>{board.name}</strong>? You lose access until someone invites you back.
          </span>
          <Button size="sm" variant="destructive" onClick={() => void leave()} disabled={busy}>
            Leave
          </Button>
          <Button size="sm" onClick={() => setLeaving(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}
