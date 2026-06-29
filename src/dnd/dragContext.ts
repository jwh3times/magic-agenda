import { createContext } from 'react'

/** When true, SortableCards disable their useSortable (e.g. while a search filter is active),
 * keeping the DndContext sensors array stable. */
export const DragDisabledContext = createContext(false)
