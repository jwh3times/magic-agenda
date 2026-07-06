import type { Status, Task } from '../types/task'

/** Callbacks threaded from Board down into the views (wired to the editor in Phase 5). */
export interface BoardHandlers {
  onOpen: (task: Task) => void
  onToggleDone: (id: string) => void
  onTogglePin: (id: string) => void
  onAddDay: (dateStr: string) => void
  onAddInbox: () => void
  onAddStatus: (status: Status) => void
}

/** The id of the task currently animating its done-pop (or null). */
export type PopId = string | null
