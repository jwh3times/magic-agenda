import { INBOX } from '../types/task'

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
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
