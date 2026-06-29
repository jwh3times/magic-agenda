import { useTheme } from '../theme/ThemeProvider'
import { cellChrome } from '../theme/chrome'
import { TaskCard } from './TaskCard'
import type { CellMeta } from '../data/selectors'
import type { Task } from '../types/task'
import type { BoardHandlers, PopId } from './boardHandlers'

export interface DayCellProps {
  meta: CellMeta
  notes: Task[]
  handlers: BoardHandlers
  pop: PopId
  /** True while a drag is hovering this cell (Phase 4). */
  isDrop?: boolean
}

export function DayCell({ meta, notes, handlers, pop, isDrop = false }: DayCellProps) {
  const { theme, conf } = useTheme()
  const c = cellChrome(theme, conf, meta, isDrop)
  return (
    <div style={c.cell}>
      <div style={c.head}>
        <span style={c.numStyle}>{meta.dayNum}</span>
        <button
          type="button"
          style={c.addStyle}
          onClick={(e) => {
            e.stopPropagation()
            handlers.onAddDay(meta.dateStr)
          }}
        >
          +
        </button>
      </div>
      <div style={c.notesWrap}>
        {notes.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            variant="cell"
            pop={pop === t.id}
            onOpen={handlers.onOpen}
            onToggleDone={handlers.onToggleDone}
          />
        ))}
      </div>
    </div>
  )
}
