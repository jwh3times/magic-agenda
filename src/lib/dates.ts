import { INBOX } from '../types/task'

export const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]
export const WEEKDAYS_LONG = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]
export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
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

/** The Sunday that starts the week containing `base`. */
export function startOfWeek(base: Date): Date {
  return addDays(base, -base.getDay())
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
