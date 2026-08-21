import { useEffect, useState } from 'react'
import { removesRule, type RecurScope } from '../data/series'
import { cleanDraft, intendDelete, intendSave } from '../data/editIntent'
import { useTheme } from '../theme/ThemeProvider'
import { useIsMobile } from '../lib/useMediaQuery'
import { COLORS, PAPER, STATUS } from '../theme/constants'
import { newId } from '../lib/id'
import { isScheduled } from '../lib/dates'
import { editorChrome } from './editorChrome'
import { ScopePrompt } from './ScopePrompt'
import type { RecurFreq, TaskDraft } from '../types/task'
import { useLabelDirectoryContext } from '../labels/LabelDirectoryProvider'
import { UNLABELED_DOT_COLOR } from '../labels/presentation'

export interface TaskEditorProps {
  /**
   * The task to edit. **Not synced after mount** — `draft` is seeded from it once, so a caller
   * changing `initial` without remounting shows stale fields. `Board` keys the editor on
   * `task.id` for exactly this reason.
   */
  initial: TaskDraft
  isNew: boolean
  /** `scope` is definite for a recurring instance, and `undefined` only where it is meaningless. */
  onSave: (task: TaskDraft, scope?: RecurScope) => void
  /**
   * Receives only the task's id: the data layer resolves the row from its own state. See
   * `intendDelete` for why nothing more crosses this seam (#132).
   */
  onDelete: (id: string, scope?: RecurScope) => void
  onClose: () => void
  /** True while hydrated from an offline snapshot: every field is disabled and there is no way
   * to save or delete, since a write against a dead network would fail silently. */
  readOnly?: boolean
  /** Board capability: Viewers may edit other fields only when separately allowed, never Labels. */
  canAssignLabels?: boolean
}

/** The task editor modal — ported from the prototype's buildEditor + markup. */
export function TaskEditor({
  initial,
  isNew,
  onSave,
  onDelete,
  onClose,
  readOnly,
  canAssignLabels = true,
}: TaskEditorProps) {
  const { theme, conf } = useTheme()
  const isMobile = useIsMobile()
  const { labels } = useLabelDirectoryContext()
  const [draft, setDraft] = useState<TaskDraft>(initial)
  const [newItem, setNewItem] = useState('')
  const [scopePrompt, setScopePrompt] = useState<null | 'save' | 'delete'>(null)
  const isRecurringInstance = !isNew && !!draft.recurParentId

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const patch = (p: Partial<TaskDraft>) => setDraft((d) => ({ ...d, ...p }))
  const titleOk = draft.title.trim().length > 0
  /**
   * A Recurrence Rule with no Scheduled Day produces no Occurrence Dates at all, so saving one
   * files the Task away as a template that materializes nothing and the card leaves the board with
   * no error (#209). The warning below the Repeat field has always said so; only now does it bind.
   */
  const recurNeedsDay = draft.recurFreq !== 'none' && !isScheduled(draft.day)
  const canSave = titleOk && !recurNeedsDay

  const chrome = editorChrome(theme, conf, isMobile)
  const { dark, panelBg, fg, sub, fieldBg, border, ctlFont, inputBase, fieldLabel, btn } = chrome

  // Read-only arrives when the board falls back to an offline snapshot. CLEAR the prompt rather
  // than hiding it: hiding left `scopePrompt` set, so flipping back re-opened a stale prompt.
  // A render-phase update, which is React's documented way to derive state from a prop change.
  if (readOnly && scopePrompt !== null) setScopePrompt(null)

  const addChecklistItem = () => {
    const text = newItem.trim()
    if (!text) return
    patch({ checklist: [...draft.checklist, { id: newId(), text, done: false }] })
    setNewItem('')
  }

  const attemptSave = () => {
    const intent = intendSave(initial, draft, isNew)
    if (intent.kind === 'blocked') return
    if (intent.kind === 'ask') setScopePrompt('save')
    // Called with one argument when there is no scope, rather than an explicit `undefined`:
    // `onSave(task)` and `onSave(task, undefined)` are the same to the callee but not to a spy.
    else if (intent.scope) onSave(intent.task, intent.scope)
    else onSave(intent.task)
  }

  const attemptDelete = () => {
    const intent = intendDelete(initial, isNew)
    if (intent.kind === 'ask') setScopePrompt('delete')
    else onDelete(intent.id)
  }

  const chooseScope = (scope: RecurScope) => {
    if (scopePrompt === 'save') onSave(cleanDraft(draft), scope)
    else onDelete(initial.id, scope)
  }

  const recurUnit =
    draft.recurFreq === 'daily' ? 'day(s)' : draft.recurFreq === 'weekly' ? 'week(s)' : 'month(s)'

  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(10,8,4,.55)',
          backdropFilter: 'blur(3px)',
          WebkitBackdropFilter: 'blur(3px)',
          display: 'grid',
          placeItems: isMobile ? 'end stretch' : 'center', // bottom sheet on phones
          zIndex: 9000,
          padding: isMobile ? 0 : '20px',
          animation: 'fadeIn .15s ease',
        }}
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          style={{
            width: isMobile ? '100%' : 'min(520px,100%)',
            maxHeight: '90vh',
            overflow: 'auto',
            background: panelBg,
            color: fg,
            borderRadius: isMobile ? '18px 18px 0 0' : '18px',
            padding: isMobile ? '18px 16px 26px' : '22px',
            boxShadow: '0 40px 100px rgba(0,0,0,.5)',
            border: `1px solid ${border}`,
            fontFamily: conf.ui,
            animation: 'modalIn .2s cubic-bezier(.2,.8,.2,1)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '14px',
            }}
          >
            <div
              style={{
                fontSize: '12px',
                fontWeight: 800,
                letterSpacing: '.5px',
                textTransform: 'uppercase',
                color: sub,
              }}
            >
              {isNew ? 'New task' : 'Edit task'}
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              style={{
                width: '30px',
                height: '30px',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                background: fieldBg,
                color: fg,
                fontSize: '13px',
                padding: 0,
              }}
            >
              ✕
            </button>
          </div>

          <input
            value={draft.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="Task title…"
            autoFocus
            disabled={readOnly}
            style={{ ...inputBase, fontSize: '17px', fontWeight: 700, marginBottom: '10px' }}
          />
          <textarea
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
            placeholder="Add a short description…"
            disabled={readOnly}
            style={{ ...inputBase, minHeight: '62px', resize: 'vertical', lineHeight: 1.45 }}
          />

          <div style={fieldLabel}>Note color</div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {COLORS.map((k) => {
              const P = PAPER[theme][k]
              const active = draft.color === k
              const swatch = dark ? (P.edge ?? P.bg).replace(/[\d.]+\)$/, '.9)') : P.bg
              return (
                <button
                  key={k}
                  type="button"
                  aria-label={k}
                  onClick={() => patch({ color: k })}
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '9px',
                    cursor: 'pointer',
                    background: swatch,
                    border: active ? `3px solid ${conf.accent}` : `1px solid ${border}`,
                    boxShadow: active ? `0 0 0 2px ${panelBg} inset` : 'none',
                    padding: 0,
                  }}
                />
              )
            })}
          </div>

          <div style={fieldLabel}>Label</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[{ id: null, name: 'Unlabeled', dotColor: UNLABELED_DOT_COLOR }, ...labels].map(
              (label) => {
                const active = draft.labelId === label.id
                return (
                  <button
                    key={label.id ?? 'unlabeled'}
                    type="button"
                    aria-pressed={active}
                    disabled={readOnly || !canAssignLabels}
                    onClick={() => patch({ labelId: label.id })}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '7px',
                      padding: '7px 12px',
                      borderRadius: '20px',
                      cursor: readOnly || !canAssignLabels ? 'not-allowed' : 'pointer',
                      fontFamily: conf.ui,
                      fontSize: '12.5px',
                      fontWeight: 700,
                      border: `1px solid ${active ? label.dotColor : border}`,
                      background: active ? `${label.dotColor}22` : 'transparent',
                      color: fg,
                      opacity: readOnly || !canAssignLabels ? 0.55 : 1,
                    }}
                  >
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: label.dotColor,
                        flex: 'none',
                      }}
                    />
                    {label.name}
                  </button>
                )
              },
            )}
          </div>

          <div style={fieldLabel}>Checklist</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            {draft.checklist.map((it, i) => (
              <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                <button
                  type="button"
                  aria-label={it.done ? 'Uncheck item' : 'Check item'}
                  onClick={() =>
                    patch({
                      checklist: draft.checklist.map((x, j) =>
                        j === i ? { ...x, done: !x.done } : x,
                      ),
                    })
                  }
                  style={{
                    width: '22px',
                    height: '22px',
                    flex: 'none',
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    border: `1.5px solid ${border}`,
                    background: it.done ? conf.accent : 'transparent',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: '12px',
                    padding: 0,
                  }}
                >
                  {it.done ? '✓' : ''}
                </button>
                <input
                  value={it.text}
                  onChange={(e) =>
                    patch({
                      checklist: draft.checklist.map((x, j) =>
                        j === i ? { ...x, text: e.target.value } : x,
                      ),
                    })
                  }
                  disabled={readOnly}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: `1px solid ${border}`,
                    background: fieldBg,
                    color: fg,
                    fontFamily: conf.ui,
                    fontSize: ctlFont,
                    textDecoration: it.done ? 'line-through' : 'none',
                    opacity: it.done ? 0.65 : 1,
                  }}
                />
                <button
                  type="button"
                  aria-label="Remove item"
                  onClick={() => patch({ checklist: draft.checklist.filter((_, j) => j !== i) })}
                  style={{
                    width: '26px',
                    height: '26px',
                    flex: 'none',
                    border: 'none',
                    borderRadius: '7px',
                    cursor: 'pointer',
                    background: 'transparent',
                    color: sub,
                    fontSize: '12px',
                    padding: 0,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <span
                style={{
                  width: '22px',
                  height: '22px',
                  flex: 'none',
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: '6px',
                  border: `1px dashed ${border}`,
                  color: sub,
                  fontSize: '14px',
                }}
              >
                +
              </span>
              <input
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addChecklistItem()
                  }
                }}
                placeholder="Add a subtask and press Enter…"
                disabled={readOnly}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  borderRadius: '8px',
                  border: `1px solid ${border}`,
                  background: fieldBg,
                  color: fg,
                  fontFamily: conf.ui,
                  fontSize: ctlFont,
                }}
              />
            </div>
          </div>

          <div style={fieldLabel}>Status</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {STATUS.map((st) => {
              const active = draft.status === st.key
              return (
                <button
                  key={st.key}
                  type="button"
                  onClick={() => patch({ status: st.key, done: st.key === 'done' })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '7px',
                    padding: '7px 13px',
                    borderRadius: '20px',
                    cursor: 'pointer',
                    fontFamily: conf.ui,
                    fontSize: '12.5px',
                    fontWeight: 700,
                    border: `1px solid ${active ? st.accent : border}`,
                    background: active ? `${st.accent}22` : 'transparent',
                    color: fg,
                  }}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: st.accent,
                      flex: 'none',
                    }}
                  />
                  {st.label}
                </button>
              )
            })}
          </div>

          <div style={fieldLabel}>Pin</div>
          <button
            type="button"
            onClick={() => patch({ pinned: !draft.pinned })}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              padding: '7px 13px',
              borderRadius: '20px',
              cursor: 'pointer',
              fontFamily: conf.ui,
              fontSize: '12.5px',
              fontWeight: 700,
              border: `1px solid ${draft.pinned ? conf.accent : border}`,
              background: draft.pinned ? `${conf.accent}22` : 'transparent',
              color: fg,
            }}
          >
            📌 {draft.pinned ? 'Pinned' : 'Pin this note'}
          </button>

          <div style={fieldLabel}>Schedule</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <input
              type="date"
              value={isScheduled(draft.day) ? draft.day : ''}
              onChange={(e) => patch({ day: e.target.value || 'inbox' })}
              disabled={readOnly}
              style={{
                padding: '9px 12px',
                borderRadius: '9px',
                border: `1px solid ${border}`,
                background: fieldBg,
                color: fg,
                fontFamily: conf.ui,
                fontSize: ctlFont,
                fontWeight: 600,
                colorScheme: dark ? 'dark' : 'light',
              }}
            />
            <input
              type="time"
              aria-label="Due time"
              value={draft.atTime ?? ''}
              onChange={(e) => patch({ atTime: e.target.value || null })}
              disabled={readOnly}
              style={{
                padding: '9px 12px',
                borderRadius: '9px',
                border: `1px solid ${border}`,
                background: fieldBg,
                color: fg,
                fontFamily: conf.ui,
                fontSize: ctlFont,
                fontWeight: 600,
                colorScheme: dark ? 'dark' : 'light',
              }}
            />
            {draft.atTime && (
              <button
                type="button"
                aria-label="Clear time"
                onClick={() => patch({ atTime: null })}
                style={{
                  padding: '9px 12px',
                  borderRadius: '9px',
                  cursor: 'pointer',
                  fontFamily: conf.ui,
                  fontSize: '12.5px',
                  fontWeight: 700,
                  border: `1px solid ${border}`,
                  background: 'transparent',
                  color: fg,
                }}
              >
                ✕ time
              </button>
            )}
            <button
              type="button"
              onClick={() => patch({ day: 'inbox' })}
              style={{
                padding: '9px 14px',
                borderRadius: '9px',
                cursor: 'pointer',
                fontFamily: conf.ui,
                fontSize: '12.5px',
                fontWeight: 700,
                border: `1px solid ${draft.day === 'inbox' ? conf.accent : border}`,
                background: draft.day === 'inbox' ? `${conf.accent}22` : 'transparent',
                color: fg,
              }}
            >
              {draft.day === 'inbox' ? '✓ Inbox' : 'Send to inbox'}
            </button>
          </div>

          <div style={fieldLabel}>Repeat</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <select
              value={draft.recurFreq}
              onChange={(e) => patch({ recurFreq: e.target.value as RecurFreq })}
              disabled={readOnly}
              style={{
                padding: '9px 12px',
                borderRadius: '9px',
                border: `1px solid ${border}`,
                background: fieldBg,
                color: fg,
                fontFamily: conf.ui,
                fontSize: ctlFont,
                fontWeight: 600,
                colorScheme: dark ? 'dark' : 'light',
              }}
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            {draft.recurFreq !== 'none' && (
              <>
                <span style={{ fontSize: 13, color: sub }}>every</span>
                <input
                  type="number"
                  min={1}
                  value={draft.recurInterval}
                  onChange={(e) =>
                    patch({ recurInterval: Math.max(1, Number(e.target.value) || 1) })
                  }
                  disabled={readOnly}
                  style={{ ...inputBase, width: 60, padding: '8px 10px' }}
                />
                <span style={{ fontSize: 13, color: sub }}>{recurUnit}</span>
                <span style={{ fontSize: 13, color: sub }}>until</span>
                <input
                  type="date"
                  value={draft.recurUntil ?? ''}
                  onChange={(e) => patch({ recurUntil: e.target.value || null })}
                  disabled={readOnly}
                  style={{
                    padding: '9px 12px',
                    borderRadius: '9px',
                    border: `1px solid ${border}`,
                    background: fieldBg,
                    color: fg,
                    fontFamily: conf.ui,
                    fontSize: ctlFont,
                    fontWeight: 600,
                    colorScheme: dark ? 'dark' : 'light',
                  }}
                />
              </>
            )}
          </div>
          {draft.recurFreq !== 'none' && !isScheduled(draft.day) && (
            <div style={{ fontSize: 12, color: '#d98c3a', marginTop: 8 }}>
              Pick a start date above — repeats need a scheduled day to generate occurrences.
            </div>
          )}
          {isRecurringInstance && (
            <div style={{ fontSize: 12, color: sub, marginTop: 8 }}>
              Part of a repeating series — saving or deleting may ask about this occurrence vs. all
              future.
            </div>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginTop: '22px',
              paddingTop: '16px',
              borderTop: `1px solid ${border}`,
            }}
          >
            {!isNew && !readOnly && (
              <button
                type="button"
                onClick={attemptDelete}
                style={btn('transparent', '#e0524a', { border: `1px solid ${border}` })}
              >
                Delete
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button type="button" onClick={onClose} style={btn(fieldBg, fg)}>
              Cancel
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={attemptSave}
                disabled={!canSave}
                style={btn(conf.accent, conf.accentFg, { opacity: canSave ? 1 : 0.5 })}
              >
                {isNew ? 'Add task' : 'Save'}
              </button>
            )}
          </div>
        </div>
      </div>

      {scopePrompt && (
        <ScopePrompt
          mode={scopePrompt}
          // Only the save path can end the Series; the delete prompt's heading already says so.
          endsSeries={scopePrompt === 'save' && removesRule(initial, draft)}
          chrome={chrome}
          onChoose={chooseScope}
          onCancel={() => setScopePrompt(null)}
        />
      )}
    </>
  )
}
