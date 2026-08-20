import type { ChecklistItem, Task } from '../types/task'

/**
 * Reconciling Checklist Steps when a Recurring Series' Checklist changes.
 *
 * Checklist structure is Series Content and Step Completion is Occurrence State
 * ([ADR-0002](../../docs/adr/0002-series-occurrence-field-ownership.md)), so an all-future edit
 * rewrites the Steps on every affected Occurrence while preserving what each one had ticked. That
 * is only possible if a Step keeps one identity across its Series, which is why `makeInstance`
 * copies the definition's Step ids instead of minting fresh ones.
 */

/**
 * `series` Steps, carrying each Occurrence Step's `done` where the two correspond.
 *
 * A renamed Step keeps its tick, a removed Step takes its tick with it, a new Step arrives
 * unticked, and reordering preserves every tick — all of which fall out of matching on identity
 * rather than position. Position matching was rejected precisely because inserting one Step at the
 * top would shift every tick onto its neighbour.
 *
 * **The text fallback is for Occurrences materialized before Step ids were stable.** Those were
 * built by copying the definition's Step *text* with a fresh id, so their ids match nothing and
 * identity alone would reset every tick they hold. Matching the leftovers by exact text recovers
 * them whenever the Steps are unchanged since materialization, which is the ordinary case. It is
 * deliberately a second pass over what identity did not claim, never a competitor to it: an id
 * match always wins, so a Step renamed in this very edit keeps its own tick rather than stealing
 * the tick of whichever Step happens to still carry its old words. The fallback becomes dead
 * weight once every Occurrence of a Series has been rebuilt with stable ids, and is cheap enough
 * to leave in place rather than schedule a migration for.
 */
export function reconcileSteps(
  series: readonly ChecklistItem[],
  occurrence: readonly ChecklistItem[],
): ChecklistItem[] {
  const byId = new Map(occurrence.map((s) => [s.id, s]))
  const claimed = new Set<string>()

  // Pass 1 — identity. Recorded first in full, so no text match can consume a Step that an id
  // match is entitled to.
  const matched = series.map((step) => {
    const hit = byId.get(step.id)
    if (hit) claimed.add(hit.id)
    return hit
  })

  // Pass 2 — text, over what identity left behind on both sides.
  const leftovers = occurrence.filter((s) => !claimed.has(s.id))
  return series.map((step, i) => {
    const hit = matched[i]
    if (hit) return { ...step, done: hit.done }
    const j = leftovers.findIndex((s) => s.text === step.text)
    if (j === -1) return { ...step, done: false }
    const [taken] = leftovers.splice(j, 1)
    return { ...step, done: taken.done }
  })
}

/** An Occurrence with the Series' Steps applied, keeping its own Step Completion. */
export function withSeriesChecklist(occurrence: Task, series: readonly ChecklistItem[]): Task {
  return { ...occurrence, checklist: reconcileSteps(series, occurrence.checklist) }
}
