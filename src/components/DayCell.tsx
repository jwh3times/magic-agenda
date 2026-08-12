import { useTheme } from '../theme/ThemeProvider'
import { cellChrome } from '../theme/chrome'
import { DropLane } from '../dnd/DropLane'
import { SortableCard } from '../dnd/SortableCard'
import type { CellMeta } from '../data/selectors'
import type { Task } from '../types/task'
import { useBoardActions } from './boardActionContext'

export interface DayCellProps {
  meta: CellMeta
  notes: Task[]
}

export function DayCell({ meta, notes }: DayCellProps) {
  const actions = useBoardActions()
  const { theme, conf } = useTheme()
  const c = cellChrome(theme, conf, meta)
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
            actions?.onAddDay(meta.dateStr)
          }}
        >
          +
        </button>
      </div>
      <DropLane id={meta.dateStr} itemIds={notes.map((n) => n.id)} style={c.notesWrap}>
        {notes.map((t) => (
          <SortableCard key={t.id} task={t} variant="cell" />
        ))}
      </DropLane>
    </div>
  )
}
