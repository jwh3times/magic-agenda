import { createContext, useContext } from 'react'
import type { Task, WorkflowStatus } from '../types/task'

/** UI actions published by Board to the view tree. Null means a decorative, read-only card. */
export interface BoardActions {
  popId: string | null
  onOpen: (task: Task) => void
  onToggleCompletion?: (id: string) => void
  onTogglePin?: (id: string) => void
  onAddDay: (dateStr: string) => void
  onAddInbox: () => void
  onAddStatus: (status: WorkflowStatus) => void
  onRollForward?: () => void
}

export const BoardActionContext = createContext<BoardActions | null>(null)

export function useBoardActions(): BoardActions | null {
  return useContext(BoardActionContext)
}
