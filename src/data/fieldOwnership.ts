import type { Task } from '../types/task'

/**
 * Who owns each field of a `Task` — the single classification behind both editing scopes.
 *
 * [ADR-0002](../../docs/adr/0002-series-occurrence-field-ownership.md) decides that every field
 * belongs to exactly one owner. **This-Occurrence** may change anything on one Occurrence;
 * **This-and-All-Future** may change only Series Content and the Recurrence Rule, and applies them
 * to the edited Occurrence, every later one, and every Occurrence not yet produced.
 *
 * Before this table there were two independently maintained lists — the fields whose change skipped
 * the scope prompt, and the fields an all-future edit copied — documented as "not exact
 * complements". Four fields were in neither (`day`, `order`, `korder`, `checklist`), and every one
 * of those gaps was a silent write loss rather than an error: an all-future date change evaporated,
 * and a pin saved alongside a rename was dropped. The lists are now derived from here, so **the
 * supported way to add a field to `Task` is to give it an owner** — `FIELD_OWNER` is a mapped type
 * over `keyof Task`, so omitting one is a compile error rather than a fifth silent gap.
 */
export type FieldOwner =
  /** Not editable content: what this row is and which Occurrence it represents. */
  | 'identity'
  /** The Recurrence Rule. Belongs to the Recurring Series. */
  | 'rule'
  /** What the work is. Belongs to the Series; every Occurrence carries a copy. */
  | 'series-content'
  /** What a person has done to one Occurrence. Never shared. */
  | 'occurrence-state'
  /** Where one Occurrence sits. Never shared. */
  | 'occurrence-placement'

export const FIELD_OWNER: { readonly [K in keyof Task]: FieldOwner } = {
  id: 'identity',
  recurParentId: 'identity',
  occurrenceDate: 'identity',

  recurFreq: 'rule',
  recurInterval: 'rule',
  recurUntil: 'rule',
  excludedDates: 'rule',

  title: 'series-content',
  description: 'series-content',
  labelId: 'series-content',
  color: 'series-content',
  atTime: 'series-content',
  checklist: 'series-content',

  status: 'occurrence-state',
  done: 'occurrence-state',
  pinned: 'occurrence-state',

  day: 'occurrence-placement',
  order: 'occurrence-placement',
  korder: 'occurrence-placement',
}

const keys = Object.keys(FIELD_OWNER) as (keyof Task)[]

function ownedBy(...owners: FieldOwner[]): ReadonlySet<keyof Task> {
  return new Set(keys.filter((k) => owners.includes(FIELD_OWNER[k])))
}

/**
 * Fields a recurring Occurrence can change without asking the scope question, because they mean
 * nothing beyond that one Occurrence.
 *
 * Placement is here as well as state: rescheduling one Occurrence or reordering it within a day
 * says nothing about the Series, so it has no scope to choose. Changing a Series' rhythm is an
 * edit to its Recurrence Rule, which is a different operation.
 */
export const PER_OCCURRENCE_FIELDS: ReadonlySet<keyof Task> = ownedBy(
  'occurrence-state',
  'occurrence-placement',
)

/**
 * Series Content an all-future edit copies onto affected Occurrences **by value**.
 *
 * `checklist` is Series Content and is deliberately not copied this way: an Occurrence's Step
 * Completion is its own (ADR-0002), so replacing the array wholesale would reset every tick — the
 * option the ADR rejects. It is propagated instead by `reconcileSteps` in `checklistSteps.ts`,
 * which carries each Step's completion across by identity. `SERIES_CONTENT_RECONCILED` names the
 * exception so it cannot quietly grow a second member; a test asserts it is exactly `{checklist}`.
 */
export const SERIES_CONTENT_RECONCILED: ReadonlySet<keyof Task> = new Set<keyof Task>(['checklist'])

export const SERIES_CONTENT_FIELDS: ReadonlySet<keyof Task> = new Set(
  [...ownedBy('series-content')].filter((k) => !SERIES_CONTENT_RECONCILED.has(k)),
)

/**
 * Recurrence Rule fields an editor draft may carry.
 *
 * `excludedDates` is Rule-owned but deliberately absent, and the reason is a trap rather than a
 * detail: a draft is an *Occurrence*, whose own `excludedDates` is always empty, so copying it
 * from the draft onto the Series would erase every Excluded Date the Series has accumulated —
 * silently resurrecting every Occurrence the user has ever deleted. Excluded Dates are maintained
 * by `planDeleteOccurrence`, never by an edit.
 */
export const RULE_UNEDITABLE: ReadonlySet<keyof Task> = new Set<keyof Task>(['excludedDates'])

export const RULE_EDITABLE_FIELDS: ReadonlySet<keyof Task> = new Set(
  [...ownedBy('rule')].filter((k) => !RULE_UNEDITABLE.has(k)),
)

/** The values of `fields` picked off `task`, for spreading onto another row. */
export function pick(task: Task, fields: ReadonlySet<keyof Task>): Partial<Task> {
  return Object.fromEntries([...fields].map((k) => [k, task[k]]))
}
