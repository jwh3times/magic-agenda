import { useEffect, useState, type CSSProperties } from 'react'
import { useTheme } from '../theme/ThemeProvider'
import { useIsMobile } from '../lib/useMediaQuery'
import { CAT, COLORS, PAPER, STATUS } from '../theme/constants'
import { newId } from '../lib/id'
import { isScheduled } from '../lib/dates'
import type { Category, Color, RecurFreq, Status, Task } from '../types/task'

/** Which occurrences a save/delete applies to, for a recurring series. */
export type RecurScope = 'this' | 'future'

export interface TaskEditorProps {
  initial: Task
  isNew: boolean
  onSave: (task: Task, scope?: RecurScope) => void
  onDelete: (task: Task, scope?: RecurScope) => void
  onClose: () => void
}

/** The task editor modal — ported from the prototype's buildEditor + markup. */
export function TaskEditor({ initial, isNew, onSave, onDelete, onClose }: TaskEditorProps) {
  const { theme, conf } = useTheme()
  const isMobile = useIsMobile()
  const [draft, setDraft] = useState<Task>(initial)
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

  const patch = (p: Partial<Task>) => setDraft((d) => ({ ...d, ...p }))
  const titleOk = draft.title.trim().length > 0

  const dark = theme === 'glass'
  const panelBg = dark ? '#161a2e' : '#fffdf8'
  const fg = dark ? '#eaf0ff' : '#241c12'
  const sub = dark ? 'rgba(234,240,255,.5)' : 'rgba(60,42,18,.55)'
  const fieldBg = dark ? 'rgba(255,255,255,.05)' : '#f3efe6'
  const border = dark ? 'rgba(255,255,255,.12)' : 'rgba(60,42,18,.18)'

  // <16px input text makes iOS Safari zoom the page in on focus.
  const ctlFont = isMobile ? '16px' : '13px'
  const inputBase: CSSProperties = {
    width: '100%',
    padding: '11px 13px',
    borderRadius: '10px',
    border: `1px solid ${border}`,
    background: fieldBg,
    color: fg,
    fontFamily: conf.ui,
    fontSize: isMobile ? '16px' : '14px',
    fontWeight: 500,
  }
  const fieldLabel: CSSProperties = {
    fontSize: '11px',
    fontWeight: 800,
    letterSpacing: '.7px',
    textTransform: 'uppercase',
    color: sub,
    margin: '17px 0 9px',
  }
  const btn = (bg: string, fgc: string, extra?: CSSProperties): CSSProperties => ({
    padding: '10px 18px',
    borderRadius: '9px',
    border: 'none',
    cursor: 'pointer',
    fontFamily: conf.ui,
    fontSize: '13.5px',
    fontWeight: 800,
    background: bg,
    color: fgc,
    ...extra,
  })

  const addChecklistItem = () => {
    const text = newItem.trim()
    if (!text) return
    patch({ checklist: [...draft.checklist, { id: newId(), text, done: false }] })
    setNewItem('')
  }

  const clean = (): Task => ({
    ...draft,
    title: draft.title.trim(),
    day: isScheduled(draft.day) ? draft.day : 'inbox',
    done: draft.status === 'done',
    checklist: draft.checklist.map((c) => ({ id: c.id, text: c.text, done: c.done })),
  })

  const attemptSave = () => {
    if (!titleOk) return
    if (isRecurringInstance) setScopePrompt('save')
    else onSave(clean())
  }
  const attemptDelete = () => {
    if (isRecurringInstance) setScopePrompt('delete')
    else onDelete(initial)
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
            style={{ ...inputBase, fontSize: '17px', fontWeight: 700, marginBottom: '10px' }}
          />
          <textarea
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
            placeholder="Add a short description…"
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
                  onClick={() => patch({ color: k as Color })}
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

          <div style={fieldLabel}>Category</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {(Object.keys(CAT) as Category[]).map((k) => {
              const c = CAT[k]
              const active = draft.category === k
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => patch({ category: k })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '7px',
                    padding: '7px 12px',
                    borderRadius: '20px',
                    cursor: 'pointer',
                    fontFamily: conf.ui,
                    fontSize: '12.5px',
                    fontWeight: 700,
                    border: `1px solid ${active ? c.dot : border}`,
                    background: active ? `${c.dot}22` : 'transparent',
                    color: fg,
                  }}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: c.dot,
                      flex: 'none',
                    }}
                  />
                  {c.label}
                </button>
              )
            })}
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
                  onClick={() => patch({ status: st.key as Status, done: st.key === 'done' })}
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
                  style={{ ...inputBase, width: 60, padding: '8px 10px' }}
                />
                <span style={{ fontSize: 13, color: sub }}>{recurUnit}</span>
                <span style={{ fontSize: 13, color: sub }}>until</span>
                <input
                  type="date"
                  value={draft.recurUntil ?? ''}
                  onChange={(e) => patch({ recurUntil: e.target.value || null })}
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
              Part of a repeating series — saving or deleting will ask about this occurrence vs. all
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
            {!isNew && (
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
            <button
              type="button"
              onClick={attemptSave}
              disabled={!titleOk}
              style={btn(conf.accent, conf.accentFg, { opacity: titleOk ? 1 : 0.5 })}
            >
              {isNew ? 'Add task' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {scopePrompt && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(10,8,4,.5)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 9100,
            padding: 20,
          }}
          onClick={() => setScopePrompt(null)}
        >
          <div
            style={{
              width: 'min(360px, 100%)',
              background: panelBg,
              color: fg,
              border: `1px solid ${border}`,
              borderRadius: 16,
              padding: 20,
              boxShadow: '0 40px 100px rgba(0,0,0,.5)',
              fontFamily: conf.ui,
              animation: 'modalIn .18s cubic-bezier(.2,.8,.2,1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>
              {scopePrompt === 'save' ? 'Save repeating task' : 'Delete repeating task'}
            </div>
            <div style={{ fontSize: 13, color: sub, marginBottom: 16, lineHeight: 1.45 }}>
              This task repeats. Apply to this occurrence only, or this and all future occurrences?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                type="button"
                onClick={() =>
                  scopePrompt === 'save' ? onSave(clean(), 'this') : onDelete(initial, 'this')
                }
                style={btn(fieldBg, fg)}
              >
                This occurrence
              </button>
              <button
                type="button"
                onClick={() =>
                  scopePrompt === 'save' ? onSave(clean(), 'future') : onDelete(initial, 'future')
                }
                style={
                  scopePrompt === 'save'
                    ? btn(conf.accent, conf.accentFg)
                    : btn('transparent', '#e0524a', { border: `1px solid ${border}` })
                }
              >
                This and all future
              </button>
              <button type="button" onClick={() => setScopePrompt(null)} style={btn(fieldBg, sub)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
