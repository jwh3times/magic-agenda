import type { CSSProperties } from 'react'
import { STATUS } from '../theme/constants'
import { useIsMobile } from '../lib/useMediaQuery'
import { Column } from './Column'
import type { Task } from '../types/task'

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
}

export function KanbanView({ tasks }: KanbanViewProps) {
  const isMobile = useIsMobile()

  if (isMobile) {
    // Phones: one near-full-width column at a time, swiped horizontally with snap points.
    return (
      <div style={{ ...kanbanWrap, gap: '12px', overflowX: 'auto', scrollSnapType: 'x mandatory' }}>
        {STATUS.map((col) => (
          <div
            key={col.key}
            style={{ flex: 'none', width: '84vw', scrollSnapAlign: 'start', display: 'flex' }}
          >
            <Column col={col} tasks={tasks} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={kanbanWrap}>
      {STATUS.map((col) => (
        <Column key={col.key} col={col} tasks={tasks} />
      ))}
    </div>
  )
}
