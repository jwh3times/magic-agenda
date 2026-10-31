import { useTheme } from '../theme/ThemeProvider'
import { cardStyles } from '../theme/cardStyles'
import type { Task } from '../types/task'
import { useLabel } from '../labels/LabelDirectoryProvider'
import { labelPresentation } from '../labels/presentation'

const COMPACT_WIDTH = 210

/**
 * The drag ghost rendered inside dnd-kit's DragOverlay. A simplified card (title + Label)
 * with rotation suppressed and a slight scale-up — ported from the prototype's `buildGhost`.
 *
 * `compact` is the phone Calendar's (#566): small enough to see the grid around it, one line of
 * title, and in place of the Label the name of the `target`, which a finger would otherwise hide.
 */
export function CardOverlay({
  task,
  width,
  compact = false,
  target,
}: {
  task: Task
  width?: number
  compact?: boolean
  target?: string
}) {
  const { theme } = useTheme()
  const label = labelPresentation(useLabel(task.labelId))
  const s = cardStyles(theme, task, 'ghost', { labelColor: label.dotColor })
  const baseTransform =
    s.wrap.transform && s.wrap.transform !== 'none' ? `${s.wrap.transform} ` : ''

  return (
    <div
      style={{
        ...s.wrap,
        width: compact ? COMPACT_WIDTH : width,
        boxSizing: compact ? 'border-box' : s.wrap.boxSizing,
        cursor: 'grabbing',
        transform: `${baseTransform}scale(1.04)`,
        opacity: 1,
      }}
    >
      <div
        style={{
          ...s.titleStyle,
          ...(compact && { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
        }}
      >
        {task.title || 'Untitled'}
      </div>
      <div style={s.meta}>
        {!target && <span style={s.dot} />}
        <span style={s.labelStyle}>{target ? `→ ${target}` : label.name}</span>
      </div>
    </div>
  )
}
