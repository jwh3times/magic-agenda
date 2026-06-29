import type { CSSProperties, ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'

/**
 * A droppable container (a day cell's notes area, the inbox, or a kanban column list) that also
 * provides the SortableContext for its cards. Being a droppable means an empty lane still
 * accepts drops — dnd-kit reports `over.id` as this container's id.
 */
export function DropLane({
  id,
  itemIds,
  style,
  children,
}: {
  id: string
  itemIds: string[]
  style?: CSSProperties
  children: ReactNode
}) {
  const { setNodeRef } = useDroppable({ id })
  return (
    <div ref={setNodeRef} style={style}>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </div>
  )
}
