import { useContext } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { TaskCard } from '../components/TaskCard'
import { DragDisabledContext } from './dragContext'
import type { Task } from '../types/task'
import type { CardVariant } from '../theme/cardStyles'

export interface SortableCardProps {
  task: Task
  variant: CardVariant
  pop?: boolean
  onOpen?: (task: Task) => void
  onToggleDone?: (id: string) => void
  onTogglePin?: (id: string) => void
}

/**
 * Wraps TaskCard as a dnd-kit sortable item. We intentionally do NOT apply the sortable
 * transform — the prototype dims the source card in place and shows a floating ghost rather
 * than shuffling neighbours. The dragged card dims via TaskCard's `dragging` flag.
 */
export function SortableCard({
  task,
  variant,
  pop,
  onOpen,
  onToggleDone,
  onTogglePin,
}: SortableCardProps) {
  const disabled = useContext(DragDisabledContext)
  const { setNodeRef, attributes, listeners, isDragging } = useSortable({ id: task.id, disabled })
  // 'manipulation' (not 'none') so touch-scrolling over a card still works; the TouchSensor's
  // long-press activation takes over the gesture only once a drag actually starts.
  return (
    <div ref={setNodeRef} style={{ touchAction: 'manipulation' }} {...attributes} {...listeners}>
      <TaskCard
        task={task}
        variant={variant}
        dragging={isDragging}
        pop={pop}
        onOpen={onOpen}
        onToggleDone={onToggleDone}
        onTogglePin={onTogglePin}
      />
    </div>
  )
}
