import { useState, type CSSProperties } from 'react'
import { useIsMobile } from '../lib/useMediaQuery'
import { COLORS, STATUS } from '../theme/constants'
import type { BulkChange } from '../data/bulk'
import { INBOX, type Color, type WorkflowStatus } from '../types/task'

export interface BulkActionBarProps {
  count: number
  /** Today's date, the default for "Move to". */
  today: string
  onApply: (change: BulkChange) => void
  onDelete: () => void
  onDone: () => void
}

const COLOR_LABELS: Record<Color, string> = {
  yellow: 'Yellow',
  pink: 'Pink',
  blue: 'Blue',
  mint: 'Mint',
  lilac: 'Lilac',
  orange: 'Orange',
}

/**
 * The selection-mode action bar (#270): move to a day or the Inbox, set a Workflow Status or a
 * color, delete, or leave selection mode. A bottom sheet on phones, a floating bar on desktop.
 *
 * Deleting asks for confirmation inline rather than through a browser dialog, and every action is
 * disabled while nothing is selected. Styling is theme-neutral on purpose, like `Toast`: the bar
 * floats over every theme's board and must stay legible on all three.
 */
export function BulkActionBar({ count, today, onApply, onDelete, onDone }: BulkActionBarProps) {
  const isMobile = useIsMobile()
  const [day, setDay] = useState(today)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const none = count === 0

  const control: CSSProperties = {
    padding: '7px 10px',
    borderRadius: 8,
    border: '1px solid #3a4a5a',
    background: '#1d2a36',
    color: '#e6f0fa',
    fontFamily: 'system-ui, sans-serif',
    fontSize: isMobile ? 16 : 13, // <16px makes iOS Safari zoom in on focus
    colorScheme: 'dark',
  }
  const button: CSSProperties = { ...control, cursor: 'pointer', fontWeight: 600 }

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      style={{
        position: 'fixed',
        zIndex: 9400,
        left: isMobile ? 0 : '50%',
        right: isMobile ? 0 : undefined,
        bottom: isMobile ? 0 : 20,
        transform: isMobile ? undefined : 'translateX(-50%)',
        maxWidth: isMobile ? undefined : 'min(980px, 96vw)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        padding: isMobile ? '12px 12px calc(12px + env(safe-area-inset-bottom))' : '10px 12px',
        background: '#14202a',
        color: '#e6f0fa',
        border: '1px solid #2a4a5a',
        borderRadius: isMobile ? '14px 14px 0 0' : 12,
        boxShadow: '0 16px 44px rgba(0,0,0,.45)',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13.5,
      }}
    >
      <span role="status" style={{ fontWeight: 700, minWidth: 90 }}>
        {count} selected
      </span>

      {confirmingDelete ? (
        <>
          <span>
            Delete {count} {count === 1 ? 'task' : 'tasks'}?
          </span>
          <button
            type="button"
            style={{ ...button, background: '#7a1f1f', borderColor: '#a33' }}
            onClick={() => {
              setConfirmingDelete(false)
              onDelete()
            }}
          >
            Confirm delete
          </button>
          <button type="button" style={button} onClick={() => setConfirmingDelete(false)}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input
              type="date"
              aria-label="Move to date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              style={control}
            />
            <button
              type="button"
              style={button}
              disabled={none || !day}
              onClick={() => onApply({ kind: 'day', day })}
            >
              Move
            </button>
            <button
              type="button"
              style={button}
              disabled={none}
              onClick={() => onApply({ kind: 'day', day: INBOX })}
            >
              To Inbox
            </button>
          </span>
          <select
            aria-label="Set status"
            value=""
            disabled={none}
            onChange={(e) => {
              if (e.target.value)
                onApply({ kind: 'status', status: e.target.value as WorkflowStatus })
            }}
            style={control}
          >
            <option value="">Status…</option>
            {STATUS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Set color"
            value=""
            disabled={none}
            onChange={(e) => {
              if (e.target.value) onApply({ kind: 'color', color: e.target.value as Color })
            }}
            style={control}
          >
            <option value="">Color…</option>
            {COLORS.map((c) => (
              <option key={c} value={c}>
                {COLOR_LABELS[c]}
              </option>
            ))}
          </select>
          <button
            type="button"
            style={button}
            disabled={none}
            onClick={() => setConfirmingDelete(true)}
          >
            Delete
          </button>
        </>
      )}

      <button type="button" style={{ ...button, marginLeft: 'auto' }} onClick={onDone}>
        Done
      </button>
    </div>
  )
}
