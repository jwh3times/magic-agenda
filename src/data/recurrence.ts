import type { RecurFreq } from '../types/task'
import { addDays, addMonths, isScheduled, parseDay, ymd } from '../lib/dates'

export const RECUR_HORIZON_DAYS = 90

/**
 * How far *below* today materialization still fills in Occurrences. Zero is the literal reading of
 * "from today forward", but `useTasks.materialize()` clocks in browser-local time while a board
 * can carry its own timezone, so today here can be a day ahead of today there. Without the slack a
 * board whose zone is behind the browser's would drop its current Occurrence below the floor and
 * never create it — permanently, since the floor only moves forward. One day costs at most one
 * extra past Occurrence and can never drop the current one.
 */
const MATERIALIZE_GRACE_DAYS = 1

/** Runaway backstop on a single walk's output; see `occurrenceDates`. */
const MAX_OCCURRENCES = 1000

/** The Recurrence Rule: the recurrence-relevant fields of a template task. */
export interface RecurRule {
  day: string // anchor / first occurrence ('YYYY-MM-DD')
  recurFreq: RecurFreq
  recurInterval: number
  recurUntil: string | null
  excludedDates: string[]
}

/**
 * A rule's Occurrence Dates within the window `[from, horizonEnd]` (both inclusive), capped by
 * `recur_until` and dropping every Excluded Date. ISO date strings compare chronologically.
 *
 * `anchor` is the rule's **phase**, not the start of the window: "every 3 days from July 1st"
 * lands on a different set of dates than "every 3 days from today", so `from` filters the walk
 * rather than re-anchoring it. Both are required — a `from` defaulting to the anchor is the
 * unbounded backfill of #210 wearing a default.
 */
export function occurrenceDates(
  freq: RecurFreq,
  interval: number,
  anchor: string,
  until: string | null,
  from: string,
  horizonEnd: string,
  excluded: readonly string[] = [],
): string[] {
  if (freq === 'none') return []
  const step = Math.max(1, interval)
  const end = until && until < horizonEnd ? until : horizonEnd
  const excludedSet = new Set(excluded)
  const dates: string[] = []

  // Stepping one occurrence at a time from the anchor costs work proportional to the anchor's
  // *age* rather than to the window asked for, and a daily rule anchored three years back needs
  // ~1,180 steps to reach today — more than the ceiling below, so the walk used to stop short of
  // the window entirely and answer nothing (#210). Daily and weekly steps are a fixed number of
  // days, and day arithmetic is associative, so those two can start a whole number of steps back
  // from `from`. The jump deliberately *floors*: it lands on or before the first date in the
  // window, and the loop still filters, so it can only save iterations, never change the result.
  //
  // Monthly is never jumped. `addMonths` overflows rather than clamps — Jan 31 plus one month is
  // Mar 3 — so n single steps do not land where one n-month step does, and jumping would silently
  // re-phase the rule. It advances at least 28 days a step, so its walk is bounded anyway.
  let d = parseDay(anchor)
  if (freq !== 'monthly' && from > anchor) {
    const stepDays = freq === 'daily' ? step : 7 * step
    // Rounded, not floored: a local-midnight day is 23 or 25 hours long across a DST transition.
    const behind = Math.round((parseDay(from).getTime() - d.getTime()) / 86_400_000)
    const skip = Math.floor(behind / stepDays)
    if (skip > 0) d = addDays(d, skip * stepDays)
  }

  // Termination is `ds > end`, not this bound — every branch below advances by at least one day.
  // The bound caps the *result*, and is a runaway backstop rather than a product limit: a 90-day
  // horizon holds at most 91 daily Occurrences, so nothing reaches it now that the window starts
  // at `from` instead of at an arbitrarily old anchor.
  while (dates.length < MAX_OCCURRENCES) {
    const ds = ymd(d)
    if (ds > end) break
    if (ds >= from && !excludedSet.has(ds)) dates.push(ds)
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
 *
 * The window starts at today (less `MATERIALIZE_GRACE_DAYS`), never at the rule's anchor: adding a
 * Recurrence Rule to a Task scheduled in the past would otherwise materialize every Occurrence
 * back to that date — ~455 rows for a year-old Task — and the same backfill would repeat on every
 * horizon refresh, not just the first (#210). The anchor still sets the rule's phase, so which
 * dates an interval lands on is unchanged; only how far back they are created is.
 */
export function missingInstanceDates(
  template: RecurRule,
  existingDays: readonly string[],
  todayStr: string,
  horizonDays = RECUR_HORIZON_DAYS,
): string[] {
  if (template.recurFreq === 'none' || !isScheduled(template.day)) return []
  const today = parseDay(todayStr)
  const occ = occurrenceDates(
    template.recurFreq,
    template.recurInterval,
    template.day,
    template.recurUntil,
    ymd(addDays(today, -MATERIALIZE_GRACE_DAYS)),
    ymd(addDays(today, horizonDays)),
    template.excludedDates,
  )
  const existing = new Set(existingDays)
  return occ.filter((d) => !existing.has(d))
}
