import { completionDecision } from './completion'
import { countTasks } from './undo'
import { formatAgendaDate } from '../lib/dates'
import { STATUS } from '../theme/constants'
import { INBOX, type Color, type Task, type WorkflowStatus } from '../types/task'

/** One change applied to every selected Task (#270). Deletion is planned in `series.ts`. */
export type BulkChange =
  | { kind: 'day'; day: string }
  | { kind: 'status'; status: WorkflowStatus }
  | { kind: 'color'; color: Color }

/** What a bulk change did, for its undo toast: "Moved 3 tasks to Inbox". */
export function describeBulkChange(change: BulkChange, altered: number): string {
  const count = countTasks(altered)
  if (change.kind === 'day') {
    return `Moved ${count} to ${change.day === INBOX ? 'Inbox' : formatAgendaDate(change.day)}`
  }
  if (change.kind === 'status') {
    const label = STATUS.find((s) => s.key === change.status)?.label ?? change.status
    return `Set ${count} to ${label}`
  }
  return `Recolored ${count}`
}

export interface BulkUpdatePlan {
  /** The whole board after the change. */
  tasks: Task[]
  /** Only the Tasks the change actually altered: the rows to write. */
  changed: Task[]
}

/**
 * Apply one change to a selection of Tasks. Pure; `now` stamps any Completion it decides.
 *
 * A selected Task the change would not alter is left exactly as it is, and is not written: moving
 * a selection to a day keeps the cards already there in place, and a status change leaves Tasks
 * already in that status in their column position.
 *
 * Moved Tasks are appended after the destination lane (by `order` for a day, `korder` for a
 * status), keeping their relative order from before the move. The source lanes keep their gaps:
 * lane order is only ever compared, never used as a dense index, and the next drag in that lane
 * re-packs it (`reorder.ts`). Writing every row of every source lane instead would turn a
 * three-card move into a write of the whole board.
 *
 * An Occurrence is changed as This Occurrence, exactly as a drag or a This-Occurrence editor save
 * would: its Occurrence Date and Series link are untouched, so its Series still owns that date.
 */
export function planBulkUpdate(
  tasks: Task[],
  ids: ReadonlySet<string>,
  change: BulkChange,
  now: string,
): BulkUpdatePlan {
  const affects = (task: Task) => {
    if (!ids.has(task.id)) return false
    if (change.kind === 'day') return task.day !== change.day
    if (change.kind === 'status') return task.status !== change.status
    return task.color !== change.color
  }
  const moving = tasks.filter(affects)
  if (moving.length === 0) return { tasks, changed: [] }

  const updates = new Map<string, Task>()
  if (change.kind === 'color') {
    for (const task of moving) updates.set(task.id, { ...task, color: change.color })
  } else if (change.kind === 'day') {
    let order =
      tasks
        .filter((t) => t.day === change.day && !affects(t))
        .reduce((max, t) => Math.max(max, t.order), -1) + 1
    const inLaneOrder = [...moving].sort((a, b) =>
      a.day === b.day ? a.order - b.order : a.day < b.day ? -1 : 1,
    )
    for (const task of inLaneOrder) {
      updates.set(task.id, {
        ...task,
        day: change.day,
        // Inbox has no Due Moment; the same rule as a drag into the Inbox (`moveToDay`).
        atTime: change.day === INBOX ? null : task.atTime,
        order: order++,
      })
    }
  } else {
    let korder =
      tasks
        .filter((t) => t.status === change.status && !affects(t))
        .reduce((max, t) => Math.max(max, t.korder), -1) + 1
    const inColumnOrder = [...moving].sort((a, b) => a.korder - b.korder)
    for (const task of inColumnOrder) {
      updates.set(task.id, {
        ...task,
        ...completionDecision(task, change.status, now),
        korder: korder++,
      })
    }
  }

  const next = tasks.map((task) => updates.get(task.id) ?? task)
  return { tasks: next, changed: next.filter((task) => updates.has(task.id)) }
}
