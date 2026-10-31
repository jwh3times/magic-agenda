import type { Task, WorkflowStatus } from '../types/task'
import { addDays, formatDaySpoken, isScheduled, ymd, weekdayLabels } from '../lib/dates'
import { completionDecision } from './completion'
import { isOverdue as isTaskOverdue } from './dueMoment'

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

/** How many markers a phone Calendar day draws before the rest become `+N`. */
const MAX_DAY_MARKERS = 3

export interface DayMarker {
  taskId: string
  /** `completed` is the hollow marker of a day holding nothing else. */
  kind: 'overdue' | 'open' | 'completed'
  /** Which Label Color to draw. Null is Unlabeled; Note Color has no classification meaning. */
  labelId: string | null
}

export interface DayMarkers {
  markers: DayMarker[]
  /** Open Tasks beyond the markers: the `+N`. */
  more: number
  /** Tasks not yet Completed, Overdue ones included. */
  open: number
  overdue: number
  completed: number
}

/**
 * What a phone Calendar day draws and says, from the already-filtered Tasks. Overdue comes first, so
 * it can never be hidden behind `+N`, then the rest in calendar order. Completed Tasks are left out
 * because the markers show what is still to do, unless they are all the day holds.
 */
export function dayMarkers(
  tasks: Task[],
  day: string,
  nowMs: number,
  timezone?: string | null,
): DayMarkers {
  const notes = notesForDay(tasks, day)
  const remaining = notes.filter((t) => t.status !== 'completed')
  const late = remaining.filter((t) => isOverdue(t, nowMs, timezone))
  const onTime = remaining.filter((t) => !isOverdue(t, nowMs, timezone))
  const toMarker = (t: Task, kind: DayMarker['kind']): DayMarker => ({
    taskId: t.id,
    kind,
    labelId: t.labelId,
  })
  const ordered = [
    ...late.map((t) => toMarker(t, 'overdue')),
    ...onTime.map((t) => toMarker(t, 'open')),
  ]
  const completed = notes.length - remaining.length
  return {
    markers:
      remaining.length === 0 && completed > 0
        ? [toMarker(notes[0], 'completed')]
        : ordered.slice(0, MAX_DAY_MARKERS),
    more: Math.max(0, ordered.length - MAX_DAY_MARKERS),
    open: remaining.length,
    overdue: late.length,
    completed,
  }
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** A phone Calendar day's spoken name, e.g. 'Tuesday 10 November, 2 tasks, 1 overdue'. */
export function dayCellName(day: string, { open, overdue, completed }: DayMarkers): string {
  const date = formatDaySpoken(day)
  if (open === 0) {
    return `${date}, ${completed > 0 ? plural(completed, 'completed task') : 'no tasks'}`
  }
  return `${date}, ${plural(open, 'task')}${overdue > 0 ? `, ${overdue} overdue` : ''}`
}

/** The day a phone Calendar opens on: today if the visible month contains it, otherwise the 1st. */
export function defaultSelectedDay(viewY: number, viewM: number, todayStr: string): string {
  const first = ymd(new Date(viewY, viewM, 1))
  return todayStr.slice(0, 7) === first.slice(0, 7) ? todayStr : first
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

/** Past its Account-specific Due Moment and not Completed. Derived — never stored. */
export function isOverdue(t: Task, nowMs: number, timezone?: string | null): boolean {
  return isTaskOverdue(t, nowMs, timezone)
}

/** Overdue tasks, oldest day first, ties by manual order. */
export function overdueTasks(tasks: Task[], nowMs: number, timezone?: string | null): Task[] {
  return tasks
    .filter((t) => isOverdue(t, nowMs, timezone))
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
  // A timed Task already on today can be Overdue, but roll-forward has nowhere to move it. Keep
  // the command scoped to earlier Scheduled Days; Due Time remains intact on every moved Task.
  const candidates = tasks
    .filter((t) => isScheduled(t.day) && t.day < todayStr && t.status !== 'completed')
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.order - b.order))
  const overdue = onlyIds ? candidates.filter((t) => onlyIds.has(t.id)) : candidates
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
