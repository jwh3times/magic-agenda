import { useTheme } from '../theme/ThemeProvider'
import { columnChrome } from '../theme/chrome'
import { tasksForStatus } from '../data/selectors'
import { DropLane } from '../dnd/DropLane'
import { SortableCard } from '../dnd/SortableCard'
import type { StatusDef } from '../theme/constants'
import type { Task } from '../types/task'
import { useBoardActions } from './boardActionContext'

export interface ColumnProps {
  col: StatusDef
  tasks: Task[]
}

export function Column({ col, tasks }: ColumnProps) {
  const actions = useBoardActions()
  const { theme, conf } = useTheme()
  const c = columnChrome(theme, conf, col)
  const notes = tasksForStatus(tasks, col.key)

  return (
    <div style={c.col}>
      <div style={c.accentBar} />
      <div style={c.head}>
        <span style={c.dotStyle} />
        <span style={c.labelStyle}>{col.label}</span>
        <span style={c.countStyle}>{notes.length}</span>
        <button
          type="button"
          style={c.addStyle}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            actions?.onAddStatus(col.key)
          }}
        >
          +
        </button>
      </div>
      <DropLane id={col.key} itemIds={notes.map((n) => n.id)} style={c.listStyle}>
        {notes.map((t) => (
          <SortableCard key={t.id} task={t} variant="kanban" />
        ))}
        {notes.length === 0 && <div style={c.emptyStyle}>Drop tasks here</div>}
      </DropLane>
    </div>
  )
}
