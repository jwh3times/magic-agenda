import { isScheduled } from '../lib/dates'
import { PER_OCCURRENCE_FIELDS } from './fieldOwnership'
import { type TaskDraft } from '../types/task'
import type { RecurScope } from './series'

/**
 * What pressing Save or Delete in the task editor should actually do.
 *
 * These were private functions inside `TaskEditor.tsx` — pure, deterministic, total, and the one
 * part of that 739-line module genuinely worth testing directly. Because they were not exported,
 * all eight of its tests reached them by rendering the modal and clicking through with
 * `userEvent`, and the fail-safe property documented on `changedTaskKeys` was asserted by nothing.
 *
 * `series.ts` decides *which occurrences* an operation touches. This decides *whether the editor
 * can proceed at all*, and whether it has to ask first.
 */

/**
 * Keys whose value differs between `a` and `b`.
 *
 * `done` is skipped — it is derived from `status`, so comparing it separately is redundant.
 * Arrays (the checklist) compare by content rather than reference, since `cleanDraft` always
 * remaps `checklist` into a fresh array.
 *
 * The `JSON.stringify` comparison assumes a consistent `ChecklistItem` key order across
 * constructors (`cleanDraft`'s `{ id, text, done }` literal). If that ever drifts the failure mode
 * is **fail-safe**: it over-reports a change, which over-shows the scope prompt, and never
 * suppresses one that was needed.
 */
export function changedTaskKeys(a: TaskDraft, b: TaskDraft): (keyof TaskDraft)[] {
  return (Object.keys(b) as (keyof TaskDraft)[]).filter((key) => {
    if (key === 'done') return false
    const av = a[key]
    const bv = b[key]
    if (Array.isArray(av) && Array.isArray(bv)) return JSON.stringify(av) !== JSON.stringify(bv)
    return av !== bv
  })
}

/**
 * True when every changed field is owned by this Occurrence alone — its state or its placement —
 * so there is no series content to route and no scope to ask about.
 *
 * The set comes from `FIELD_OWNER` rather than a list kept here; see `fieldOwnership.ts`.
 */
export function onlyPerOccurrenceChanged(original: TaskDraft, next: TaskDraft): boolean {
  return changedTaskKeys(original, next).every((key) => PER_OCCURRENCE_FIELDS.has(key))
}

/**
 * Normalizes a draft into what would actually be saved — still a `TaskDraft`, deliberately.
 *
 * It must **not** narrow to a `Task` here. An Occurrence's draft legitimately carries its parent
 * *and* its Series' Rule, because that Rule is what the Repeat controls edit; running it through
 * `asTask` at this point reads it as an Occurrence and forces `recurFreq` back to `'none'`, which
 * silently discards every all-future Rule change. Narrowing happens per branch in `resolveSave`,
 * once the scope says which shape the result is.
 */
export function cleanDraft(draft: TaskDraft): TaskDraft {
  return {
    ...draft,
    title: draft.title.trim(),
    day: isScheduled(draft.day) ? draft.day : 'inbox',
    done: draft.status === 'done',
    checklist: draft.checklist.map((c) => ({ id: c.id, text: c.text, done: c.done })),
  }
}

export type SaveIntent =
  /** The title is empty; Save does nothing. */
  | { kind: 'blocked' }
  /** Apply immediately. */
  | { kind: 'save'; task: TaskDraft; scope?: RecurScope }
  /** A recurring instance with series content changed — ask this-occurrence vs all-future first. */
  | { kind: 'ask' }

/**
 * `scope` is `undefined` only for tasks where it is meaningless (new tasks, and tasks that are not
 * instances of a series). For an instance it is always a definite `'this'` or `'future'`.
 *
 * That matters because the ambiguity used to leak: the editor emitted `undefined` on the
 * per-occurrence-only path and `Board` had to know it meant "this occurrence". `resolveSave` still
 * defends against `undefined` — that default is tested — but nothing produces it for an instance
 * any more.
 */
export function intendSave(initial: TaskDraft, draft: TaskDraft, isNew: boolean): SaveIntent {
  const task = cleanDraft(draft)
  if (task.title.length === 0) return { kind: 'blocked' }
  // `draft.recurParentId` rather than `initial`'s: the draft is what is about to be saved.
  if (isNew || !draft.recurParentId) return { kind: 'save', task }
  // Edits confined to this Occurrence — its state or its placement — have no series content to
  // route, so there is nothing to ask about.
  if (onlyPerOccurrenceChanged(initial, task)) return { kind: 'save', task, scope: 'this' }
  return { kind: 'ask' }
}

export type DeleteIntent = { kind: 'delete'; id: string } | { kind: 'ask' }

/**
 * **Only an id crosses this seam** — which is how #132 was resolved.
 *
 * That issue asked whether deleting should act on the edited draft or on the stored task, because
 * the editor passed a whole `Task` and the two differ. Answering it either way left the same
 * hazard in place: `onDelete(task: Task)` promised far more than the delete path used, so any
 * field later read from it (an undo toast's title, a confirmation dialog's date) would silently
 * start depending on unsaved edits with no test failing. Passing an id and letting the data layer
 * look the row up in its own state removes the question rather than answering it.
 *
 * It is also strictly more correct than either option was. `initial` is not the stored row:
 * `Board.openTask` merges the template's `recurFreq`/`recurInterval`/`recurUntil` onto an
 * instance before handing it to the editor.
 *
 * `recurParentId` is not editable, so reading it off the draft or the original is the same test.
 */
export function intendDelete(task: TaskDraft, isNew: boolean): DeleteIntent {
  if (!isNew && task.recurParentId) return { kind: 'ask' }
  return { kind: 'delete', id: task.id }
}
