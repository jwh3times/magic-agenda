import type { Status, Task } from '../types/task'
import { addDays, isScheduled, ymd, WEEKDAYS_SHORT } from '../lib/dates'

/** Tasks on a given day (or 'inbox'), sorted by their calendar order. Ported from `notesForDay`. */
export function notesForDay(tasks: Task[], day: string, excludeId?: string): Task[] {
  return tasks
    .filter((t) => t.day === day && t.id !== excludeId)
    .sort((a, b) => a.order - b.order)
}

/** Tasks in a given status, sorted by their kanban order. Ported from `tasksForStatus`. */
export function tasksForStatus(tasks: Task[], status: Status, excludeId?: string): Task[] {
  return tasks
    .filter((t) => t.status === status && t.id !== excludeId)
    .sort((a, b) => a.korder - b.korder)
}

export interface CellMeta {
  dateStr: string
  dayNum: number
  inMonth: boolean
  isToday: boolean
  isWeekend: boolean
}

export interface MonthGrid {
  weekdays: string[]
  cells: CellMeta[]
}

/**
 * The 42-cell (7×6) month grid metadata, starting on the Sunday of the week containing
 * the 1st. Ported from the prototype's `buildCells` (data half only — styling lives in chrome).
 */
export function buildMonthGrid(viewY: number, viewM: number, todayStr: string): MonthGrid {
  const first = new Date(viewY, viewM, 1)
  const start = addDays(first, -first.getDay())
  const cells: CellMeta[] = []
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i)
    const ds = ymd(d)
    cells.push({
      dateStr: ds,
      dayNum: d.getDate(),
      inMonth: d.getMonth() === viewM,
      isToday: ds === todayStr,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
    })
  }
  return { weekdays: WEEKDAYS_SHORT, cells }
}

/** The 7 cells (Sun..Sat) of the week starting at `weekStart`. */
export function buildWeekCells(weekStart: Date, todayStr: string): CellMeta[] {
  const cells: CellMeta[] = []
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i)
    const ds = ymd(d)
    cells.push({
      dateStr: ds,
      dayNum: d.getDate(),
      inMonth: true,
      isToday: ds === todayStr,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
    })
  }
  return cells
}

export interface AgendaGroup {
  day: string
  tasks: Task[]
}

/** Scheduled tasks grouped by day, ascending; each group sorted by order. (Inbox excluded.) */
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
    .map((day) => ({ day, tasks: (byDay.get(day) ?? []).sort((a, b) => a.order - b.order) }))
}

/**
 * Toggle a task's done flag, flipping status todo<->done and bumping the completed task to the
 * bottom of its kanban column. Ported from the prototype's `toggleDone`. Returns whether the
 * task just became done (drives the notePop animation).
 */
export function applyToggleDone(tasks: Task[], id: string): { tasks: Task[]; justDone: boolean } {
  const next = tasks.map((t) => {
    if (t.id !== id) return { ...t }
    const done = !t.done
    const status: Status = done ? 'done' : 'todo'
    return { ...t, done, status }
  })
  const moved = next.find((t) => t.id === id)
  let justDone = false
  if (moved) {
    const col = next.filter((t) => t.status === moved.status && t.id !== id)
    moved.korder = col.reduce((m, t) => Math.max(m, t.korder), -1) + 1
    justDone = moved.done
  }
  return { tasks: next, justDone }
}
