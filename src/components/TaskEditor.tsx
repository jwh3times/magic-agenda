import { useEffect, useState, type CSSProperties } from 'react'
import { useTheme } from '../theme/ThemeProvider'
import { CAT, COLORS, PAPER, STATUS } from '../theme/constants'
import { newId } from '../lib/id'
import { isScheduled } from '../lib/dates'
import type { Category, Color, Status, Task } from '../types/task'

export interface TaskEditorProps {
  initial: Task
  isNew: boolean
  onSave: (task: Task) => void
  onDelete: (id: string) => void
  onClose: () => void
}

/** The task editor modal — ported from the prototype's buildEditor + markup. */
export function TaskEditor({ initial, isNew, onSave, onDelete, onClose }: TaskEditorProps) {
  const { theme, conf } = useTheme()
  const [draft, setDraft] = useState<Task>(initial)
  const [newItem, setNewItem] = useState('')

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

  const inputBase: CSSProperties = {
    width: '100%',
    padding: '11px 13px',
    borderRadius: '10px',
    border: `1px solid ${border}`,
    background: fieldBg,
    color: fg,
    fontFamily: conf.ui,
    fontSize: '14px',
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

  const save = () => {
    if (!titleOk) return
    const day = isScheduled(draft.day) ? draft.day : 'inbox'
    const status = draft.status
    onSave({
      ...draft,
      title: draft.title.trim(),
      day,
      status,
      done: status === 'done',
      checklist: draft.checklist.map((c) => ({ id: c.id, text: c.text, done: c.done })),
    })
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,8,4,.55)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 9000,
        padding: '20px',
        animation: 'fadeIn .15s ease',
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: 'min(520px,100%)',
          maxHeight: '90vh',
          overflow: 'auto',
          background: panelBg,
          color: fg,
          borderRadius: '18px',
          padding: '22px',
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
                  fontSize: '13px',
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
                fontSize: '13px',
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
              fontSize: '13px',
              fontWeight: 600,
              colorScheme: dark ? 'dark' : 'light',
            }}
          />
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
              onClick={() => onDelete(draft.id)}
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
            onClick={save}
            disabled={!titleOk}
            style={btn(conf.accent, conf.accentFg, { opacity: titleOk ? 1 : 0.5 })}
          >
            {isNew ? 'Add task' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
