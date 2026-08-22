import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useBoardSession } from '../board/BoardDirectoryProvider'
import { useLabelDirectoryContext } from '../labels/LabelDirectoryProvider'
import { explainProblem, NAME_MAX_LENGTH, type LabelProblem } from '../labels/labelIntent'
import { useIsMobile } from '../lib/useMediaQuery'
import { useTheme } from '../theme/ThemeProvider'
import type { Label } from '../types/label'

const DEFAULT_NEW_COLOR = '#2563eb'

// ≥16px so iOS Safari does not zoom the page on focus.
const textInput: CSSProperties = { fontSize: 16, padding: '8px 10px', minWidth: 0, flex: 1 }
const hint: CSSProperties = { fontSize: 12, opacity: 0.7 }
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }

/**
 * Owner-only management of the selected Board's shared Label vocabulary.
 *
 * Two things are deliberately *not* decided here. Whether a change is legal is
 * `labels/labelIntent.ts`, so the same refusal reads identically whether the client caught it or
 * PostgREST did. Whether the caller may manage at all is `board/role.ts` — and `can.manageLabels`
 * only hides controls: the Owner-only policies and column grants on `labels` are the boundary,
 * and this component renders read-only for everyone else rather than pretending to enforce it.
 */
export function LabelsSection() {
  const { conf } = useTheme()
  const isMobile = useIsMobile()
  const { can } = useBoardSession()
  const {
    labels,
    loading,
    error,
    offline,
    reload,
    createLabel,
    renameLabel,
    recolorLabel,
    reorderLabel,
    deleteLabel,
  } = useLabelDirectoryContext()

  const [draftName, setDraftName] = useState('')
  const [draftColor, setDraftColor] = useState(DEFAULT_NEW_COLOR)
  const [problem, setProblem] = useState<LabelProblem | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (write: () => Promise<LabelProblem | null>) => {
    setBusy(true)
    setProblem(await write())
    setBusy(false)
  }

  const onAdd = async () => {
    setBusy(true)
    const result = await createLabel(draftName, draftColor)
    setProblem(result)
    if (!result) {
      setDraftName('')
      setDraftColor(DEFAULT_NEW_COLOR)
    }
    setBusy(false)
  }

  if (loading) return <div style={hint}>Loading labels…</div>

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div role="alert" style={{ fontSize: 13 }}>
          Could not load labels. {error}
        </div>
        <button type="button" onClick={() => void reload()} style={{ alignSelf: 'flex-start' }}>
          Try again
        </button>
      </div>
    )
  }

  const readOnly = !can.manageLabels

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={hint}>
        Labels are shared by everyone on this board. A task has at most one, and tasks with none are
        Unlabeled.
      </div>

      {offline && (
        <div style={hint} role="status">
          Showing the last saved labels. Reconnect to make changes.
        </div>
      )}

      {labels.length === 0 ? (
        <div style={hint}>No labels yet. Every task on this board is Unlabeled.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {labels.map((label, index) => (
            <LabelRow
              key={label.id}
              label={label}
              isFirst={index === 0}
              isLast={index === labels.length - 1}
              readOnly={readOnly || offline}
              busy={busy}
              confirmingDelete={pendingDelete === label.id}
              onRename={(name) => void run(() => renameLabel(label.id, name))}
              onRecolor={(color) => void run(() => recolorLabel(label.id, color))}
              onMove={(delta) => void run(() => reorderLabel(label.id, delta))}
              onAskDelete={() => {
                setProblem(null)
                setPendingDelete(label.id)
              }}
              onCancelDelete={() => setPendingDelete(null)}
              onConfirmDelete={() => {
                setPendingDelete(null)
                void run(() => deleteLabel(label.id))
              }}
            />
          ))}
        </ul>
      )}

      {readOnly ? (
        <div style={hint}>Only the board owner can add, rename, reorder, or delete labels.</div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'stretch' : 'flex-end',
            gap: 8,
            borderTop: `1px solid ${conf.cellBorder ? 'currentColor' : 'transparent'}`,
            paddingTop: 12,
            opacity: offline ? 0.6 : 1,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            <label htmlFor="settings-new-label" style={hint}>
              New label
            </label>
            <div style={row}>
              <input
                id="settings-new-label"
                value={draftName}
                maxLength={NAME_MAX_LENGTH}
                placeholder="e.g. Deep work"
                disabled={busy || offline}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void onAdd()
                }}
                style={textInput}
              />
              <input
                type="color"
                aria-label="Colour for the new label"
                value={draftColor}
                disabled={busy || offline}
                onChange={(e) => setDraftColor(e.target.value)}
                style={{ width: 44, height: 36, padding: 2 }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => void onAdd()}
            disabled={busy || offline || draftName.trim() === ''}
          >
            Add label
          </button>
        </div>
      )}

      {problem && (
        <div role="alert" style={{ fontSize: 13 }}>
          {explainProblem(problem)}
        </div>
      )}
    </div>
  )
}

interface LabelRowProps {
  label: Label
  isFirst: boolean
  isLast: boolean
  readOnly: boolean
  busy: boolean
  confirmingDelete: boolean
  onRename: (name: string) => void
  onRecolor: (color: string) => void
  onMove: (delta: number) => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
}

/**
 * One Label. The name input holds a local draft and commits on blur or Enter, so a rename is one
 * write rather than one per keystroke; Escape restores the committed name.
 */
function LabelRow({
  label,
  isFirst,
  isLast,
  readOnly,
  busy,
  confirmingDelete,
  onRename,
  onRecolor,
  onMove,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: LabelRowProps) {
  const [draft, setDraft] = useState(label.name)
  // A rename from elsewhere (catch-up, another tab) should win over an untouched draft.
  const [committed, setCommitted] = useState(label.name)
  const latest = useRef({ draft, committedName: label.name, onRename })
  const dispatchedDraft = useRef<string | null>(null)
  if (committed !== label.name) {
    setCommitted(label.name)
    setDraft(label.name)
  }

  useEffect(() => {
    latest.current = { draft, committedName: label.name, onRename }
  }, [draft, label.name, onRename])

  useEffect(
    () => () => {
      const pending = latest.current
      if (pending.draft !== pending.committedName && pending.draft !== dispatchedDraft.current) {
        pending.onRename(pending.draft)
      }
    },
    [],
  )

  const commit = () => {
    if (draft === label.name) return
    dispatchedDraft.current = draft
    onRename(draft)
  }

  return (
    <li style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={row}>
        <input
          type="color"
          aria-label={`Colour for ${label.name}`}
          value={label.dotColor}
          disabled={readOnly || busy}
          onChange={(e) => onRecolor(e.target.value)}
          style={{ width: 36, height: 32, padding: 2, flex: '0 0 auto' }}
        />
        {readOnly ? (
          <span style={{ ...textInput, padding: '8px 0' }}>{label.name}</span>
        ) : (
          <input
            aria-label={`Name for ${label.name}`}
            value={draft}
            maxLength={NAME_MAX_LENGTH}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setDraft(label.name)
            }}
            style={textInput}
          />
        )}
        {!readOnly && (
          <>
            <button
              type="button"
              aria-label={`Move ${label.name} up`}
              disabled={isFirst || busy}
              onClick={() => onMove(-1)}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move ${label.name} down`}
              disabled={isLast || busy}
              onClick={() => onMove(1)}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label={`Delete ${label.name}`}
              disabled={busy}
              onClick={onAskDelete}
            >
              Delete
            </button>
          </>
        )}
      </div>

      {confirmingDelete && (
        <div style={{ ...row, flexWrap: 'wrap', fontSize: 13 }}>
          <span>
            Delete “{label.name}”? Tasks using it become Unlabeled — the tasks themselves are kept.
          </span>
          <button type="button" onClick={onConfirmDelete} disabled={busy}>
            Delete label
          </button>
          <button type="button" onClick={onCancelDelete} disabled={busy}>
            Cancel
          </button>
        </div>
      )}
    </li>
  )
}
