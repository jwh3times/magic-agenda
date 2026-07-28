import { INBOX } from '../types/task'

export const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
export const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]
export const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Local-date YYYY-MM-DD (ported from prototype `ymd`). */
export function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${da}`
}

export function addDays(base: Date, n: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + n)
  return d
}

export function addMonths(base: Date, n: number): Date {
  const d = new Date(base)
  d.setMonth(d.getMonth() + n)
  return d
}

/** The first day of the week containing `base`. `weekStart` is 0=Sunday … 6=Saturday. */
export function startOfWeek(base: Date, weekStart = 0): Date {
  return addDays(base, -((base.getDay() - weekStart + 7) % 7))
}

/** Parse a 'YYYY-MM-DD' day into a local Date. */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** e.g. 'Sep 1 – 7' or 'Sep 28 – Oct 4'. */
export function formatWeekRange(weekStart: Date): string {
  const end = addDays(weekStart, 6)
  const sM = MONTHS_SHORT[weekStart.getMonth()]
  const eM = MONTHS_SHORT[end.getMonth()]
  return weekStart.getMonth() === end.getMonth()
    ? `${sM} ${weekStart.getDate()} – ${end.getDate()}`
    : `${sM} ${weekStart.getDate()} – ${eM} ${end.getDate()}`
}

/** e.g. 'Monday, Sep 1' for an agenda group header. */
export function formatAgendaDate(day: string): string {
  const d = parseDay(day)
  return `${WEEKDAYS_LONG[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
}

/** True when a day value is a real scheduled date (not inbox / empty). */
export function isScheduled(day: string): boolean {
  return !!day && day !== INBOX && day.indexOf('-') >= 0
}

/** Short label for a task's day chip — 'Inbox' or e.g. 'Mar 4' (ported from prototype `chipLabel`). */
export function chipLabel(day: string): string {
  if (!isScheduled(day)) return 'Inbox'
  const p = day.split('-')
  const mo = MONTHS_SHORT[Number(p[1]) - 1]
  return `${mo} ${Number(p[2])}`
}

/** 'HH:MM' → compact 12-hour label, e.g. '14:30' → '2:30pm', '09:00' → '9am'. */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const ap = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12}${ap}` : `${h12}:${String(m).padStart(2, '0')}${ap}`
}

/** `WEEKDAYS_SHORT` rotated so index 0 is the configured first day of the week. */
export function weekdayLabels(weekStart = 0): string[] {
  return Array.from({ length: 7 }, (_, i) => WEEKDAYS_SHORT[(weekStart + i) % 7])
}

/**
 * Today as 'YYYY-MM-DD' in `tz` (an IANA id); a nullish `tz` means the browser's own zone.
 *
 * The locale is pinned to 'en-US-u-ca-gregory' rather than left to the ambient one: a
 * locale-less formatter under, say, a Thai locale yields a Buddhist-era year, which would
 * silently break every comparison against a stored `day`. `formatToParts` rather than the
 * 'en-CA' → 'YYYY-MM-DD' trick, which is a locale-data coincidence, not a guarantee.
 */
export function todayYmd(tz?: string | null): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
      ...(tz ? { timeZone: tz } : {}),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
    const y = get('year')
    const m = get('month')
    const d = get('day')
    if (!y || !m || !d) return ymd(new Date())
    return `${y}-${m}-${d}`
  } catch {
    // An unknown zone (a stale value synced from another device, a hand-edited row) throws
    // RangeError. Browser-local is the honest fallback, and never throwing keeps the board up.
    return ymd(new Date())
  }
}

/** The browser's own IANA zone, for the settings picker's "Automatic (…)" label. */
export function browserTimezone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

// Only for engines without `Intl.supportedValuesOf` (pre-2022). Deliberately not exhaustive:
// it just has to keep the picker usable, and `todayYmd` accepts any zone the engine knows.
const FALLBACK_TIMEZONES = [
  'UTC',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
  'America/Anchorage',
  'America/Argentina/Buenos_Aires',
  'America/Bogota',
  'America/Chicago',
  'America/Denver',
  'America/Halifax',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/New_York',
  'America/Phoenix',
  'America/Sao_Paulo',
  'America/Toronto',
  'Asia/Dubai',
  'Asia/Hong_Kong',
  'Asia/Jakarta',
  'Asia/Jerusalem',
  'Asia/Kolkata',
  'Asia/Manila',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Melbourne',
  'Australia/Perth',
  'Australia/Sydney',
  'Europe/Amsterdam',
  'Europe/Berlin',
  'Europe/Dublin',
  'Europe/Istanbul',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Moscow',
  'Europe/Paris',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Zurich',
  'Pacific/Auckland',
  'Pacific/Honolulu',
]

/**
 * Every IANA zone the engine knows, else a curated fallback.
 *
 * `Intl.supportedValuesOf` is only *typed* from `lib.es2022.intl` and `tsconfig.app.json` sets
 * `lib: ["ES2020", …]`. The cast is not a workaround for that — the runtime feature-detect is
 * needed for the fallback regardless, so do not "fix" this by widening `lib`.
 */
export function supportedTimezones(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: 'timeZone') => string[] })
    .supportedValuesOf
  if (typeof supported !== 'function') return FALLBACK_TIMEZONES
  try {
    const zones = supported.call(Intl, 'timeZone')
    const result = zones.length > 0 ? zones : FALLBACK_TIMEZONES
    // Ensure UTC is always available
    if (!result.includes('UTC')) {
      return ['UTC', ...result]
    }
    return result
  } catch {
    return FALLBACK_TIMEZONES
  }
}
