import { addDays, parseDay, ymd } from '../lib/dates'
import {
  asOccurrence,
  asTask,
  isSeriesDefinition,
  isTemplate,
  NO_RECUR,
  type Occurrence,
  type SeriesDefinition,
  type Task,
  type TaskDraft,
} from '../types/task'
import { occurrenceDateOf, isFromOccurrenceOnward, missingInstances } from './recurrence'
import { reconcileSteps } from './checklistSteps'
import {
  PER_OCCURRENCE_FIELDS,
  RULE_EDITABLE_FIELDS,
  SERIES_CONTENT_FIELDS,
  pick,
} from './fieldOwnership'

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

/**
 * The board and the hidden Series definitions, which most operations have to change together.
 *
 * `templates` is `SeriesDefinition[]`, and that is the regression guard for #220 rather than
 * tidiness. It was `Task[]` because `planEditSeriesFrom` copied the draft's `recurFreq` onto the
 * definition, so removing the Rule with all-future scope produced a definition carrying
 * `recurFreq: 'none'` — a hidden row that materialized nothing and was no longer reachable as a
 * Series. Narrowing this is what makes that state a compile error instead of a silent one; the
 * operation now routes to `planEndSeriesAt`, which produces a standalone Task and no definition
 * at all.
 *
 * `tasks` stays `readonly Task[]` rather than `BoardCard[]`: definitions are excluded from the
 * board by `useTasks`, not by this type, and narrowing it is a separate change with its own
 * fallout.
 */
export interface SeriesState {
  tasks: readonly Task[]
  templates: readonly SeriesDefinition[]
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
export function makeInstance(tmpl: Task, day: string, nextId: () => string): Occurrence {
  return {
    id: nextId(),
    title: tmpl.title,
    description: tmpl.description,
    labelId: tmpl.labelId,
    color: tmpl.color,
    // The Step **id is preserved**, not minted: a Step keeps one identity across its Series, which
    // is what lets an all-future Checklist edit carry each Occurrence's Step Completion across
    // instead of resetting it (#214). Only `done` resets — this builds a future Occurrence, which
    // starts with nothing ticked.
    checklist: tmpl.checklist.map((c) => ({ ...c, done: false })),
    status: 'todo',
    done: false,
    day,
    atTime: tmpl.atTime,
    // Never `tmpl.pinned`. Pinning is Occurrence State (ADR-0002), so a Series has no pin to pass
    // on — and it could not have passed on a meaningful one anyway: nothing after
    // `planPromoteToSeries` ever wrote that field, so it was frozen at whatever the Task's pin
    // happened to be when it was promoted, and every future Occurrence was born pinned with no way
    // to change it (#215).
    pinned: false,
    order: 5000,
    korder: 5000,
    recurInterval: 1,
    excludedDates: [],
    ...asOccurrence(tmpl.id, day),
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
  | { kind: 'promote-to-series'; task: TaskDraft }
  /** One occurrence of a series: the rule is stripped so it never persists onto the instance. */
  | { kind: 'update-occurrence'; task: Occurrence }
  | { kind: 'update-series-from'; instance: TaskDraft; draft: TaskDraft }
  /** The Recurrence Rule was removed with all-future scope: the Series ends at this Occurrence. */
  | { kind: 'end-series-at'; instance: TaskDraft; draft: TaskDraft }

export type DeleteOp =
  | { kind: 'delete-plain'; id: string }
  | { kind: 'delete-occurrence'; instance: Task }
  | { kind: 'delete-series-from'; instance: Task }

/**
 * True when an all-future save would **end** the Series rather than edit it — the user cleared the
 * Repeat control on a draft that was showing a Rule.
 *
 * Exported because two callers must agree on it. `resolveSave` routes on it to pick
 * `planEndSeriesAt`, which deletes every later Occurrence (or the definition itself, at the
 * anchor); `ScopePrompt` reads it to say so before the user commits, since the card they are
 * looking at survives either way and the rows that disappear are the ones off-screen (#229). A
 * second, independently-worded copy of this test is how the warning and the behaviour drift apart.
 *
 * **Both halves are required.** A rule-less draft has two readings, and only one of them is a
 * removal: `Board.openTask` merges the Series' Rule onto the draft *only if it finds the
 * definition*, so a lookup that missed produces a draft indistinguishable from one the user
 * cleared. Testing `draft` alone therefore routes a plain rename to a plan that deletes rows — and
 * the definition can be absent when the editor opens and present when Save fires, since the
 * realtime reducer adds one on a definition-shaped UPDATE. `orig` is what seeds the Repeat control,
 * so a Rule the user could have removed is always visible there; requiring it means the
 * never-merged case falls back to the behaviour it had before this branch existed.
 *
 * Shortening a Rule (`recurUntil` moved earlier) also deletes Occurrences and is deliberately
 * **not** covered: #229 chose to warn about removal only, leaving the trim as it has always been.
 */
export function removesRule(orig: TaskDraft, draft: TaskDraft): boolean {
  return draft.recurFreq === 'none' && orig.recurFreq !== 'none'
}

/**
 * Turns an editor result into the operation to perform.
 *
 * This was a four-branch ternary in `Board.handleSave`, which meant the UI shell had to know that
 * "`recurParentId` is set" means "this is an instance" — and had to remember to strip the rule
 * fields on the this-occurrence path, with nothing but a comment enforcing it.
 */
export function resolveSave(
  orig: TaskDraft | null,
  draft: TaskDraft,
  isNew: boolean,
  scope?: RecurScope,
): SaveOp {
  if (isNew) return { kind: 'create', task: asTask(draft) }
  if (!orig?.recurParentId) {
    // A Recurrence Rule on a Task that had no parent means the user just made it repeat.
    return isTemplate(draft)
      ? { kind: 'promote-to-series', task: draft }
      : { kind: 'update-plain', task: asTask(draft) }
  }
  if (scope === 'future') {
    // Removing the Rule is not an edit *to* the Rule, and routing it as one was #220. See
    // `removesRule` for why the question is asked of both drafts rather than of `draft` alone.
    return removesRule(orig, draft)
      ? { kind: 'end-series-at', instance: orig, draft }
      : { kind: 'update-series-from', instance: orig, draft }
  }
  return {
    kind: 'update-occurrence',
    task: {
      ...draft,
      recurInterval: 1,
      ...asOccurrence(orig.recurParentId, occurrenceDateOf(orig)),
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
 * Series-wide content an all-future edit copies onto affected Occurrences.
 *
 * Derived from `FIELD_OWNER` rather than listed here, so it cannot drift from the set of fields
 * whose change raises the scope question — the two are complements of one partition (ADR-0002).
 * Occurrence State and Occurrence Placement are excluded by construction: carrying them would
 * clobber each Occurrence's own progress and position.
 */
function seriesContent(draft: TaskDraft): Partial<TaskDraft> {
  return pick(draft, SERIES_CONTENT_FIELDS)
}

/** What the edited Occurrence keeps of its own: its state and its placement. */
function occurrenceOwned(draft: TaskDraft): Partial<TaskDraft> {
  return pick(draft, PER_OCCURRENCE_FIELDS)
}

/**
 * Apply an instance edit to the template and to this occurrence onward.
 *
 * Returns `null` when the instance has no template — the series is gone, and there is nothing
 * coherent to edit "from here on".
 */
export function planEditSeriesFrom(
  state: SeriesState,
  instance: TaskDraft,
  draft: TaskDraft,
): SeriesPlan | null {
  const template = state.templates.find((t) => t.id === instance.recurParentId)
  if (!template) return null

  // Scoped by the Occurrence Date, not the movable Scheduled Day, so a dragged card still edits
  // the right Occurrences (and matches how materialization identifies them).
  const cut = occurrenceDateOf(instance)
  // `RULE_EDITABLE_FIELDS` rather than every Rule field: `excludedDates` is Rule-owned but must
  // never come from a draft. A draft is an Occurrence, whose own `excludedDates` is always empty,
  // so copying it here would erase the Series' Excluded Dates and resurrect every Occurrence the
  // user has deleted.
  // `asTask` rather than a bare object: `seriesContent`/`pick` return a partial, and spreading a
  // partial widens the recurrence fields back to their union, so the shape has to be re-chosen.
  const rebuilt = asTask({
    ...template,
    ...seriesContent(draft),
    // Unticked, like `status` above: Step Completion is Occurrence State, so a definition holds
    // the Steps and never their progress.
    checklist: draft.checklist.map((c) => ({ ...c, done: false })),
    ...pick(draft, RULE_EDITABLE_FIELDS),
  })
  // A draft with no Rule does not describe a Series, and `resolveSave` routes that case to
  // `planEndSeriesAt` instead — so this is unreachable. It is checked rather than asserted because
  // it is exactly the invariant #220 broke: the old code wrote the rule-less row and left a
  // definition that materialized nothing.
  if (!isSeriesDefinition(rebuilt)) return null
  const nextTemplate: SeriesDefinition = rebuilt

  const affected = (t: Task) => t.recurParentId === template.id && isFromOccurrenceOnward(t, cut)
  // Every affected Occurrence takes the new Series Content and keeps its own state and placement —
  // built from the *stored* row for exactly that reason. The one being edited is the exception: its
  // own state and placement come from the draft, or a pin toggled in the same save as a rename
  // would be silently dropped on the very card the user was editing.
  const editedTasks = state.tasks.map((t) => {
    if (!affected(t)) return t
    // The card in front of the user takes the draft outright — its own state, its own placement,
    // and its own Checklist including whatever it has ticked right now. Reconciling it against the
    // stored row instead would hand back the ticks the user just changed.
    if (t.id === draft.id) {
      return asTask({
        ...t,
        ...seriesContent(draft),
        ...occurrenceOwned(draft),
        checklist: draft.checklist,
      })
    }
    // Every other affected Occurrence keeps its own state, placement, and Step Completion.
    return asTask({
      ...t,
      ...seriesContent(draft),
      checklist: reconcileSteps(draft.checklist, t.checklist),
    })
  })

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

  const nextTemplate: SeriesDefinition = {
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
 * True when **no Occurrence** of `template` would survive a cut at `cut`, so trimming the Rule
 * would leave a definition that owns nothing and can never produce anything again.
 *
 * Both trimming planners used to ask `cut <= template.day`, which is a different question: it
 * tests whether the cut lands on the Series' **anchor**, not whether anything is left behind it.
 * Deleting an Occurrence individually leaves an Excluded Date, so a Series whose earlier
 * Occurrences have each been deleted can be trimmed to a Rule that yields nothing while the anchor
 * test still reports a survivor. The result is a valid but meaningless `SeriesDefinition` — hidden
 * from the board, harmless to render, and carried into every backup by `exportBoard` (#228).
 *
 * Survivors are counted by **Occurrence Date**, never the movable Scheduled Day, for the same
 * reason every other scope decision here is: a card dragged past the cut still covers its own
 * Occurrence Date, and its Series still owns it.
 *
 * For a **scheduled** anchor this subsumes the old test rather than sitting beside it — no
 * Occurrence Date precedes the anchor — so the whole-Series branch is entered strictly more often,
 * never less. The one exception is an unscheduled anchor, and it exists only in string ordering:
 * `'inbox'` sorts after every date, so `cut <= template.day` was vacuously true and the old code
 * removed the whole Series for any cut at all. Such a definition owns no Occurrences to cut from
 * (`missingInstanceDates` returns `[]` for an unscheduled anchor, and `TaskEditor` has refused to
 * save one since #209), and where it is reachable, preserving the earlier rows is the better
 * answer — so this is a widening in every case that can occur.
 *
 * The comparison is safe against the `'inbox'` sentinel by construction: the parent test narrows
 * `t` to an `Occurrence`, whose `occurrenceDate` is non-null, so `occurrenceDateOf`'s `?? day`
 * fallback is unreachable here and the value compared is always a real date.
 *
 * **Precondition: `state.tasks` is the whole board.** The old test read one field of the
 * definition, a fact the server also knows. This one reads local state to choose a branch that
 * deletes the definition and cascades to every Occurrence row in the database — including any this
 * client never loaded. The two questions coincide only because `reload()` selects the board with no
 * date window and an offline board is read-only, so no planner ever runs against a partial one. A
 * windowed load would turn this from tidiness into deleting rows the user can still see.
 *
 * Definitions already orphaned in existing accounts are deliberately left as they are: nothing
 * reads them, and a migration or load-time sweep was judged not worth its cost (#228 option 3).
 * This stops new ones appearing.
 */
function noOccurrenceSurvives(
  state: SeriesState,
  template: SeriesDefinition,
  cut: string,
): boolean {
  return !state.tasks.some((t) => t.recurParentId === template.id && occurrenceDateOf(t) < cut)
}

/**
 * Delete this occurrence and every later one.
 *
 * A cut that leaves the series with no surviving occurrence removes the **whole series**: the
 * template row goes, and the database cascade takes its instances with it. Otherwise the rule is
 * capped at the day before the cut and the future instances are deleted. That is not the same as
 * cutting at the anchor, which is what this used to test — see `noOccurrenceSurvives` (#228).
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

  // Not "is this the anchor" — "does anything survive". See `noOccurrenceSurvives` (#228).
  if (noOccurrenceSurvives(state, template, cut)) {
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

  const nextTemplate: SeriesDefinition = {
    ...template,
    recurUntil: ymd(addDays(parseDay(cut), -1)),
  }
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
 * End the Series at this Occurrence: the Rule stops here, and this Occurrence becomes a
 * standalone Task carrying the edits saved alongside the removal.
 *
 * This is what removing a Recurrence Rule with all-future scope means (#220). Routing it through
 * `planEditSeriesFrom` instead — as an edit that happens to set `recurFreq: 'none'` — produced a
 * definition that no test the app applies still recognised: `isTemplate` was false for it, so a
 * reload would have put it on the board except that it stayed hidden, `missingInstanceDates`
 * returned `[]` so it materialized nothing ever again, and its existing Occurrences went on
 * pointing at it.
 *
 * Earlier Occurrences are deliberately left alone, content included. All-future scope says
 * nothing about them, and they remain what they were: Occurrences of a Series that has now ended.
 *
 * Two orderings here are load-bearing rather than incidental:
 *
 * - **The detach is upserted before anything is deleted**, and a failed upsert aborts the rest
 *   (`FATAL`). Cutting at the Series' own anchor deletes the definition, and `tasks.recur_parent_id`
 *   cascades — so a row still naming that parent goes with it. The row the user is *keeping* is
 *   exactly that row until the detach lands.
 * - **The trimming delete is scoped `occurrence-after`, not `occurrence-from`.** The cut date is
 *   the Occurrence being kept, so scoping strictly after it means the delete cannot reach that row
 *   even if the detach has not been applied yet — the plan does not depend on its own ordering
 *   twice over.
 */
export function planEndSeriesAt(
  state: SeriesState,
  instance: TaskDraft,
  draft: TaskDraft,
): SeriesPlan {
  const template = state.templates.find((t) => t.id === instance.recurParentId)
  // `NO_RECUR` rather than editing the recurrence fields by hand: this row stops being an
  // Occurrence *and* must not become a definition, which is one shape, not two field changes.
  const detached = asTask({ ...draft, ...NO_RECUR, recurInterval: 1, excludedDates: [] })
  const withDetached = state.tasks.map((t) => (t.id === detached.id ? detached : t))

  // No definition to trim: "the Series is gone" is already the outcome being asked for, so this
  // degrades to detaching the row. `CONTEXT.md`: an Occurrence whose Series no longer exists is a
  // standalone Task.
  if (!template) {
    return {
      state: { tasks: withDetached, templates: state.templates },
      upserts: [detached],
      upsertOnFailure: ROLLBACK,
      deletions: [],
      markIds: [detached.id],
      materialize: [],
    }
  }

  // By Occurrence Date, never the movable Scheduled Day — the same rule as every other scope here.
  const cut = occurrenceDateOf(instance)
  const ofSeries = (t: Task) => t.recurParentId === template.id

  if (noOccurrenceSurvives(state, template, cut)) {
    // No Occurrence precedes this one, so no Series survives it: the definition goes and the
    // database cascade takes the Occurrences still pointing at it. The detached row no longer
    // does, which is why its upsert has to have landed first. The test is "does anything survive",
    // not "is this the anchor" — see `noOccurrenceSurvives` (#228).
    return {
      state: {
        tasks: withDetached.filter((t) => !ofSeries(t)),
        templates: state.templates.filter((t) => t.id !== template.id),
      },
      upserts: [detached],
      upsertOnFailure: FATAL,
      deletions: [{ target: { by: 'id', id: template.id }, onFailure: RESYNC }],
      markIds: [detached.id, template.id, ...state.tasks.filter(ofSeries).map((t) => t.id)],
      materialize: [],
    }
  }

  const later = (t: Task) => ofSeries(t) && occurrenceDateOf(t) > cut
  const nextTemplate: SeriesDefinition = {
    ...template,
    recurUntil: ymd(addDays(parseDay(cut), -1)),
  }

  return {
    state: {
      tasks: withDetached.filter((t) => !later(t)),
      templates: state.templates.map((t) => (t.id === template.id ? nextTemplate : t)),
    },
    upserts: [detached, nextTemplate],
    upsertOnFailure: FATAL,
    deletions: [
      { target: { by: 'occurrence-after', parentId: template.id, day: cut }, onFailure: RESYNC },
    ],
    markIds: [detached.id, template.id, ...state.tasks.filter(later).map((t) => t.id)],
    // Nothing to create: the Rule now ends before this Occurrence.
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
  draft: TaskDraft,
  nextId: () => string,
): SeriesPlan | null {
  // `asTask` picks the shape from the fields. Promotion is only reached when the draft carries a
  // Rule, so this is a `SeriesDefinition` — checked below rather than asserted, for the same
  // reason as in `planEditSeriesFrom`.
  const built = asTask({
    ...draft,
    id: nextId(),
    // The template is a definition, not a card. Occurrence State is meaningless on it and would
    // be misleading anywhere templates are read directly — the export file, for one.
    // `makeInstance` resets these again when it builds each Occurrence; belt and braces is the
    // right trade for a row no screen ever shows. `pinned` joined this list in #215: it is
    // Occurrence State like the rest, and leaving it set was what made a Series' pin look like a
    // value worth copying. The first Occurrence below keeps the user's own pin, as it keeps the
    // rest of their work.
    status: 'todo',
    done: false,
    pinned: false,
    checklist: draft.checklist.map((item) => ({ ...item, done: false })),
    recurParentId: null,
    excludedDates: [],
    occurrenceDate: null,
  })
  // Unreachable: `resolveSave` only produces `promote-to-series` for a rule-bearing draft.
  if (!isSeriesDefinition(built)) return null
  const template: SeriesDefinition = built

  const first: Occurrence = {
    ...draft,
    recurInterval: 1,
    excludedDates: [],
    ...asOccurrence(template.id, draft.day),
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
