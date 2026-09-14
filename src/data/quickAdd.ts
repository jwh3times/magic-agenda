import { INBOX } from '../types/task'
import { addDays, MONTHS_LONG, parseDay, ymd } from '../lib/dates'

/**
 * Quick-add: turn a line like "groceries tomorrow" into a title and a Scheduled Day (#269).
 *
 * A deliberately small token grammar with no natural-language dependency. It recognizes one date
 * phrase, and only at the **end** of the line — where people put it ("call mom friday", "dentist on
 * mar 4") — so a title that merely contains a date-like word ("Friday standup notes") is left alone.
 * Anything it does not recognize, or recognizes as a date that does not exist ("2/30"), stays in the
 * title and the task goes to the Inbox: a wrong date is worse than no date, so this never guesses.
 *
 * Pure: `today` and the numeric date order are passed in, so nothing here reads a clock or a locale.
 */

/** Which number comes first in a numeric date like "3/4". Derived from the browser's locale. */
export type DateOrder = 'md' | 'dm'

export interface QuickAddResult {
  title: string
  /** `'inbox'` when no date was recognized, otherwise 'YYYY-MM-DD'. */
  day: string
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** A weekday from its full name or its first three letters. */
function weekdayIndex(word: string): number {
  const w = word.toLowerCase()
  if (w.length < 3) return -1
  return WEEKDAYS.findIndex((name) => name === w || (w.length === 3 && name.startsWith(w)))
}

/** A month (0-11) from its full name or its first three letters. */
function monthIndex(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, '')
  if (w.length < 3) return -1
  return MONTHS_LONG.findIndex((name) => {
    const n = name.toLowerCase()
    return n === w || (w.length === 3 && n.startsWith(w))
  })
}

/** 'YYYY-MM-DD' for a calendar date, or null when the date does not exist (Feb 30, month 13). */
function validDay(year: number, month: number, date: number): string | null {
  if (month < 0 || month > 11 || date < 1 || date > 31) return null
  const d = new Date(year, month, date)
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== date) return null
  return ymd(d)
}

/**
 * The next occurrence of a month and day on or after `today`: this year if it has not passed,
 * otherwise next year. A date the user types without a year means the one coming up.
 */
function upcoming(month: number, date: number, today: string): string | null {
  const todayDate = parseDay(today)
  const year = todayDate.getFullYear()
  const thisYear = validDay(year, month, date)
  if (thisYear && thisYear >= today) return thisYear
  // Feb 29 in a non-leap year has no "this year" at all; the next valid one may be further out.
  for (let y = year + 1; y <= year + 8; y++) {
    const next = validDay(y, month, date)
    if (next) return next
  }
  return null
}

/** A two- or four-digit year typed by the user; two digits mean the 2000s. */
function fullYear(text: string): number {
  const n = Number(text)
  return text.length <= 2 ? 2000 + n : n
}

/**
 * The day a trailing date phrase names, and how many words that phrase used, or null when the
 * words at the end are not a date.
 */
function trailingDate(
  words: string[],
  today: string,
  order: DateOrder,
): { day: string; used: number } | null {
  const last = words[words.length - 1]?.toLowerCase()
  if (!last) return null

  if (last === 'today') return { day: today, used: 1 }
  if (last === 'tomorrow') return { day: ymd(addDays(parseDay(today), 1)), used: 1 }

  // A weekday means the next one after today; "today" already covers the current day.
  const wd = weekdayIndex(last)
  if (wd >= 0) {
    const t = parseDay(today)
    const ahead = (wd - t.getDay() + 7) % 7 || 7
    return { day: ymd(addDays(t, ahead)), used: 1 }
  }

  // Numeric: m/d or d/m by locale, optionally /yy or /yyyy. Dashes and dots are accepted too.
  const numeric = last.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/)
  if (numeric) {
    const [a, b] = [Number(numeric[1]), Number(numeric[2])]
    const [month, date] = order === 'md' ? [a - 1, b] : [b - 1, a]
    const day = numeric[3]
      ? validDay(fullYear(numeric[3]), month, date)
      : upcoming(month, date, today)
    return day ? { day, used: 1 } : null
  }

  // "mar 4", "march 4", or "4 march" — month names read the same in every locale.
  if (words.length >= 2) {
    const prev = words[words.length - 2].toLowerCase()
    const num = /^\d{1,2}$/
    if (num.test(last) && monthIndex(prev) >= 0) {
      const day = upcoming(monthIndex(prev), Number(last), today)
      return day ? { day, used: 2 } : null
    }
    if (num.test(prev) && monthIndex(last) >= 0) {
      const day = upcoming(monthIndex(last), Number(prev), today)
      return day ? { day, used: 2 } : null
    }
  }

  return null
}

export function parseQuickAdd(input: string, today: string, order: DateOrder): QuickAddResult {
  const text = input.trim().replace(/\s+/g, ' ')
  const words = text ? text.split(' ') : []
  const found = trailingDate(words, today, order)
  if (!found) return { title: text, day: INBOX }

  let rest = words.slice(0, words.length - found.used)
  // "dentist on friday" — the connective belongs to the date phrase, not the title.
  if (rest.length > 0 && rest[rest.length - 1].toLowerCase() === 'on') rest = rest.slice(0, -1)

  // A line that is only a date ("tomorrow") would leave an empty title, which is not a task.
  // Keep the whole line as the title and schedule nothing, rather than invent a name.
  if (rest.length === 0) return { title: text, day: INBOX }
  return { title: rest.join(' '), day: found.day }
}

/**
 * Whether a locale writes numeric dates month-first or day-first, read from `Intl` rather than a
 * hand-kept list. Year-first locales (ja, zh, sv) put the month before the day, so they read as
 * `'md'`. Falls back to `'md'` if the formatter cannot be built.
 */
export function dateOrderForLocale(locale?: string): DateOrder {
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(new Date(2000, 11, 31))
    const month = parts.findIndex((p) => p.type === 'month')
    const day = parts.findIndex((p) => p.type === 'day')
    return day >= 0 && month >= 0 && day < month ? 'dm' : 'md'
  } catch {
    return 'md'
  }
}
