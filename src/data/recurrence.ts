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
  recurCount: number | null
  recurWeekdays: number[]
  excludedDates: string[]
}

/**
 * The weekdays a weekly Rule actually lands on: the set it names, **always including the anchor's
 * own weekday**, or just the anchor's weekday when it names none.
 *
 * The forced inclusion is the decision worth understanding, because strict filtering is the obvious
 * alternative and it breaks a different part of the model. `planPromoteToSeries` turns the existing
 * Task into the Series' *first Occurrence* at its own `day` — that is what keeps the user's status,
 * Checklist Completion and manual order when a Task starts repeating (#206) — so a Rule that did
 * not yield its own anchor would produce a Series whose first Occurrence is not one of its
 * Occurrence Dates. Materialization would then see that date as unfilled forever.
 *
 * Enforcing it here rather than only in the editor is what makes the guarantee hold for imported
 * files and direct Data API writes too, neither of which goes near the editor.
 */
function effectiveWeekdays(rule: RecurRule): ReadonlySet<number> {
  const anchorDow = parseDay(rule.day).getDay()
  return rule.recurWeekdays.length === 0
    ? new Set([anchorDow])
    : new Set([...rule.recurWeekdays, anchorDow])
}

/**
 * A Rule's Occurrence Dates within the window `[from, horizonEnd]` (both inclusive), capped by its
 * own end and dropping every Excluded Date. ISO date strings compare chronologically.
 *
 * `rule.day` is the Rule's **phase**, not the start of the window: "every 3 days from July 1st"
 * lands on a different set of dates than "every 3 days from today", so `from` filters the walk
 * rather than re-anchoring it. Both window bounds are required and sit outside the Rule object for
 * that reason — a `from` defaulting to the anchor is the unbounded backfill of #210 wearing a
 * default, and a Rule-shaped parameter is exactly where such a default would hide.
 */
export function occurrenceDates(rule: RecurRule, from: string, horizonEnd: string): string[] {
  return walk(rule, from, horizonEnd)
}

/** A Rule that ends: by date, by count, or both. The only shape `allOccurrenceDates` accepts. */
export type BoundedRule = RecurRule & ({ recurUntil: string } | { recurCount: number })

export function isBoundedRule(rule: RecurRule): rule is BoundedRule {
  return rule.recurUntil !== null || rule.recurCount !== null
}

/**
 * Every Occurrence Date the Rule will **ever** yield, Excluded Dates already dropped.
 *
 * Only a Rule that ends can be asked this, and `BoundedRule` is how that precondition is carried:
 * an unbounded Rule has no last Occurrence Date, so the honest answer is not a list. The type is
 * what stops `ruleIsSpent`'s early return being deleted as redundant — without it, dropping that
 * line compiles and silently walks to the `MAX_OCCURRENCES` ceiling instead of failing.
 */
export function allOccurrenceDates(rule: BoundedRule): string[] {
  return walk(rule, rule.day, null)
}

/**
 * The shared walk. `end` is null only when the count is what terminates it.
 *
 * Two shapes, and the split is on whether the Rule names weekdays rather than on its frequency. A
 * Rule with a weekday set advances a **week block** at a time and emits every chosen weekday inside
 * it; every other Rule advances one Occurrence Date at a time, exactly as before. Block zero starts
 * at the anchor, so a block spans `[blockStart, blockStart + 6]` and covers each weekday exactly
 * once — which is what makes "every 2 weeks on Mon and Fri" mean something without consulting the
 * user's week-start preference. Anchoring the block on the anchor rather than on a Sunday or a
 * Monday is what keeps this function pure and settings-free.
 */
function walk(rule: RecurRule, from: string, horizonEnd: string | null): string[] {
  const { recurFreq: freq, recurUntil: until, recurCount: count } = rule
  if (freq === 'none') return []
  // An unscheduled anchor yields no Occurrence Dates at all.
  //
  // **No test reaches this line, and that is measured rather than assumed** — removing it leaves
  // the whole suite green. Two accidents cover it: `parseDay('inbox')` is an Invalid Date whose
  // `ymd` is 'NaN-NaN-NaN', which sorts past every real date and so trips `ds > end`; and where
  // `end` is null (a count-bounded `allOccurrenceDates`) `from` is the anchor itself, and
  // 'NaN-NaN-NaN' sorts *before* 'inbox', so the window filter drops it. Both are properties of
  // string comparison against a sentinel, not of this Rule being unscheduled. The guard is here so
  // the answer stops depending on them, and it is stated as defence rather than dressed up with a
  // test that would pass either way.
  if (!isScheduled(rule.day)) return []
  // Unreachable from either entry point — `occurrenceDates` requires a `horizonEnd` and
  // `allOccurrenceDates` requires a `BoundedRule` — and cheaper than a third runaway bound: with
  // neither terminator this loop does not end.
  if (horizonEnd === null && until === null && count === null) return []

  const step = Math.max(1, rule.recurInterval)
  const end = until !== null && (horizonEnd === null || until < horizonEnd) ? until : horizonEnd
  const excluded = new Set(rule.excludedDates)
  const weekdays = freq === 'weekly' ? effectiveWeekdays(rule) : null
  const byWeekday = weekdays !== null && rule.recurWeekdays.length > 0

  const dates: string[] = []
  // Counted from the Series' **first** Occurrence Date, which is not the same as the first one in
  // the window: #210 moved the window's lower bound to today, so a count measured from `from`
  // would silently lengthen every Rule whose Series started in the past.
  let generated = 0

  // Stepping one Occurrence at a time from the anchor costs work proportional to the anchor's
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
  //
  // A **counted** Rule is never jumped either, for a different reason: the tally has to start at
  // the Series' first Occurrence, and a jump skips exactly the Occurrences it would have counted.
  // Nothing is lost by walking — a count of at most `MAX_OCCURRENCES` bounds the walk by itself,
  // which is precisely why the two share a ceiling.
  let d = parseDay(rule.day)
  if (count === null && freq !== 'monthly' && from > rule.day) {
    const stepDays = byWeekday ? 7 * step : freq === 'daily' ? step : 7 * step
    // Rounded, not floored: a local-midnight day is 23 or 25 hours long across a DST transition.
    const behind = Math.round((parseDay(from).getTime() - d.getTime()) / 86_400_000)
    const skip = Math.floor(behind / stepDays)
    if (skip > 0) d = addDays(d, skip * stepDays)
  }

  // Termination is `ds > end` or the count, not this bound — every branch below advances by at
  // least one day. The bound caps the *result*, and is a runaway backstop rather than a product
  // limit: a 90-day horizon holds at most 91 daily Occurrences, so nothing reaches it now that the
  // window starts at `from` instead of at an arbitrarily old anchor.
  outer: while (dates.length < MAX_OCCURRENCES) {
    if (byWeekday) {
      const blockStart = d
      if (end !== null && ymd(blockStart) > end) break
      for (let offset = 0; offset < 7; offset++) {
        const cur = addDays(blockStart, offset)
        if (!weekdays.has(cur.getDay())) continue
        const ds = ymd(cur)
        if (end !== null && ds > end) break outer
        generated++
        if (ds >= from && !excluded.has(ds)) dates.push(ds)
        if (count !== null && generated >= count) break outer
        if (dates.length >= MAX_OCCURRENCES) break outer
      }
      d = addDays(blockStart, 7 * step)
    } else {
      const ds = ymd(d)
      if (end !== null && ds > end) break
      generated++
      if (ds >= from && !excluded.has(ds)) dates.push(ds)
      if (count !== null && generated >= count) break
      d =
        freq === 'daily'
          ? addDays(d, step)
          : freq === 'weekly'
            ? addDays(d, 7 * step)
            : addMonths(d, step)
    }
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
    template,
    ymd(addDays(today, -MATERIALIZE_GRACE_DAYS)),
    ymd(addDays(today, horizonDays)),
  )
  const existing = new Set(existingDays)
  return occ.filter((d) => !existing.has(d))
}
