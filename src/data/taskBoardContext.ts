import { createContext, useContext } from 'react'
import type { Mode } from '../dnd/reorder'
import type { Task, TaskDraft } from '../types/task'
import type { RecurScope, SaveModifiers } from './series'
import type { BulkChange } from './bulk'

/**
 * The board-facing half of useTasks. Commands own their failures, so consumers never coordinate
 * promise lifecycles; the in-memory adapter used by component tests may therefore stay synchronous.
 */
export interface TaskBoard {
  /** Board tasks only (non-recurring + materialized instances); templates are hidden. */
  tasks: Task[]
  /** Show a drag-over result immediately without exposing useTasks' raw React setter. */
  previewReorder: (next: Task[]) => void
  persistReorder: (next: Task[], containers: string[], mode: Mode) => void | Promise<void>
  /** Resolve recurrence scope and save an editor result. */
  saveTask: (
    orig: TaskDraft | null,
    draft: TaskDraft,
    isNew: boolean,
    scope?: RecurScope,
    modifiers?: SaveModifiers,
  ) => void | Promise<void>
  updateTask: (task: Task) => void | Promise<void>
  /** Delete the row currently owned by the data layer; an unknown id is already gone. */
  deleteTask: (id: string, scope?: RecurScope) => void | Promise<void>
  toggleCompletion: (id: string) => void | Promise<void>
  /** Move overdue tasks to today; onlyIds narrows the operation to a filtered board. */
  rollForward: (todayStr: string, onlyIds?: ReadonlySet<string>) => void | Promise<void>
  /** Apply one change to every selected Task (#270). Ids not on the board are ignored. */
  bulkUpdate: (ids: ReadonlySet<string>, change: BulkChange) => void | Promise<void>
  /** Delete every selected Task; Occurrences are excluded from their Series (#270). */
  bulkDelete: (ids: ReadonlySet<string>) => void | Promise<void>
  /** Read the hidden template that owns a materialized recurring instance. */
  getTemplate: (parentId: string) => Task | undefined
}

export const TaskBoardContext = createContext<TaskBoard | null>(null)

export function useTaskBoard(): TaskBoard {
  const board = useContext(TaskBoardContext)
  if (!board) throw new Error('useTaskBoard must be used inside TaskBoardContext.Provider')
  return board
}
