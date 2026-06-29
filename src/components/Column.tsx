import { useTheme } from '../theme/ThemeProvider'
import { columnChrome } from '../theme/chrome'
import { tasksForStatus } from '../data/selectors'
import { TaskCard } from './TaskCard'
import type { StatusDef } from '../theme/constants'
import type { Task } from '../types/task'
import type { BoardHandlers, PopId } from './boardHandlers'

export interface ColumnProps {
  col: StatusDef
  tasks: Task[]
  handlers: BoardHandlers
  pop: PopId
  isDrop?: boolean
}

export function Column({ col, tasks, handlers, pop, isDrop = false }: ColumnProps) {
  const { theme, conf } = useTheme()
  const c = columnChrome(theme, conf, col, isDrop)
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
          onClick={(e) => {
            e.stopPropagation()
            handlers.onAddStatus(col.key)
          }}
        >
          +
        </button>
      </div>
      <div style={c.listStyle}>
        {notes.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            variant="kanban"
            pop={pop === t.id}
            onOpen={handlers.onOpen}
            onToggleDone={handlers.onToggleDone}
          />
        ))}
        {notes.length === 0 && <div style={c.emptyStyle}>Drop tasks here</div>}
      </div>
    </div>
  )
}
