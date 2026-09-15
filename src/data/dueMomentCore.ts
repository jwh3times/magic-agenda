export interface ZonedDueMoment {
  readonly kind: 'timed' | 'untimed'
  readonly instantMs: number
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
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(
    2,
    '0',
  )}-${String(next.getUTCDate()).padStart(2, '0')}`
}

/** Temporal-compatible wall-clock conversion: earlier overlap, forward through a gap. */
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
    return {
      instantMs,
      renderedScalar: localScalar(localParts(instantMs, timezone)),
    }
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

/** Shared client/sender Due Moment derivation for one concrete IANA timezone. */
export function dueMomentAtZone(
  day: string,
  atTime: string | null,
  timezone: string,
): ZonedDueMoment | null {
  try {
    formatter(timezone).format(0)
  } catch {
    return null
  }
  if (!DAY_RE.test(day)) return null
  const parsedTime = atTime && TIME_RE.test(atTime) ? atTime : null
  if (parsedTime) {
    const instantMs = zonedEpochMs(day, parsedTime, timezone)
    if (instantMs !== null) {
      return { kind: 'timed', instantMs, overdueAtMs: instantMs + 1 }
    }
  }
  const nextDay = addCalendarDay(day)
  if (!nextDay) return null
  const instantMs = zonedEpochMs(nextDay, '00:00', timezone)
  return instantMs === null ? null : { kind: 'untimed', instantMs, overdueAtMs: instantMs }
}
