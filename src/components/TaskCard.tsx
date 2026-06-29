import type { CSSProperties } from 'react'
import type { Task } from '../types/task'
import { CAT } from '../theme/constants'
import { cardStyles, type CardVariant } from '../theme/cardStyles'
import { useTheme } from '../theme/ThemeProvider'
import { chipLabel } from '../lib/dates'

export interface TaskCardProps {
  task: Task
  variant: CardVariant
  dragging?: boolean
  pop?: boolean
  onOpen?: (task: Task) => void
  onToggleDone?: (id: string) => void
  /** Extra style merged onto the card wrapper (e.g. dnd-kit transform in Phase 4). */
  wrapStyle?: CSSProperties
}

/**
 * Presentational task card. The view half of the prototype's note markup; styling comes
 * entirely from cardStyles(). Reused by calendar cells, the inbox, kanban columns and
 * (Phase 4) the drag overlay.
 */
export function TaskCard({
  task,
  variant,
  dragging,
  pop,
  onOpen,
  onToggleDone,
  wrapStyle,
}: TaskCardProps) {
  const { theme } = useTheme()
  const s = cardStyles(theme, task, variant, { dragging, pop })

  const cat = CAT[task.category]
  const done = task.status === 'done'
  const total = task.checklist.length
  const ck = task.checklist.filter((c) => c.done).length
  const hasList = total > 0
  const isInboxLike = variant === 'inbox' || variant === 'kanban'
  const isKanban = variant === 'kanban'
  const hasDesc = isInboxLike && task.description.trim().length > 0

  return (
    <div style={{ ...s.wrap, ...wrapStyle }} onClick={() => onOpen?.(task)}>
      {s.showPin && <div style={s.pinStyle} />}
      {s.showStamp && <div style={s.stampStyle}>DONE</div>}

      <div style={s.titleStyle}>{task.title || 'Untitled'}</div>
      {hasDesc && <div style={s.descStyle}>{task.description}</div>}

      <div style={s.meta}>
        <span style={s.dot} />
        <span style={s.catStyle}>{cat.label}</span>
        {isKanban && <span style={s.chipStyle}>{chipLabel(task.day)}</span>}
        {hasList && (
          <span style={s.progStyle}>
            {ck}/{total}
          </span>
        )}
        <button
          type="button"
          aria-label={done ? 'Mark not done' : 'Mark done'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onToggleDone?.(task.id)
          }}
          style={s.check}
        >
          {done ? '✓' : ''}
        </button>
      </div>

      {hasList && (
        <div style={s.barTrack}>
          <div style={s.barFill} />
        </div>
      )}
    </div>
  )
}
