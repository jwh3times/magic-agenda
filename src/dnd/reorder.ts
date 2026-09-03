import type { Task, WorkflowStatus } from '../types/task'
import { completionDecision } from '../data/completion'

/** Whether we are ordering by day (calendar/week) or status (kanban). */
export type Mode = 'day' | 'status'

/**
 * The splice math, and only the splice math. Deciding *what* to splice — which lane an id
 * belongs to, whether the drop lands above or below, at which index — lives in `resolveDrop.ts`.
 *
 * This module used to also export `findContainer` and `reindex`. Neither had a production call
 * site: `findContainer` was re-implemented (with different fallback behaviour) inside the dnd-kit
 * wiring, and `reindex` was never used at all, since both movers re-pack their lanes inline.
 * Between them they carried 7 of this file's 17 tests, all of code that never shipped.
 */

/**
 * Move a task to `day` at `index`, splicing into the destination and reassigning contiguous
 * order. On a cross-day move the source day is re-packed too. Index is clamped. Immutable.
 * Port of the prototype's `moveTask`, extended to reindex both sides.
 */
export function moveToDay(tasks: Task[], id: string, day: string, index: number): Task[] {
  const original = tasks.find((t) => t.id === id)
  if (!original) return tasks
  const sourceDay = original.day

  const next = tasks.map((t) => ({ ...t }))
  const moving = next.find((t) => t.id === id)!
  moving.day = day

  const dest = next.filter((t) => t.day === day && t.id !== id).sort((a, b) => a.order - b.order)
  const at = Math.max(0, Math.min(index, dest.length))
  dest.splice(at, 0, moving)
  dest.forEach((t, i) => (t.order = i))

  if (sourceDay !== day) {
    next
      .filter((t) => t.day === sourceDay)
      .sort((a, b) => a.order - b.order)
      .forEach((t, i) => (t.order = i))
  }
  return next
}

/**
 * Move a task to `status` at `index`, splicing into the destination and reassigning contiguous
 * korder; the source column is re-packed on a cross-column move. Completion lifecycle fields are
 * decided at the same time as Workflow Status.
 * Index is clamped. Immutable. Port of the prototype's `moveStatus`, extended to reindex both sides.
 */
export function moveToStatus(
  tasks: Task[],
  id: string,
  status: WorkflowStatus,
  index: number,
  now: string,
): Task[] {
  const original = tasks.find((t) => t.id === id)
  if (!original) return tasks
  const sourceStatus = original.status

  const next = tasks.map((t) => ({ ...t }))
  const moving = next.find((t) => t.id === id)!
  Object.assign(moving, completionDecision(original, status, now))

  const dest = next
    .filter((t) => t.status === status && t.id !== id)
    .sort((a, b) => a.korder - b.korder)
  const at = Math.max(0, Math.min(index, dest.length))
  dest.splice(at, 0, moving)
  dest.forEach((t, i) => (t.korder = i))

  if (sourceStatus !== status) {
    next
      .filter((t) => t.status === sourceStatus)
      .sort((a, b) => a.korder - b.korder)
      .forEach((t, i) => (t.korder = i))
  }
  return next
}
