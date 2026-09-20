import type { SeriesState } from './series'
import type { Attachment } from './attachments'
import type { SeriesDefinition, Task } from '../types/task'

/** A Task's title as undo labels quote it. */
export const quoted = (task: Pick<Task, 'title'>) => `“${task.title.trim() || 'Untitled'}”`

/** "1 task", "3 tasks". */
export const countTasks = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`

/**
 * Undo for board-safe operations (#271): the prior version of exactly the rows one action wrote.
 *
 * Snapshot-based and row-scoped on purpose. Restoring the whole previous board would also revert
 * every row the action did not touch, including changes that arrived from other devices meanwhile;
 * scoping to the touched ids limits last-write-wins to the rows the user is actually undoing.
 *
 * Only rows that **existed** before the action are recorded. None of the undoable actions creates a
 * row (Series-level operations, which can materialize Occurrences, are excluded from undo), so an
 * id missing from the prior state is simply not the action's to restore.
 */
export interface UndoEntry {
  /** What the toast says: "Completed “Pay rent”", "Deleted 3 tasks". */
  label: string
  tasks: Task[]
  templates: SeriesDefinition[]
  /**
   * Attachment rows the action's deletes cascaded away (#404).
   *
   * **The one thing here that does not come from `before`.** The board state this module snapshots
   * holds Tasks and definitions; attachments are not in it, and are not loaded until an editor asks
   * for them. So they are read from the server by the caller, in the window between the optimistic
   * removal and the DELETE, and handed in. An action that deletes nothing leaves this empty.
   */
  attachments: Attachment[]
}

export function captureUndo(
  label: string,
  before: SeriesState,
  ids: Iterable<string>,
  attachments: readonly Attachment[] = [],
): UndoEntry {
  const wanted = new Set(ids)
  return {
    label,
    tasks: before.tasks.filter((task) => wanted.has(task.id)),
    templates: before.templates.filter((template) => wanted.has(template.id)),
    // Filtered by the same ids as everything else, so the entry cannot restore an attachment
    // belonging to a Task this action never touched.
    attachments: attachments.filter((attachment) => wanted.has(attachment.taskId)),
  }
}

export interface UndoPlan {
  /** The optimistic state after undoing. */
  state: SeriesState
  /** Written first: an Occurrence cannot be re-inserted before the definition it references. */
  upsertTemplates: SeriesDefinition[]
  upsertTasks: Task[]
  /** Written last: the composite foreign key means the Task has to be back first (#404). */
  insertAttachments: Attachment[]
  markIds: string[]
}

/** Put every recorded row back, in state and as writes. Pure. */
export function planUndo(entry: UndoEntry, current: SeriesState): UndoPlan {
  const restore = <T extends { id: string }>(rows: readonly T[], recorded: T[]): T[] => {
    const byId = new Map(recorded.map((row) => [row.id, row]))
    const present = new Set(rows.map((row) => row.id))
    return [
      ...rows.map((row) => byId.get(row.id) ?? row),
      ...recorded.filter((row) => !present.has(row.id)),
    ]
  }
  return {
    state: {
      tasks: restore(current.tasks, entry.tasks),
      templates: restore(current.templates, entry.templates),
    },
    upsertTemplates: entry.templates,
    upsertTasks: entry.tasks,
    // Not part of `state`: attachments live outside the board snapshot, and the editor reads them
    // fresh when it opens. There is nothing optimistic to update.
    insertAttachments: entry.attachments,
    markIds: [...entry.templates.map((row) => row.id), ...entry.tasks.map((row) => row.id)],
  }
}
