import type { Task, WorkflowStatus } from '../types/task'
import { addDays, isScheduled, ymd, weekdayLabels } from '../lib/dates'
import { completionDecision } from './completion'

/** Tasks on a given day (or 'inbox'), sorted by their calendar order. Ported from `notesForDay`. */
export function notesForDay(tasks: Task[], day: string, excludeId?: string): Task[] {
  return tasks.filter((t) => t.day === day && t.id !== excludeId).sort((a, b) => a.order - b.order)
}

/** Tasks in a given status, sorted by their kanban order. Ported from `tasksForStatus`. */
export function tasksForStatus(tasks: Task[], status: WorkflowStatus, excludeId?: string): Task[] {
  return tasks
    .filter((t) => t.status === status && t.id !== excludeId)
    .sort((a, b) => a.korder - b.korder)
}

export interface CellMeta {
  dateStr: string
  dayNum: number
  /** The cell's real weekday, 0=Sunday. Lets a view label a rotated week without knowing weekStart. */
  dow: number
  inMonth: boolean
  isToday: boolean
  isWeekend: boolean
}

export interface MonthGrid {
  weekdays: string[]
  cells: CellMeta[]
}

/**
 * The 42-cell (7×6) month grid metadata, starting on the `weekStart` weekday of the week
 * containing the 1st. Ported from the prototype's `buildCells` (data half only).
 */
export function buildMonthGrid(
  viewY: number,
  viewM: number,
  todayStr: string,
  weekStart = 0,
): MonthGrid {
  const first = new Date(viewY, viewM, 1)
  const start = addDays(first, -((first.getDay() - weekStart + 7) % 7))
  const cells: CellMeta[] = []
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i)
    const ds = ymd(d)
    const dow = d.getDay()
    cells.push({
      dateStr: ds,
      dayNum: d.getDate(),
      dow,
      inMonth: d.getMonth() === viewM,
      isToday: ds === todayStr,
      // Weekend is absolute Sat/Sun — it does not rotate with the configured week start.
      isWeekend: dow === 0 || dow === 6,
    })
  }
  return { weekdays: weekdayLabels(weekStart), cells }
}

/** The 7 cells of the week starting at `weekStart` (a date — the caller already applied the offset). */
export function buildWeekCells(weekStart: Date, todayStr: string): CellMeta[] {
  const cells: CellMeta[] = []
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i)
    const ds = ymd(d)
    const dow = d.getDay()
    cells.push({
      dateStr: ds,
      dayNum: d.getDate(),
      dow,
      inMonth: true,
      isToday: ds === todayStr,
      isWeekend: dow === 0 || dow === 6,
    })
  }
  return cells
}

export interface AgendaGroup {
  day: string
  tasks: Task[]
}

/** Agenda within-day ordering: timed before untimed, by time, ties by manual order. */
function byAgendaTime(a: Task, b: Task): number {
  if (a.atTime && b.atTime && a.atTime !== b.atTime) return a.atTime < b.atTime ? -1 : 1
  if (a.atTime && !b.atTime) return -1
  if (!a.atTime && b.atTime) return 1
  return a.order - b.order
}

/** Scheduled tasks grouped by day, ascending; each group sorted timed-first. (Inbox excluded.) */
export function agendaGroups(tasks: Task[]): AgendaGroup[] {
  const byDay = new Map<string, Task[]>()
  for (const t of tasks) {
    if (!isScheduled(t.day)) continue
    const arr = byDay.get(t.day) ?? []
    arr.push(t)
    byDay.set(t.day, arr)
  }
  return [...byDay.keys()]
    .sort()
    .map((day) => ({ day, tasks: (byDay.get(day) ?? []).sort(byAgendaTime) }))
}

/**
 * Complete or Reopen a Task and bump it to the bottom of its destination Kanban column.
 */
export function applyToggleCompletion(
  tasks: Task[],
  id: string,
  now: string,
): { tasks: Task[]; justCompleted: boolean } {
  const next = tasks.map((t) => {
    if (t.id !== id) return { ...t }
    return { ...t, ...completionDecision(t, 'toggle', now) }
  })
  const moved = next.find((t) => t.id === id)
  let justCompleted = false
  if (moved) {
    const col = next.filter((t) => t.status === moved.status && t.id !== id)
    moved.korder = col.reduce((m, t) => Math.max(m, t.korder), -1) + 1
    justCompleted = moved.status === 'completed'
  }
  return { tasks: next, justCompleted }
}

/** Scheduled in the past and not Completed. Derived — never stored. */
export function isOverdue(t: Task, todayStr: string): boolean {
  return isScheduled(t.day) && t.day < todayStr && t.status !== 'completed'
}

/** Overdue tasks, oldest day first, ties by manual order. */
export function overdueTasks(tasks: Task[], todayStr: string): Task[] {
  return tasks
    .filter((t) => isOverdue(t, todayStr))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.order - b.order))
}

/**
 * Move every overdue task to today, appended after today's existing max order in
 * overdue-sort sequence. Pure; identity (occurrenceDate) never moves with the card.
 * Returns the same array reference when nothing is overdue.
 *
 * When `onlyIds` is given, only overdue tasks whose id is in the set are moved — other
 * overdue tasks (e.g. hidden by an active search filter) are left in place. Omitting it
 * (or passing everything) preserves the original "move all overdue" behavior.
 */
export function applyRollForward(
  tasks: Task[],
  todayStr: string,
  onlyIds?: ReadonlySet<string>,
): { tasks: Task[]; changed: Task[] } {
  const overdueAll = overdueTasks(tasks, todayStr)
  const overdue = onlyIds ? overdueAll.filter((t) => onlyIds.has(t.id)) : overdueAll
  if (overdue.length === 0) return { tasks, changed: [] }
  const base =
    tasks.filter((t) => t.day === todayStr).reduce((m, t) => Math.max(m, t.order), -1) + 1
  const orderById = new Map(overdue.map((t, i) => [t.id, base + i]))
  const movedById = new Map<string, Task>()
  const next = tasks.map((t) => {
    const order = orderById.get(t.id)
    if (order === undefined) return t
    const moved = { ...t, day: todayStr, order }
    movedById.set(t.id, moved)
    return moved
  })
  // Report changes in overdue-sort order (day asc, ties by order), not source-array order.
  const changed = overdue.map((t) => movedById.get(t.id)!)
  return { tasks: next, changed }
}
