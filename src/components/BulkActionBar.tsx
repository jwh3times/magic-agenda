import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
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
  /** Reports the bar's rendered height, so the board can keep its lanes clear of it. */
  onHeightChange?: (height: number) => void
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
export function BulkActionBar({
  count,
  today,
  onApply,
  onDelete,
  onDone,
  onHeightChange,
}: BulkActionBarProps) {
  const isMobile = useIsMobile()
  const ref = useRef<HTMLDivElement>(null)

  // The bar wraps to more rows on narrow screens and while confirming, so it is measured rather
  // than guessed. ResizeObserver is absent in jsdom; the initial measurement still runs there.
  useLayoutEffect(() => {
    const node = ref.current
    if (!node || !onHeightChange) return
    onHeightChange(node.offsetHeight)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => onHeightChange(node.offsetHeight))
    observer.observe(node)
    return () => observer.disconnect()
  }, [onHeightChange])
  const [day, setDay] = useState(today)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const none = count === 0
  const cancelRef = useRef<HTMLButtonElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(false)

  // The button that was pressed disappears when the confirmation swaps in (and back), so focus is
  // placed deliberately: on the non-destructive Cancel while asking, and back on Delete after. Left
  // to fall to <body>, a keyboard user would lose their place, and Escape would reach the board
  // instead of this bar.
  useEffect(() => {
    if (confirmingDelete) cancelRef.current?.focus()
    else if (wasConfirming.current) deleteRef.current?.focus()
    wasConfirming.current = confirmingDelete
  }, [confirmingDelete])

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
      ref={ref}
      role="toolbar"
      aria-label="Bulk actions"
      // Escape while confirming cancels the confirmation only. preventDefault is what tells the
      // board's own Escape handler (which would leave selection mode) that this one was handled.
      onKeyDown={(e) => {
        if (e.key === 'Escape' && confirmingDelete) {
          e.preventDefault()
          setConfirmingDelete(false)
        }
      }}
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
          <button
            ref={cancelRef}
            type="button"
            style={button}
            onClick={() => setConfirmingDelete(false)}
          >
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
            ref={deleteRef}
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
