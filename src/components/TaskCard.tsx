import type { CSSProperties } from 'react'
import type { Task } from '../types/task'
import { cardStyles, type CardVariant } from '../theme/cardStyles'
import { useTheme } from '../theme/ThemeProvider'
import { isOverdue } from '../data/selectors'
import { chipLabel, formatTime } from '../lib/dates'
import { useToday } from '../data/todayContext'
import { useBoardActions } from './boardActionContext'
import { useLabel } from '../labels/LabelDirectoryProvider'
import { labelPresentation } from '../labels/presentation'

export interface TaskCardProps {
  task: Task
  variant: CardVariant
  dragging?: boolean
  /** Extra style merged onto the card wrapper (e.g. dnd-kit transform in Phase 4). */
  wrapStyle?: CSSProperties
}

/**
 * Presentational task card. The view half of the prototype's note markup; styling comes
 * entirely from cardStyles(). Reused by calendar cells, the inbox, kanban columns and
 * (Phase 4) the drag overlay.
 */
export function TaskCard({ task, variant, dragging, wrapStyle }: TaskCardProps) {
  const actions = useBoardActions()
  const onOpen = actions?.onOpen
  const onToggleCompletion = actions?.onToggleCompletion
  const onTogglePin = actions?.onTogglePin
  const { theme } = useTheme()
  const label = labelPresentation(useLabel(task.labelId))
  const overdue = isOverdue(task, useToday())
  const s = cardStyles(theme, task, variant, {
    dragging,
    pop: actions?.popId === task.id,
    overdue,
    labelColor: label.dotColor,
  })

  const completed = task.status === 'completed'
  const total = task.checklist.length
  const ck = task.checklist.filter((c) => c.done).length
  const hasList = total > 0
  const isInboxLike = variant === 'inbox' || variant === 'kanban'
  const isKanban = variant === 'kanban'
  const hasDesc = isInboxLike && task.description.trim().length > 0

  return (
    <div style={{ ...s.wrap, ...wrapStyle }} onClick={() => onOpen?.(task)}>
      {s.showPin && <div style={s.pinStyle} />}
      {s.showStamp && <div style={s.stampStyle}>COMPLETED</div>}

      <div style={s.titleStyle}>{task.title || 'Untitled'}</div>
      {hasDesc && <div style={s.descStyle}>{task.description}</div>}

      <div style={s.meta}>
        <span style={s.dot} />
        <span style={s.labelStyle}>{label.name}</span>
        {task.atTime && <span style={s.chipStyle}>{formatTime(task.atTime)}</span>}
        {isKanban && !task.atTime && <span style={s.chipStyle}>{chipLabel(task.day)}</span>}
        {hasList && (
          <span style={s.progStyle}>
            {ck}/{total}
          </span>
        )}
        {onTogglePin && (
          <button
            type="button"
            aria-label={task.pinned ? 'Unpin' : 'Pin'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onTogglePin(task.id)
            }}
            style={s.pinBtn}
          >
            📌
          </button>
        )}
        {/* Without a handler this is a status indicator, not a control — so it renders as a span.
            A <button> that does nothing is still focusable and still announced as a button, which
            matters wherever cards are shown decoratively (the landing preview, the drag ghost). */}
        {onToggleCompletion ? (
          <button
            type="button"
            aria-label={completed ? 'Reopen' : 'Complete'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onToggleCompletion(task.id)
            }}
            style={onTogglePin ? { ...s.check, marginLeft: '0px' } : s.check}
          >
            {completed ? '✓' : ''}
          </button>
        ) : (
          <span
            aria-hidden="true"
            style={onTogglePin ? { ...s.check, marginLeft: '0px' } : s.check}
          >
            {completed ? '✓' : ''}
          </span>
        )}
      </div>

      {hasList && (
        <div style={s.barTrack}>
          <div style={s.barFill} />
        </div>
      )}
    </div>
  )
}
