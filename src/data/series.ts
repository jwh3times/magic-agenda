import { addDays, parseDay, ymd } from '../lib/dates'
import { isTemplate, type Task } from '../types/task'
import { occurrenceDateOf, isFromOccurrenceOnward, missingInstances } from './recurrence'

/**
 * Everything the app knows about recurring series, as pure functions over plain data.
 *
 * A series is a hidden **template** row (`recurFreq != 'none'`, `recurParentId === null`) kept out
 * of the board list, plus materialized **instance** rows pointing at it. That invariant used to be
 * enforced in five files: the scope dispatch lived in `Board`, `instanceKey` was defined
 * identically in `useTasks` and `realtime.ts`, `makeInstance` and the three scope operations lived
 * inside a 207-line block of `useTasks` that no test reached, and only `recurrence.ts` — the
 * cheapest part — was covered.
 *
 * The effectful half stays in `useTasks`, but it now *executes a plan* rather than deciding
 * anything: every state transition, every row to write, and every row to delete is computed here.
 */

/** The board and the hidden templates, which most operations have to change together. */
export interface SeriesState {
  tasks: readonly Task[]
  templates: readonly Task[]
}

/**
 * Identity of a materialized instance: its Occurrence Date, never its mutable Scheduled Day.
 *
 * Mirrors the `(recur_parent_id, recur_origin_day)` unique index, so dragging an instance to
 * another day does not make its original occurrence look unfilled and regenerate a duplicate
 * (`23505` on `tasks_recur_instance_uniq`). This was defined twice, identically, in `useTasks.ts`
 * and `realtime.ts`, each with a comment claiming to mirror that index — three copies of one
 * database invariant.
 */
export function instanceKey(t: {
  recurParentId: string | null
  occurrenceDate: string | null
  day: string
}): string {
  return `${t.recurParentId}|${occurrenceDateOf(t)}`
}

/** Builds one instance of a template for `day`. `nextId` is injected so tests are deterministic. */
export function makeInstance(tmpl: Task, day: string, nextId: () => string): Task {
  return {
    id: nextId(),
    title: tmpl.title,
    description: tmpl.description,
    labelId: tmpl.labelId,
    color: tmpl.color,
    checklist: tmpl.checklist.map((c) => ({ id: nextId(), text: c.text, done: false })),
    status: 'todo',
    done: false,
    day,
    atTime: tmpl.atTime,
    pinned: tmpl.pinned,
    order: 5000,
    korder: 5000,
    recurFreq: 'none',
    recurInterval: 1,
    recurUntil: null,
    recurParentId: tmpl.id,
    excludedDates: [],
    occurrenceDate: day,
  }
}

/**
 * The instances that are missing from `board` and should be created.
 *
 * `board` is **required**, deliberately. It used to default to a ref inside `useTasks` whose own
 * docstring called the default unsafe — the ref is written inside a deferred React state updater,
 * so right after `setTasks(...)` it can still hold the pre-load value, which makes every
 * occurrence look missing and re-inserts rows that already exist. Three of the four call sites
 * took that default and none of them was tested. There is no default here to take.
 */
export function pendingInstances(
  templates: readonly Task[],
  board: readonly Task[],
  todayStr: string,
  nextId: () => string,
): Task[] {
  const out: Task[] = []
  for (const tmpl of templates) {
    // Match by origin so an instance dragged to another day still counts as covering its
    // occurrence and is not resurrected as a duplicate there.
    const existing = board.filter((t) => t.recurParentId === tmpl.id)
    for (const day of missingInstances(tmpl, existing, todayStr)) {
      out.push(makeInstance(tmpl, day, nextId))
    }
  }
  // Never propose two instances for the same occurrence in one pass.
  const seen = new Set<string>()
  return out.filter((i) => {
    const key = instanceKey(i)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ——— scope resolution ———

/** Which occurrences an edit or delete applies to. Chosen by the editor's scope prompt. */
export type RecurScope = 'this' | 'future'

export type SaveOp =
  | { kind: 'create'; task: Task }
  /** A standalone Task that stays standalone. */
  | { kind: 'update-plain'; task: Task }
  /** A standalone Task that gained a Recurrence Rule and becomes a Recurring Series. */
  | { kind: 'promote-to-series'; task: Task }
  /** One occurrence of a series: the rule is stripped so it never persists onto the instance. */
  | { kind: 'update-occurrence'; task: Task }
  | { kind: 'update-series-from'; instance: Task; draft: Task }

export type DeleteOp =
  | { kind: 'delete-plain'; id: string }
  | { kind: 'delete-occurrence'; instance: Task }
  | { kind: 'delete-series-from'; instance: Task }

/**
 * Turns an editor result into the operation to perform.
 *
 * This was a four-branch ternary in `Board.handleSave`, which meant the UI shell had to know that
 * "`recurParentId` is set" means "this is an instance" — and had to remember to strip the rule
 * fields on the this-occurrence path, with nothing but a comment enforcing it.
 */
export function resolveSave(
  orig: Task | null,
  draft: Task,
  isNew: boolean,
  scope?: RecurScope,
): SaveOp {
  if (isNew) return { kind: 'create', task: draft }
  if (!orig?.recurParentId) {
    // A Recurrence Rule on a Task that had no parent means the user just made it repeat.
    return isTemplate(draft)
      ? { kind: 'promote-to-series', task: draft }
      : { kind: 'update-plain', task: draft }
  }
  if (scope === 'future') return { kind: 'update-series-from', instance: orig, draft }
  return {
    kind: 'update-occurrence',
    task: {
      ...draft,
      recurFreq: 'none',
      recurInterval: 1,
      recurUntil: null,
      recurParentId: orig.recurParentId,
    },
  }
}

export function resolveDelete(task: Task, scope?: RecurScope): DeleteOp {
  if (!task.recurParentId) return { kind: 'delete-plain', id: task.id }
  if (scope === 'future') return { kind: 'delete-series-from', instance: task }
  return { kind: 'delete-occurrence', instance: task }
}

// ——— plans ———

/**
 * What a failed write costs. Two independent questions, because the existing behaviour answered
 * them independently and collapsing them would silently change it:
 *
 * - **`abort`** — do the plan's later steps still need to run? Shortening a series aborts on a
 *   failed content upsert (there is nothing to trim to), but deleting an occurrence does *not*
 *   abort when recording the skip fails: the occurrence must still go.
 * - **`recover`** — what to do once the plan finishes. `'reload'` resyncs from the server when
 *   local state can no longer be trusted; `'rollback'` restores the pre-plan state; `'none'` is a
 *   best-effort write whose failure is surfaced but changes nothing else.
 */
export interface FailureHandling {
  abort: boolean
  recover: 'none' | 'reload' | 'rollback'
}

const FATAL: FailureHandling = { abort: true, recover: 'reload' }
const RESYNC: FailureHandling = { abort: false, recover: 'reload' }
const ROLLBACK: FailureHandling = { abort: false, recover: 'rollback' }
const BEST_EFFORT: FailureHandling = { abort: false, recover: 'none' }

export type DeletionTarget =
  | { by: 'id'; id: string }
  /** Instances of a template whose Occurrence Date is strictly after `day`. */
  | { by: 'occurrence-after'; parentId: string; day: string }
  /** Instances of a template whose Occurrence Date is on or after `day`. */
  | { by: 'occurrence-from'; parentId: string; day: string }

export interface Deletion {
  target: DeletionTarget
  onFailure: FailureHandling
}

export interface SeriesPlan {
  /** The optimistic next state, applied before any write is sent. */
  state: SeriesState
  /** Upserted in one batch, before the deletions. */
  upserts: Task[]
  upsertOnFailure: FailureHandling
  /** Executed in order, after the upserts. */
  deletions: Deletion[]
  /** Marked as this client's own writes before anything is sent, to suppress the echoes. */
  markIds: string[]
  /** Templates to materialize once the writes have landed. */
  materialize: Task[]
}

/**
 * Series-wide content. Deliberately excludes `pinned`, `status`, and `done`: those are
 * per-occurrence, and a "this and all future" edit that carried them would clobber each
 * occurrence's own progress.
 */
function seriesContent(draft: Task) {
  return {
    title: draft.title,
    description: draft.description,
    labelId: draft.labelId,
    color: draft.color,
    atTime: draft.atTime,
  }
}

/**
 * Apply an instance edit to the template and to this occurrence onward.
 *
 * Returns `null` when the instance has no template — the series is gone, and there is nothing
 * coherent to edit "from here on".
 */
export function planEditSeriesFrom(
  state: SeriesState,
  instance: Task,
  draft: Task,
): SeriesPlan | null {
  const template = state.templates.find((t) => t.id === instance.recurParentId)
  if (!template) return null

  // Scoped by the Occurrence Date, not the movable Scheduled Day, so a dragged card still edits
  // the right Occurrences (and matches how materialization identifies them).
  const cut = occurrenceDateOf(instance)
  const nextTemplate: Task = {
    ...template,
    ...seriesContent(draft),
    checklist: draft.checklist,
    recurFreq: draft.recurFreq,
    recurInterval: draft.recurInterval,
    recurUntil: draft.recurUntil,
  }

  const affected = (t: Task) => t.recurParentId === template.id && isFromOccurrenceOnward(t, cut)
  const editedTasks = state.tasks.map((t) => (affected(t) ? { ...t, ...seriesContent(draft) } : t))

  // If the rule shortened, occurrences past the new end no longer exist.
  const until = nextTemplate.recurUntil
  const trimmed = until
    ? editedTasks.filter((t) => !(t.recurParentId === template.id && occurrenceDateOf(t) > until))
    : editedTasks

  const deletions: Deletion[] = until
    ? [
        {
          target: { by: 'occurrence-after', parentId: template.id, day: until },
          // Best-effort: the content edit above has already persisted and materialization still
          // has to run, so a failure here is reported without unwinding the rest.
          onFailure: BEST_EFFORT,
        },
      ]
    : []

  const upserts = [nextTemplate, ...editedTasks.filter(affected)]

  return {
    state: {
      tasks: trimmed,
      templates: state.templates.map((t) => (t.id === template.id ? nextTemplate : t)),
    },
    upserts,
    upsertOnFailure: FATAL,
    deletions,
    markIds: [
      ...upserts.map((t) => t.id),
      ...editedTasks
        .filter((t) => until && t.recurParentId === template.id && occurrenceDateOf(t) > until)
        .map((t) => t.id),
    ],
    materialize: [nextTemplate],
  }
}

/**
 * Delete one occurrence, and remember it so materialization never regenerates it.
 *
 * The Excluded Date recorded is the **Occurrence Date**, not the possibly-moved Scheduled Day.
 * Without a template (a legacy or orphaned instance) this degrades to a plain delete.
 */
export function planDeleteOccurrence(state: SeriesState, instance: Task): SeriesPlan {
  const template = state.templates.find((t) => t.id === instance.recurParentId)
  const deletion: Deletion = { target: { by: 'id', id: instance.id }, onFailure: ROLLBACK }
  const tasks = state.tasks.filter((t) => t.id !== instance.id)

  if (!template) {
    return {
      state: { tasks, templates: state.templates },
      upserts: [],
      upsertOnFailure: BEST_EFFORT,
      deletions: [deletion],
      markIds: [instance.id],
      materialize: [],
    }
  }

  const nextTemplate: Task = {
    ...template,
    excludedDates: [...template.excludedDates, occurrenceDateOf(instance)],
  }

  return {
    state: {
      tasks,
      templates: state.templates.map((t) => (t.id === template.id ? nextTemplate : t)),
    },
    upserts: [nextTemplate],
    // Best-effort: the occurrence delete below must still run even if recording the skip failed.
    upsertOnFailure: BEST_EFFORT,
    deletions: [deletion],
    markIds: [template.id, instance.id],
    materialize: [],
  }
}

/**
 * Delete this occurrence and every later one.
 *
 * Cutting at or before the template's own anchor removes the **whole series**: the template row
 * goes, and the database cascade takes its instances with it. Otherwise the rule is capped at the
 * day before the cut and the future instances are deleted.
 */
export function planDeleteSeriesFrom(state: SeriesState, instance: Task): SeriesPlan {
  const template = state.templates.find((t) => t.id === instance.recurParentId)
  if (!template) {
    return {
      state: { tasks: state.tasks.filter((t) => t.id !== instance.id), templates: state.templates },
      upserts: [],
      upsertOnFailure: BEST_EFFORT,
      deletions: [{ target: { by: 'id', id: instance.id }, onFailure: ROLLBACK }],
      markIds: [instance.id],
      materialize: [],
    }
  }

  const cut = occurrenceDateOf(instance)

  if (cut <= template.day) {
    return {
      state: {
        tasks: state.tasks.filter((t) => t.recurParentId !== template.id),
        templates: state.templates.filter((t) => t.id !== template.id),
      },
      upserts: [],
      upsertOnFailure: BEST_EFFORT,
      // Deleting the template cascades to its instances in the database.
      deletions: [{ target: { by: 'id', id: template.id }, onFailure: RESYNC }],
      markIds: [
        template.id,
        ...state.tasks.filter((t) => t.recurParentId === template.id).map((t) => t.id),
      ],
      materialize: [],
    }
  }

  const nextTemplate: Task = { ...template, recurUntil: ymd(addDays(parseDay(cut), -1)) }
  const doomed = state.tasks.filter(
    (t) => t.recurParentId === template.id && isFromOccurrenceOnward(t, cut),
  )

  return {
    state: {
      tasks: state.tasks.filter(
        (t) => !(t.recurParentId === template.id && isFromOccurrenceOnward(t, cut)),
      ),
      templates: state.templates.map((t) => (t.id === template.id ? nextTemplate : t)),
    },
    upserts: [nextTemplate],
    upsertOnFailure: RESYNC,
    deletions: [
      {
        target: { by: 'occurrence-from', parentId: template.id, day: cut },
        onFailure: RESYNC,
      },
    ],
    markIds: [template.id, ...doomed.map((t) => t.id)],
    materialize: [],
  }
}

/**
 * Promote a standalone Task to a Recurring Series.
 *
 * The Task **keeps its row** and becomes the Series' first Occurrence; a new row becomes the
 * hidden template. The obvious shape is the reverse — turn the row into the template in place and
 * let materialization produce the first Occurrence — and that is what shipped until #206. It cost
 * the user their work: `makeInstance` resets `status`, `done`, every checklist item's done-state,
 * and `order`/`korder`, because it builds *future* Occurrences, where resetting is exactly right.
 * The first Occurrence is not a future one. It is the card the user was already working on, and
 * the cheapest way to preserve it is not to recreate it — which also keeps its id, so anything
 * still holding a reference to that card is not left pointing at a row that has left the board.
 *
 * Requires a scheduled `day`: an unscheduled anchor produces no Occurrence Dates at all, so this
 * would file the Task away as a template that materializes nothing (#209). `TaskEditor` will not
 * let such a draft be saved.
 */
export function planPromoteToSeries(
  state: SeriesState,
  draft: Task,
  nextId: () => string,
): SeriesPlan {
  const template: Task = {
    ...draft,
    id: nextId(),
    // The template is a definition, not a card. Per-occurrence state is meaningless on it and
    // would be misleading anywhere templates are read directly — the export file, for one.
    // `makeInstance` resets these again when it builds each Occurrence; belt and braces is the
    // right trade for a row no screen ever shows.
    status: 'todo',
    done: false,
    checklist: draft.checklist.map((item) => ({ ...item, done: false })),
    recurParentId: null,
    excludedDates: [],
    occurrenceDate: null,
  }

  const first: Task = {
    ...draft,
    recurFreq: 'none',
    recurInterval: 1,
    recurUntil: null,
    recurParentId: template.id,
    excludedDates: [],
    occurrenceDate: draft.day,
  }

  return {
    state: {
      tasks: state.tasks.map((t) => (t.id === draft.id ? first : t)),
      templates: [...state.templates, template],
    },
    // One batch, so the template and its first Occurrence land together or not at all — a template
    // with no Occurrence is invisible, and an Occurrence with no template is orphaned.
    upserts: [template, first],
    upsertOnFailure: FATAL,
    deletions: [],
    markIds: [template.id, first.id],
    materialize: [template],
  }
}
