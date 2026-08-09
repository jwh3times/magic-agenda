import { isScheduled } from '../lib/dates'
import type { Task } from '../types/task'
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
 * Fields a recurring instance can change without touching series content, so a save can go
 * straight through without the this-occurrence-vs-all-future prompt.
 *
 * The counterpart is `seriesContent()` in `series.ts`, which lists the fields an all-future edit
 * *does* propagate. The two are deliberately separate: this set is about whether to ask, that one
 * is about what to copy, and they are not exact complements (`day`, `order`, `checklist` and the
 * recurrence fields are in neither).
 *
 * `done` is absent because it is fully derived from `status` — see `changedTaskKeys`.
 */
export const PER_OCCURRENCE_FIELDS: ReadonlySet<keyof Task> = new Set<keyof Task>([
  'pinned',
  'status',
])

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
export function changedTaskKeys(a: Task, b: Task): (keyof Task)[] {
  return (Object.keys(b) as (keyof Task)[]).filter((key) => {
    if (key === 'done') return false
    const av = a[key]
    const bv = b[key]
    if (Array.isArray(av) && Array.isArray(bv)) return JSON.stringify(av) !== JSON.stringify(bv)
    return av !== bv
  })
}

/** True when every changed field is per-occurrence — i.e. no series content changed. */
export function onlyPerOccurrenceChanged(original: Task, next: Task): boolean {
  return changedTaskKeys(original, next).every((key) => PER_OCCURRENCE_FIELDS.has(key))
}

/** Normalizes a draft into the task that would actually be saved. */
export function cleanDraft(draft: Task): Task {
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
  | { kind: 'save'; task: Task; scope?: RecurScope }
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
export function intendSave(initial: Task, draft: Task, isNew: boolean): SaveIntent {
  const task = cleanDraft(draft)
  if (task.title.length === 0) return { kind: 'blocked' }
  // `draft.recurParentId` rather than `initial`'s: the draft is what is about to be saved.
  if (isNew || !draft.recurParentId) return { kind: 'save', task }
  // Pin/status-only edits have no series content to route, so there is nothing to ask about.
  if (onlyPerOccurrenceChanged(initial, task)) return { kind: 'save', task, scope: 'this' }
  return { kind: 'ask' }
}

export type DeleteIntent = { kind: 'delete'; task: Task } | { kind: 'ask' }

/**
 * **`task` is `initial`, not the edited draft — every edit made in the modal is discarded.**
 *
 * That is the existing behaviour, preserved deliberately and made visible here rather than left
 * implicit in two call sites. It is filed as #132 and is genuinely undecided: acting on the draft
 * matches "delete what I'm looking at", while acting on the stored task is safer for a recurring
 * instance, whose `recurSkip` entry and `recurUntil` cap are computed from fields the user may
 * have just changed without saving. `editIntent.test.ts` pins the current answer so a change to it
 * has to be deliberate.
 */
export function intendDelete(initial: Task, draft: Task, isNew: boolean): DeleteIntent {
  if (!isNew && draft.recurParentId) return { kind: 'ask' }
  return { kind: 'delete', task: initial }
}
