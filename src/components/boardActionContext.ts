import { createContext, useContext } from 'react'
import type { Task, WorkflowStatus } from '../types/task'

/** UI actions published by Board to the view tree. Null means a decorative, read-only card. */
export interface OpenOptions {
  /** Ctrl/Cmd-click: add to or remove from the selection instead of opening (#270). */
  additive?: boolean
}

export interface BoardActions {
  popId: string | null
  /** Open the editor, or toggle the card's selection while selecting (#270). */
  onOpen: (task: Task, options?: OpenOptions) => void
  /** Present only in selection mode: the ids currently selected. */
  selectedIds?: ReadonlySet<string>
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
