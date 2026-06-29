import { useTheme } from '../theme/ThemeProvider'
import { cellChrome } from '../theme/chrome'
import { DropLane } from '../dnd/DropLane'
import { SortableCard } from '../dnd/SortableCard'
import type { CellMeta } from '../data/selectors'
import type { Task } from '../types/task'
import type { BoardHandlers, PopId } from './boardHandlers'

export interface DayCellProps {
  meta: CellMeta
  notes: Task[]
  handlers: BoardHandlers
  pop: PopId
  /** True while a drag is hovering this cell (Phase 11 gap indicator). */
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
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            handlers.onAddDay(meta.dateStr)
          }}
        >
          +
        </button>
      </div>
      <DropLane id={meta.dateStr} itemIds={notes.map((n) => n.id)} style={c.notesWrap}>
        {notes.map((t) => (
          <SortableCard
            key={t.id}
            task={t}
            variant="cell"
            pop={pop === t.id}
            onOpen={handlers.onOpen}
            onToggleDone={handlers.onToggleDone}
          />
        ))}
      </DropLane>
    </div>
  )
}
