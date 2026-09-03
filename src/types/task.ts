export type Color = 'yellow' | 'pink' | 'blue' | 'mint' | 'lilac' | 'orange'
export type ActiveWorkflowStatus = 'todo' | 'doing'
export type WorkflowStatus = ActiveWorkflowStatus | 'completed'
export type RecurFreq = 'none' | 'daily' | 'weekly' | 'monthly'
export type ThemeName = 'cork' | 'brutal' | 'glass'
export type ViewName = 'calendar' | 'week' | 'agenda' | 'kanban'

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

/**
 * Everything every Task carries, whatever its recurrence shape.
 *
 * The recurrence fields are not here: they are what distinguishes the three shapes below, and
 * putting them on the base would let the union express combinations the domain does not have.
 */
export interface TaskBase {
  id: string
  title: string
  description: string
  /** Optional Board Label. null is the first-class Unlabeled state. */
  labelId: string | null
  color: Color
  checklist: ChecklistItem[]
  status: WorkflowStatus
  /** Time of the current Completion. Null for active and pre-v3 legacy Tasks. */
  completedAt: string | null
  /** Active Workflow Status restored by quick Reopen. Null on legacy Tasks until backfill. */
  reopenStatus: ActiveWorkflowStatus | null
  /** Time this Completed Task entered Archive. Archive controls ship after this model cutover. */
  archivedAt: string | null
  /**
   * App-level day sentinel: the literal 'inbox' (unscheduled) or a 'YYYY-MM-DD' date.
   * Maps to NULL at the database boundary (see data/mappers.ts).
   */
  day: string
  /** Optional due time 'HH:MM' (24h). null = all-day. Maps to the nullable at_time column. */
  atTime: string | null
  /** Sticky-note pin (importance flag). Filterable, never a sort key. */
  pinned: boolean
  /** Order within a day (calendar/week views). */
  order: number
  /** Order within a status column (kanban view). */
  korder: number
  /** The Recurrence Rule's interval. Only meaningful on a `SeriesDefinition`. */
  recurInterval: number
  /** Excluded Dates (YYYY-MM-DD). Only meaningful on a `SeriesDefinition`. */
  excludedDates: string[]
}

/** A Task that neither repeats nor belongs to a Recurring Series. */
export interface StandaloneTask extends TaskBase {
  recurFreq: 'none'
  recurUntil: null
  recurParentId: null
  occurrenceDate: null
}

/**
 * The hidden definition of a Recurring Series: the Rule plus the Series Content its Occurrences
 * are built from. Never appears on the Board — `useTasks` holds these in a separate ref.
 */
export interface SeriesDefinition extends TaskBase {
  recurFreq: Exclude<RecurFreq, 'none'>
  recurUntil: string | null
  recurParentId: null
  occurrenceDate: null
}

/**
 * One Occurrence a Recurring Series has produced.
 *
 * `occurrenceDate` is **non-null here**, which is the point of the union: an Occurrence is
 * identified within its Series by that date, and the nullable version forced every reader through
 * a `?? day` fallback for a state the data no longer contains. The database backs the claim with
 * `tasks_occurrence_has_date`; without it the partial unique index would not even constrain such a
 * row, since NULLs are distinct in a unique index.
 */
export interface Occurrence extends TaskBase {
  recurFreq: 'none'
  recurUntil: null
  recurParentId: string
  occurrenceDate: string
}

/**
 * A Task in any of its three shapes.
 *
 * Narrow with `isSeriesDefinition` / `isOccurrence`, or on the fields directly — `recurParentId`
 * is `string` only on an Occurrence, and `recurFreq` is non-`'none'` only on a definition.
 */
export type Task = StandaloneTask | SeriesDefinition | Occurrence

/**
 * A Task that can appear on the Board. Definitions cannot, so most of the app wants this rather
 * than `Task`: it is what a card, a lane, a drag, and a filter all operate on.
 */
export type BoardCard = StandaloneTask | Occurrence

/**
 * Every field a Task can carry, with the recurrence fields left wide — the task editor's working
 * shape, and the shape of anything not yet narrowed to one of the three.
 *
 * It is deliberately **not** a `Task`. `Board.openTask` merges the Series' Recurrence Rule onto an
 * Occurrence so the Repeat controls have something to edit, producing a row that names a parent
 * *and* carries a Rule — a combination no Task has. That was previously typed as `Task`, which
 * simply asserted something untrue; `asTask` narrows a draft back to a real shape on save.
 */
export type TaskDraft = TaskBase & {
  recurFreq: RecurFreq
  recurUntil: string | null
  recurParentId: string | null
  occurrenceDate: string | null
}

/** The sentinel used throughout app + dnd logic for an unscheduled task. */
export const INBOX = 'inbox'

/** Default (non-recurring) recurrence fields — spread into task constructors. */
export const NO_RECUR = {
  recurFreq: 'none',
  recurInterval: 1,
  recurUntil: null,
  recurParentId: null,
  excludedDates: [] as string[],
  occurrenceDate: null,
} satisfies Pick<
  StandaloneTask,
  | 'recurFreq'
  | 'recurInterval'
  | 'recurUntil'
  | 'recurParentId'
  | 'excludedDates'
  | 'occurrenceDate'
>

/**
 * A Task is the hidden definition of a Recurring Series when it bears a Rule and has no parent.
 *
 * Kept as the historical name because six modules read it; `isSeriesDefinition` is the same test
 * under the domain's word, and narrows.
 */
export function isTemplate(t: Pick<Task, 'recurFreq' | 'recurParentId'>): boolean {
  return t.recurFreq !== 'none' && !t.recurParentId
}

/** The recurrence fields that make a Task an Occurrence of `seriesId` on `occurrenceDate`. */
export function asOccurrence(seriesId: string, occurrenceDate: string) {
  return {
    recurFreq: 'none',
    recurUntil: null,
    recurParentId: seriesId,
    occurrenceDate,
  } satisfies Pick<Occurrence, 'recurFreq' | 'recurUntil' | 'recurParentId' | 'occurrenceDate'>
}

/** The recurrence fields that make a Task the definition of a Recurring Series. */
export function asSeriesDefinition(
  recurFreq: Exclude<RecurFreq, 'none'>,
  recurUntil: string | null,
) {
  return { recurFreq, recurUntil, recurParentId: null, occurrenceDate: null } satisfies Pick<
    SeriesDefinition,
    'recurFreq' | 'recurUntil' | 'recurParentId' | 'occurrenceDate'
  >
}

/**
 * Assemble a Task from loose recurrence fields, choosing the shape they describe.
 *
 * This is the **one place** the three shapes are recovered from input that is not already typed —
 * the database boundary (`rowToTask`), the file parser, and test factories all funnel through it,
 * so nothing else has to defend against an impossible combination.
 *
 * A row naming a parent but carrying no Occurrence Date is read as a **standalone Task**, not as an
 * Occurrence with a missing date. That is not a new decision: `20260813210200` detached exactly
 * those rows in production for the same reason, and its comment says it "makes them what they
 * already are". `tasks_occurrence_has_date` now stops any more being written — which matters more
 * than it looks, because the occurrence-uniqueness index is partial on `recur_parent_id` and NULLs
 * are distinct in a unique index, so such a row would not have been constrained by it at all.
 */
export function asTask(input: TaskDraft): Task {
  if (input.recurParentId !== null && input.occurrenceDate !== null) {
    return { ...input, ...asOccurrence(input.recurParentId, input.occurrenceDate) }
  }
  if (input.recurFreq !== 'none') {
    return { ...input, ...asSeriesDefinition(input.recurFreq, input.recurUntil) }
  }
  return {
    ...input,
    ...NO_RECUR,
    recurInterval: input.recurInterval,
    excludedDates: input.excludedDates,
  }
}

/** Narrowing form of `isTemplate`. */
export function isSeriesDefinition(t: Task): t is SeriesDefinition {
  return t.recurFreq !== 'none' && t.recurParentId === null
}

/** Whether this Task is an Occurrence of a Recurring Series. */
export function isOccurrence(t: Task): t is Occurrence {
  return t.recurParentId !== null
}
