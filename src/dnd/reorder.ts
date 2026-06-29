import type { Status, Task } from '../types/task'

/** Whether we are ordering by day (calendar/week) or status (kanban). */
export type Mode = 'day' | 'status'

const containerKey = (mode: Mode): 'day' | 'status' => (mode === 'day' ? 'day' : 'status')
const orderKey = (mode: Mode): 'order' | 'korder' => (mode === 'day' ? 'order' : 'korder')

/** The container (day or status) a task currently lives in, or undefined if unknown. */
export function findContainer(tasks: Task[], id: string, mode: Mode): string | undefined {
  const task = tasks.find((x) => x.id === id)
  if (!task) return undefined
  return mode === 'day' ? task.day : task.status
}

/**
 * Reassign a contiguous 0..n-1 order (or korder) within one container, preserving current
 * relative order. Immutable — only tasks in the container get fresh objects.
 */
export function reindex(tasks: Task[], container: string, mode: Mode): Task[] {
  const ck = containerKey(mode)
  const ok = orderKey(mode)
  const positions = new Map<string, number>()
  tasks
    .filter((t) => t[ck] === container)
    .sort((a, b) => a[ok] - b[ok])
    .forEach((t, i) => positions.set(t.id, i))
  return tasks.map((t) => (positions.has(t.id) ? { ...t, [ok]: positions.get(t.id)! } : t))
}

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
 * korder; the source column is re-packed on a cross-column move. Sets done = (status === 'done').
 * Index is clamped. Immutable. Port of the prototype's `moveStatus`, extended to reindex both sides.
 */
export function moveToStatus(tasks: Task[], id: string, status: Status, index: number): Task[] {
  const original = tasks.find((t) => t.id === id)
  if (!original) return tasks
  const sourceStatus = original.status

  const next = tasks.map((t) => ({ ...t }))
  const moving = next.find((t) => t.id === id)!
  moving.status = status
  moving.done = status === 'done'

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
