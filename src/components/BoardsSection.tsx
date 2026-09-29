import { useState, type CSSProperties } from 'react'
import { useBoardDirectoryContext } from '../board/BoardDirectoryProvider'
import { BOARD_NAME_MAX_LENGTH } from '../board/boardName'
import { capabilitiesFor } from '../board/role'
import type { BoardSummary } from '../board/selection'
import { useThemeOrDefault } from '../theme/ThemeProvider'
import { insetPanelStyle } from '../theme/controls'
import { CalendarFeedPanel } from './CalendarFeedPanel'
import { Button, TextInput } from './controls'
import { MembersPanel } from './MembersPanel'

const hint: CSSProperties = { fontSize: 12, opacity: 0.7 }
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }

/**
 * Board management on `/settings`: what you belong to, and the one destructive action.
 *
 * Deletion lives here rather than in the toolbar switcher on purpose. It is the most destructive
 * action in the product — see `deleteBoard` — and putting it one click from the control people use
 * to *switch* Boards would put "open my other board" and "destroy this one" in the same menu.
 *
 * The confirmation asks for the Board's **name**, not the word "delete" that `DangerZone` accepts.
 * That is a deliberate difference rather than an inconsistency: an Account has exactly one account
 * to delete, so "delete" is unambiguous there, but it has several Boards, and a generic confirmation
 * would read identically for the Board you meant and the one above it in the list.
 *
 * The calendar feed is offered on **every** row, whatever the role: it reads the caller's own
 * Membership, and reading the Board is what every role, Viewer included, already has. Only one feed
 * panel is open at a time, so at most one token is on screen.
 *
 * Members are offered only behind the `board-sharing` feature flag (#438), on every row: every
 * current member may see who else is on a Board and may leave it, while role changes and removals
 * appear only for an Owner.
 */
export function BoardsSection({ boardSharing = false }: { boardSharing?: boolean }) {
  const { boards, selectedBoardId, deleteBoard, renameBoard, reload } = useBoardDirectoryContext()
  const { theme, conf } = useThemeOrDefault()
  const [pending, setPending] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [feedOpen, setFeedOpen] = useState<string | null>(null)
  const [membersOpen, setMembersOpen] = useState<string | null>(null)
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (boards.length === 0) {
    return <div style={hint}>You have no boards. Create one from the board switcher.</div>
  }

  const cancel = () => {
    setPending(null)
    setConfirm('')
    setError(null)
  }

  const rename = async (board: BoardSummary, next: string) => {
    setBusy(true)
    const failure = await renameBoard(board.id, next)
    setBusy(false)
    setError(failure)
    if (!failure) setRenaming(null)
  }

  const remove = async (board: BoardSummary) => {
    setBusy(true)
    const failure = await deleteBoard(board.id)
    setBusy(false)
    if (failure) {
      setError(failure)
      return
    }
    cancel()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={hint}>
        Each board keeps its own tasks and labels. Deleting one removes everything in it.
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
        {boards.map((board) => {
          const can = capabilitiesFor(board.role)
          const confirming = pending === board.id
          // Compared case-insensitively and trimmed: the confirmation is friction against acting
          // without reading, not a spelling test.
          const armed = confirm.trim().toLowerCase() === board.name.trim().toLowerCase()

          return (
            <li key={board.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={row}>
                {renaming === board.id ? (
                  <BoardNameField
                    board={board}
                    busy={busy}
                    onCommit={(next) => void rename(board, next)}
                    onCancel={() => {
                      setRenaming(null)
                      setError(null)
                    }}
                  />
                ) : (
                  <span style={{ fontWeight: 600 }}>{board.name}</span>
                )}
                {board.id === selectedBoardId && <span style={hint}>current</span>}
                <div style={{ flex: 1 }} />
                {!confirming && renaming !== board.id && feedOpen !== board.id && (
                  <Button size="sm" onClick={() => setFeedOpen(board.id)} disabled={busy}>
                    Calendar feed…
                  </Button>
                )}
                {boardSharing &&
                  !confirming &&
                  renaming !== board.id &&
                  membersOpen !== board.id && (
                    <Button size="sm" onClick={() => setMembersOpen(board.id)} disabled={busy}>
                      Members…
                    </Button>
                  )}
                {can.configureBoard && !confirming && renaming !== board.id && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setError(null)
                      setRenaming(board.id)
                    }}
                    disabled={busy}
                  >
                    Rename
                  </Button>
                )}
                {can.deleteBoard && !confirming && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      setError(null)
                      setConfirm('')
                      setPending(board.id)
                    }}
                    disabled={busy}
                  >
                    Delete…
                  </Button>
                )}
              </div>

              {error && renaming === board.id && (
                <div role="alert" style={{ color: conf.dangerFg, fontSize: 13 }}>
                  {error}
                </div>
              )}

              {boardSharing && membersOpen === board.id && (
                <div style={insetPanelStyle(theme)}>
                  <MembersPanel
                    board={board}
                    onClose={() => setMembersOpen(null)}
                    onOwnMembershipChanged={() => void reload()}
                  />
                </div>
              )}

              {feedOpen === board.id && (
                <div style={insetPanelStyle(theme)}>
                  <CalendarFeedPanel board={board} onClose={() => setFeedOpen(null)} />
                </div>
              )}

              {confirming && (
                <div
                  style={{
                    ...insetPanelStyle(theme),
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
                    Permanently delete <strong>{board.name}</strong>, including every task and label
                    in it. This cannot be undone. Type <strong>{board.name}</strong> to confirm.
                  </p>
                  <TextInput
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder={board.name}
                    aria-label={`Type ${board.name} to confirm deletion`}
                    disabled={busy}
                    style={{ maxWidth: 260 }}
                  />
                  {error && <div style={{ color: conf.dangerFg, fontSize: 13 }}>{error}</div>}
                  <div style={row}>
                    <Button
                      variant={armed ? 'destructive' : 'danger'}
                      disabled={!armed || busy}
                      onClick={() => void remove(board)}
                    >
                      {busy ? 'Deleting…' : 'Delete board'}
                    </Button>
                    <Button onClick={cancel} disabled={busy}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * One Board's name as an editable field, committing on blur or Enter and abandoning on Escape.
 *
 * The draft is local so a rename is one write rather than one per keystroke, and the field is keyed
 * to the committed name so a change arriving from elsewhere replaces an untouched draft rather than
 * being overwritten by it.
 */
function BoardNameField({
  board,
  busy,
  onCommit,
  onCancel,
}: {
  board: BoardSummary
  busy: boolean
  onCommit: (next: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(board.name)

  return (
    <TextInput
      aria-label={`Name for ${board.name}`}
      value={draft}
      maxLength={BOARD_NAME_MAX_LENGTH}
      autoFocus
      disabled={busy}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => (draft === board.name ? onCancel() : onCommit(draft))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(board.name)
          onCancel()
        }
      }}
      style={{ padding: '6px 8px', flex: '1 1 160px' }}
    />
  )
}
