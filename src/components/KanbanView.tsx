import type { CSSProperties } from 'react'
import { STATUS } from '../theme/constants'
import { Column } from './Column'
import type { Task } from '../types/task'
import type { BoardHandlers, PopId } from './boardHandlers'

const kanbanWrap: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  gap: '16px',
  width: '100%',
}

export interface KanbanViewProps {
  tasks: Task[]
  handlers: BoardHandlers
  pop: PopId
}

export function KanbanView({ tasks, handlers, pop }: KanbanViewProps) {
  return (
    <div style={kanbanWrap}>
      {STATUS.map((col) => (
        <Column key={col.key} col={col} tasks={tasks} handlers={handlers} pop={pop} />
      ))}
    </div>
  )
}
