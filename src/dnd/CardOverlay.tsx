import { useTheme } from '../theme/ThemeProvider'
import { cardStyles } from '../theme/cardStyles'
import { CAT } from '../theme/constants'
import type { Task } from '../types/task'

/**
 * The drag ghost rendered inside dnd-kit's DragOverlay. A simplified card (title + category)
 * with rotation suppressed and a slight scale-up — ported from the prototype's `buildGhost`.
 */
export function CardOverlay({ task, width }: { task: Task; width?: number }) {
  const { theme } = useTheme()
  const s = cardStyles(theme, task, 'ghost')
  const cat = CAT[task.category]
  const baseTransform =
    s.wrap.transform && s.wrap.transform !== 'none' ? `${s.wrap.transform} ` : ''

  return (
    <div
      style={{
        ...s.wrap,
        width,
        cursor: 'grabbing',
        transform: `${baseTransform}scale(1.04)`,
        opacity: 1,
      }}
    >
      <div style={s.titleStyle}>{task.title || 'Untitled'}</div>
      <div style={s.meta}>
        <span style={s.dot} />
        <span style={s.catStyle}>{cat.label}</span>
      </div>
    </div>
  )
}
