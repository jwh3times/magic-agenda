import { browserTimezone, dateYmd, isScheduled } from '../lib/dates'
import type { Task } from '../types/task'
import { dueMomentAtZone, type ZonedDueMoment } from './dueMomentCore'

export type DueMoment = ZonedDueMoment

function knownTimezone(timezone?: string | null): string {
  for (const candidate of [timezone, browserTimezone(), 'UTC']) {
    if (!candidate) continue
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0)
      return candidate
    } catch {
      // Try the next safe fallback.
    }
  }
  return 'UTC'
}

/** Derive one Task's Account-specific Due Moment. Inbox has none. */
export function dueMoment(
  task: Pick<Task, 'day' | 'atTime'>,
  timezone?: string | null,
): DueMoment | null {
  if (!isScheduled(task.day)) return null
  return dueMomentAtZone(task.day, task.atTime, knownTimezone(timezone))
}

/** Overdue is derived, never stored. */
export function isOverdue(
  task: Pick<Task, 'day' | 'atTime' | 'status'>,
  nowMs: number,
  timezone?: string | null,
): boolean {
  if (task.status === 'completed') return false
  const due = dueMoment(task, timezone)
  return due !== null && nowMs >= due.overdueAtMs
}

/** Earliest future instant at which any active Task can become Overdue. */
export function nextOverdueChangeAt(
  tasks: readonly Pick<Task, 'day' | 'atTime' | 'status'>[],
  nowMs: number,
  timezone?: string | null,
): number | null {
  let next: number | null = null
  for (const task of tasks) {
    if (task.status === 'completed') continue
    const due = dueMoment(task, timezone)
    if (!due || due.overdueAtMs <= nowMs) continue
    if (next === null || due.overdueAtMs < next) next = due.overdueAtMs
  }
  return next
}

/** First instant of the next local day, used by clock providers and boundary tests. */
export function nextLocalDayBoundaryMs(nowMs: number, timezone?: string | null): number {
  const zone = knownTimezone(timezone)
  const due = dueMomentAtZone(dateYmd(new Date(nowMs), zone), null, zone)
  return due?.instantMs ?? nowMs + 24 * 60 * 60 * 1000
}
