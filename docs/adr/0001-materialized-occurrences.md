# Recurring Series are stored as a hidden definition plus materialized Occurrence rows

A Recurring Series is one hidden row carrying the shared content and the Recurrence Rule, kept out
of the Board, plus one real row per Occurrence written ahead over a rolling 90-day horizon. The
alternative — keeping only the Rule and computing Occurrences on read — was rejected because every
Occurrence in this app is independently editable: it can be completed, pinned, rescheduled to
another day or into the Inbox, reordered within its day or its Kanban column, and deleted. All of
that is per-Occurrence state that a computed view has nowhere to put.

## Consequences

- **The Occurrence Date, not the Scheduled Day, is an Occurrence's identity within its Series**
  (`tasks_recur_instance_uniq` on `(recur_parent_id, recur_origin_day)`). Materialization asks "is
  this Occurrence Date already covered?", so identifying by the movable day would regenerate a
  duplicate on the original date the moment a card was dragged.
- **Deleting an Occurrence must be remembered.** With no row to represent absence, the Series
  carries a list of Excluded Dates instead; without it, the next materialization pass recreates
  what the user deleted.
- **The horizon is finite.** A Series with no end date has real rows only 90 days out, so any
  query, export, or report that expects the full future of a Series is asking a question this model
  cannot answer.
- **A Rule change rewrites rows.** Shortening a Series deletes the Occurrences past its new end
  rather than simply narrowing a computed range, which is why those operations are planned as
  explicit write/delete sequences in `src/data/series.ts` rather than performed as a single update.
- **Adding a Rule to a standalone Task converts that row into the Series definition** and creates a
  fresh Occurrence in its place — a new row, with its own id and its own progress.
