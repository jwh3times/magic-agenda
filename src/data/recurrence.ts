import type { RecurFreq } from '../types/task'
import { addDays, addMonths, isScheduled, parseDay, ymd } from '../lib/dates'

export const RECUR_HORIZON_DAYS = 90

/** The recurrence-relevant fields of a template task. */
export interface RecurRule {
  day: string // anchor / first occurrence ('YYYY-MM-DD')
  recurFreq: RecurFreq
  recurInterval: number
  recurUntil: string | null
  recurSkip: string[]
}

/**
 * Occurrence dates of a rule from its anchor up to `horizonEnd` (inclusive), capped by
 * `recur_until` and excluding `skip` dates. ISO date strings compare chronologically.
 */
export function occurrenceDates(
  freq: RecurFreq,
  interval: number,
  anchor: string,
  until: string | null,
  horizonEnd: string,
  skip: readonly string[] = [],
): string[] {
  if (freq === 'none') return []
  const step = Math.max(1, interval)
  const end = until && until < horizonEnd ? until : horizonEnd
  const skipSet = new Set(skip)
  const dates: string[] = []
  let d = parseDay(anchor)
  let guard = 0
  while (guard++ < 1000) {
    const ds = ymd(d)
    if (ds > end) break
    if (!skipSet.has(ds)) dates.push(ds)
    d = freq === 'daily' ? addDays(d, step) : freq === 'weekly' ? addDays(d, 7 * step) : addMonths(d, step)
  }
  return dates
}

/**
 * Occurrence dates within the rolling horizon that have no materialized instance yet — i.e. the
 * instances to create. Skipped (deleted) occurrences are never returned.
 */
export function missingInstanceDates(
  template: RecurRule,
  existingDays: readonly string[],
  todayStr: string,
  horizonDays = RECUR_HORIZON_DAYS,
): string[] {
  if (template.recurFreq === 'none' || !isScheduled(template.day)) return []
  const horizonEnd = ymd(addDays(parseDay(todayStr), horizonDays))
  const occ = occurrenceDates(
    template.recurFreq,
    template.recurInterval,
    template.day,
    template.recurUntil,
    horizonEnd,
    template.recurSkip,
  )
  const existing = new Set(existingDays)
  return occ.filter((d) => !existing.has(d))
}
