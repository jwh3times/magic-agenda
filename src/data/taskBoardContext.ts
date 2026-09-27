import { createContext, useContext } from 'react'
import type { Mode } from '../dnd/reorder'
import type { Task, TaskDraft } from '../types/task'
import type { RecurScope, SaveModifiers } from './series'
import type { BulkChange } from './bulk'

/**
 * Why a compare-and-swap editor save did not land (#433). The optimistic change has already been
 * rolled back when this arrives; `message` is ready to render.
 */
export interface SaveConflict {
  reason: 'stale-revision' | 'task-deleted' | 'membership-ended'
  message: string
  /** The row's current revision — present for `stale-revision`, for a deliberate overwrite. */
  latestRevision?: number
}

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
  /**
   * Resolve recurrence scope and save an editor result.
   *
   * With `expectedRevision` — the revision the editor opened on — a save of one Task or one
   * Occurrence is compare-and-swap (#433): it lands only if nobody changed the row since, and
   * otherwise resolves to a `SaveConflict` saying why. Without one, or for a Series-wide edit
   * (#434), it saves as before and resolves to nothing.
   */
  saveTask: (
    orig: TaskDraft | null,
    draft: TaskDraft,
    isNew: boolean,
    scope?: RecurScope,
    modifiers?: SaveModifiers,
    expectedRevision?: number,
  ) => void | SaveConflict | Promise<void | SaveConflict>
  /** The server revision this client last saw for a Task, or undefined when it has none. */
  revisionOf: (id: string) => number | undefined
  updateTask: (task: Task) => void | Promise<void>
  /** Delete the row currently owned by the data layer; an unknown id is already gone. */
  deleteTask: (id: string, scope?: RecurScope) => void | Promise<void>
  toggleCompletion: (id: string) => void | Promise<void>
  /** Move overdue tasks to today; onlyIds narrows the operation to a filtered board. */
  rollForward: (todayStr: string, onlyIds?: ReadonlySet<string>) => void | Promise<void>
  /**
   * Apply one change to every selected Task (#270). Ids not on the board are ignored. Unlike the
   * single-Task commands this reports an outcome, false when the write was refused or failed, so
   * the board never announces a bulk change that did not happen. The failure itself is still
   * surfaced by the data layer.
   */
  bulkUpdate: (ids: ReadonlySet<string>, change: BulkChange) => boolean | Promise<boolean>
  /** Delete every selected Task; Occurrences are excluded from their Series. Same outcome contract. */
  bulkDelete: (ids: ReadonlySet<string>) => boolean | Promise<boolean>
  /**
   * The latest action that can be undone (#271): Complete/Reopen, a plain or single-Occurrence
   * delete, a drag, roll-forward, or a bulk change. Null once undone, dismissed, or superseded by
   * any other write from this client. `id` changes with every new action.
   */
  lastUndo: { id: number; label: string } | null
  /** Restore that action's rows. Resolves false when refused or failed (the error is surfaced). */
  undo: () => boolean | Promise<boolean>
  dismissUndo: () => void
  /** Read the hidden template that owns a materialized recurring instance. */
  getTemplate: (parentId: string) => Task | undefined
}

export const TaskBoardContext = createContext<TaskBoard | null>(null)

export function useTaskBoard(): TaskBoard {
  const board = useContext(TaskBoardContext)
  if (!board) throw new Error('useTaskBoard must be used inside TaskBoardContext.Provider')
  return board
}
