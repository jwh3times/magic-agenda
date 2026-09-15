import { browserTimezone, dateYmd, isScheduled } from '../lib/dates'
import type { Task } from '../types/task'

export interface DueMoment {
  readonly kind: 'timed' | 'untimed'
  /** The Account-specific deadline as Unix epoch milliseconds. */
  readonly instantMs: number
  /** The first millisecond at which this Task is Overdue. */
  readonly overdueAtMs: number
}

interface LocalParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>()
const MOMENTS = new Map<string, number>()
const MOMENT_CACHE_LIMIT = 2048
const SAMPLE_HOURS = [-36, -24, -12, 0, 12, 24, 36]
const HOUR_MS = 60 * 60 * 1000
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^(\d{2}):(\d{2})$/

function formatter(timezone: string): Intl.DateTimeFormat {
  const cached = FORMATTERS.get(timezone)
  if (cached) return cached
  const created = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  FORMATTERS.set(timezone, created)
  return created
}

function knownTimezone(timezone?: string | null): string {
  const candidate = timezone || browserTimezone()
  try {
    formatter(candidate).format(0)
    return candidate
  } catch {
    const browser = browserTimezone()
    try {
      formatter(browser).format(0)
      return browser
    } catch {
      return 'UTC'
    }
  }
}

function localParts(epochMs: number, timezone: string): LocalParts {
  const parts = formatter(timezone).formatToParts(epochMs)
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  }
}

function localScalar(parts: LocalParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
}

function parseLocal(day: string, time: string): LocalParts | null {
  const dayMatch = DAY_RE.exec(day)
  const timeMatch = TIME_RE.exec(time)
  if (!dayMatch || !timeMatch) return null
  const parts = {
    year: Number(dayMatch[1]),
    month: Number(dayMatch[2]),
    day: Number(dayMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    second: 0,
  }
  if (parts.hour > 23 || parts.minute > 59) return null
  const roundTrip = new Date(localScalar(parts))
  if (
    roundTrip.getUTCFullYear() !== parts.year ||
    roundTrip.getUTCMonth() + 1 !== parts.month ||
    roundTrip.getUTCDate() !== parts.day
  ) {
    return null
  }
  return parts
}

function addCalendarDay(day: string): string | null {
  const parts = parseLocal(day, '00:00')
  if (!parts) return null
  const next = new Date(localScalar(parts) + 24 * HOUR_MS)
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(
    next.getUTCDate(),
  ).padStart(2, '0')}`
}

/**
 * Convert a wall-clock date/time to an instant using Temporal's `compatible` disambiguation:
 * choose the first occurrence in an overlap and move forward by the gap when the clock skips.
 *
 * `Intl` exposes instant -> local conversion, not its inverse. Sampling the offsets on both sides
 * of the target yields every candidate around a timezone transition. Exact candidates choose the
 * earliest instant; a gap chooses the candidate whose rendered local time is the nearest one after
 * the missing wall time.
 */
function zonedEpochMs(day: string, time: string, timezone: string): number | null {
  const key = `${timezone}|${day}|${time}`
  const cached = MOMENTS.get(key)
  if (cached !== undefined) return cached

  const target = parseLocal(day, time)
  if (!target) return null
  const targetScalar = localScalar(target)
  const offsets = new Set<number>()
  for (const hours of SAMPLE_HOURS) {
    const sampled = targetScalar + hours * HOUR_MS
    offsets.add(localScalar(localParts(sampled, timezone)) - sampled)
  }

  const candidates = [...offsets].map((offset) => {
    const instantMs = targetScalar - offset
    return { instantMs, renderedScalar: localScalar(localParts(instantMs, timezone)) }
  })
  const exact = candidates
    .filter((candidate) => candidate.renderedScalar === targetScalar)
    .sort((a, b) => a.instantMs - b.instantMs)[0]
  const compatible =
    exact ??
    candidates
      .filter((candidate) => candidate.renderedScalar > targetScalar)
      .sort((a, b) => a.renderedScalar - b.renderedScalar || a.instantMs - b.instantMs)[0]
  if (!compatible) return null

  if (MOMENTS.size >= MOMENT_CACHE_LIMIT) MOMENTS.clear()
  MOMENTS.set(key, compatible.instantMs)
  return compatible.instantMs
}

/** Derive one Task's Account-specific Due Moment. Inbox has none. */
export function dueMoment(
  task: Pick<Task, 'day' | 'atTime'>,
  timezone?: string | null,
): DueMoment | null {
  if (!isScheduled(task.day)) return null
  const zone = knownTimezone(timezone)
  const parsedTime = task.atTime && TIME_RE.test(task.atTime) ? task.atTime : null
  if (parsedTime) {
    const instantMs = zonedEpochMs(task.day, parsedTime, zone)
    if (instantMs !== null) return { kind: 'timed', instantMs, overdueAtMs: instantMs + 1 }
  }

  const nextDay = addCalendarDay(task.day)
  if (!nextDay) return null
  const instantMs = zonedEpochMs(nextDay, '00:00', zone)
  return instantMs === null ? null : { kind: 'untimed', instantMs, overdueAtMs: instantMs }
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
  const nextDay = addCalendarDay(dateYmd(new Date(nowMs), zone))
  return (nextDay && zonedEpochMs(nextDay, '00:00', zone)) || nowMs + 24 * HOUR_MS
}
