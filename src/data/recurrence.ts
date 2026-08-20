import type { RecurFreq } from '../types/task'
import { addDays, addMonths, isScheduled, parseDay, ymd } from '../lib/dates'

export const RECUR_HORIZON_DAYS = 90

/** The Recurrence Rule: the recurrence-relevant fields of a template task. */
export interface RecurRule {
  day: string // anchor / first occurrence ('YYYY-MM-DD')
  recurFreq: RecurFreq
  recurInterval: number
  recurUntil: string | null
  excludedDates: string[]
}

/**
 * Occurrence Dates of a rule from its anchor up to `horizonEnd` (inclusive), capped by
 * `recur_until` and dropping every Excluded Date. ISO date strings compare chronologically.
 */
export function occurrenceDates(
  freq: RecurFreq,
  interval: number,
  anchor: string,
  until: string | null,
  horizonEnd: string,
  excluded: readonly string[] = [],
): string[] {
  if (freq === 'none') return []
  const step = Math.max(1, interval)
  const end = until && until < horizonEnd ? until : horizonEnd
  const excludedSet = new Set(excluded)
  const dates: string[] = []
  let d = parseDay(anchor)
  let guard = 0
  while (guard++ < 1000) {
    const ds = ymd(d)
    if (ds > end) break
    if (!excludedSet.has(ds)) dates.push(ds)
    d =
      freq === 'daily'
        ? addDays(d, step)
        : freq === 'weekly'
          ? addDays(d, 7 * step)
          : addMonths(d, step)
  }
  return dates
}

/**
 * The Occurrence Date an instance represents: its recorded one, or (for legacy instances that
 * predate the field) its current day. This — not the mutable Scheduled Day — is what identifies
 * which Occurrence an instance covers, so dragging one to another day does not make its original
 * Occurrence Date look unfilled and regenerate a duplicate.
 */
export function occurrenceDateOf(t: { occurrenceDate: string | null; day: string }): string {
  return t.occurrenceDate ?? t.day
}

/**
 * Whether an instance falls in the "this Occurrence and all later" scope of an all-future edit or
 * delete, compared by Occurrence Date (not the movable Scheduled Day) so a dragged card is scoped
 * by the Occurrence it represents rather than where it currently sits. `cutDate` is the Occurrence
 * Date the scope starts at. ISO date strings compare chronologically.
 */
export function isFromOccurrenceOnward(
  t: { occurrenceDate: string | null; day: string },
  cutDate: string,
): boolean {
  return occurrenceDateOf(t) >= cutDate
}

/**
 * Like `missingInstanceDates`, but takes the existing instances (not their days) and treats each as
 * covering its Occurrence Date — so a moved instance keeps that date filled.
 */
export function missingInstances(
  template: RecurRule,
  existing: readonly { occurrenceDate: string | null; day: string }[],
  todayStr: string,
  horizonDays = RECUR_HORIZON_DAYS,
): string[] {
  return missingInstanceDates(template, existing.map(occurrenceDateOf), todayStr, horizonDays)
}

/**
 * Occurrence Dates within the rolling horizon that have no materialized instance yet — i.e. the
 * instances to create. Excluded Dates are never returned.
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
    template.excludedDates,
  )
  const existing = new Set(existingDays)
  return occ.filter((d) => !existing.has(d))
}
