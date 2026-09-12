import type { Task } from '../types/task'
import { addDays, dateYmd, parseDay, startOfWeek, ymd } from '../lib/dates'
import { isArchived } from './completion'

/**
 * Completion History and its statistics, derived from current Board state.
 *
 * There is no event ledger behind any of this ([ADR-0003](../../docs/adr/0003-completion-history-is-current-state.md)):
 * every number here is a fold over the Tasks that are Completed *right now*, so Reopening or
 * deleting one changes the past as well as the present. That is the accepted trade, and it is why
 * this module takes a plain `Task[]` rather than a query.
 *
 * Every function is pure and takes the viewing Account's `timezone` and `weekStart` explicitly.
 * The Completion instant is shared Board content; the calendar day and week it falls in are the
 * *reader's* interpretation of it, so two members of one Board may legitimately bucket the same
 * instant differently. Passing those in rather than reading a context is what keeps that honest —
 * and what makes the buckets testable without mounting a provider.
 */

/** One currently Completed Task, with the calendar day its Completion falls on for this reader. */
export interface HistoryEntry {
  task: Task
  /** The Completion instant, ISO-8601. Non-null — an entry without one is never produced. */
  completedAt: string
  /** `completedAt` as 'YYYY-MM-DD' in the reader's timezone. */
  day: string
  archived: boolean
}

/** The Completions falling in one week, newest first. */
export interface HistoryWeek {
  /** The week's first day, 'YYYY-MM-DD', per the reader's Week Start. */
  weekStart: string
  entries: HistoryEntry[]
}

/** One bar of the throughput chart. */
export interface ThroughputWeek {
  weekStart: string
  count: number
}

/** How many weeks of throughput the statistics report. */
export const THROUGHPUT_WEEKS = 8

/**
 * Every currently Completed Task as a history entry, newest Completion first.
 *
 * A Task whose Completion instant does not parse is dropped rather than bucketed into a nonsense
 * day. The type no longer admits a Completed Task without an instant, but this reads rows that a
 * direct Data API write or a restored backup produced, so the guard is cheap insurance against one
 * bad row silently corrupting a streak.
 */
export function historyEntries(tasks: readonly Task[], timezone?: string | null): HistoryEntry[] {
  const entries: HistoryEntry[] = []
  for (const task of tasks) {
    if (task.status !== 'completed' || task.completedAt === null) continue
    const at = new Date(task.completedAt)
    if (Number.isNaN(at.getTime())) continue
    entries.push({
      task,
      completedAt: task.completedAt,
      day: dateYmd(at, timezone),
      archived: isArchived(task),
    })
  }
  // Descending by instant, ties broken by title then id so the order is total and stable.
  return entries.sort(
    (a, b) =>
      (a.completedAt < b.completedAt ? 1 : a.completedAt > b.completedAt ? -1 : 0) ||
      a.task.title.localeCompare(b.task.title) ||
      a.task.id.localeCompare(b.task.id),
  )
}

/** The first day of `day`'s week, as 'YYYY-MM-DD'. Pure calendar arithmetic on the local date. */
export function weekStartOf(day: string, weekStart = 0): string {
  return ymd(startOfWeek(parseDay(day), weekStart))
}

/** Completed Tasks grouped by Completion week, newest week first, newest Completion first within. */
export function historyWeeks(
  tasks: readonly Task[],
  timezone?: string | null,
  weekStart = 0,
): HistoryWeek[] {
  const weeks: HistoryWeek[] = []
  const byStart = new Map<string, HistoryWeek>()
  // historyEntries is already newest-first, so appending preserves both orderings in one pass.
  for (const entry of historyEntries(tasks, timezone)) {
    const start = weekStartOf(entry.day, weekStart)
    let week = byStart.get(start)
    if (!week) {
      week = { weekStart: start, entries: [] }
      byStart.set(start, week)
      weeks.push(week)
    }
    week.entries.push(entry)
  }
  return weeks
}

/**
 * Completions per week for the last `THROUGHPUT_WEEKS` weeks, oldest bucket first.
 *
 * Always exactly that many buckets, including empty ones: a bar chart that dropped quiet weeks
 * would compress the gaps and make an intermittent Board look steady.
 */
export function throughputWeeks(
  tasks: readonly Task[],
  todayStr: string,
  timezone?: string | null,
  weekStart = 0,
): ThroughputWeek[] {
  const current = parseDay(weekStartOf(todayStr, weekStart))
  const buckets = new Map<string, number>()
  for (let i = THROUGHPUT_WEEKS - 1; i >= 0; i--) {
    buckets.set(ymd(addDays(current, -7 * i)), 0)
  }
  for (const entry of historyEntries(tasks, timezone)) {
    const start = weekStartOf(entry.day, weekStart)
    const count = buckets.get(start)
    if (count !== undefined) buckets.set(start, count + 1)
  }
  return [...buckets].map(([start, count]) => ({ weekStart: start, count }))
}

/**
 * The current run of consecutive calendar days carrying at least one Completion.
 *
 * **Today is allowed to be empty**, and the run then counts back from yesterday: a streak breaks
 * only after a whole day passes with nothing Completed, rather than reading zero every morning
 * until the first Task lands. That one-day grace is a product decision, not an accident of the
 * fold — the strict reading ("the run must include today") and the record reading ("the longest
 * run anywhere") were both considered and rejected.
 *
 * `weekStart` is deliberately not a parameter: a streak is a run of days, and no week boundary
 * interrupts it.
 */
export function completionStreak(
  tasks: readonly Task[],
  todayStr: string,
  timezone?: string | null,
): number {
  const days = new Set(historyEntries(tasks, timezone).map((entry) => entry.day))
  if (days.size === 0) return 0
  const today = parseDay(todayStr)
  const yesterday = ymd(addDays(today, -1))
  let cursor = days.has(todayStr) ? today : days.has(yesterday) ? addDays(today, -1) : null
  if (!cursor) return 0
  let streak = 0
  while (days.has(ymd(cursor))) {
    streak++
    cursor = addDays(cursor, -1)
  }
  return streak
}
