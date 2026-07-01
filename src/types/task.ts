export type Category = 'work' | 'personal' | 'errands' | 'ideas' | 'health'
export type Color = 'yellow' | 'pink' | 'blue' | 'mint' | 'lilac' | 'orange'
export type Status = 'todo' | 'doing' | 'done'
export type RecurFreq = 'none' | 'daily' | 'weekly' | 'monthly'
export type ThemeName = 'cork' | 'brutal' | 'glass'
export type ViewName = 'calendar' | 'week' | 'agenda' | 'kanban'

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface Task {
  id: string
  title: string
  description: string
  category: Category
  color: Color
  checklist: ChecklistItem[]
  status: Status
  /** Derived from status === 'done'; kept on the object for parity with the prototype. */
  done: boolean
  /**
   * App-level day sentinel: the literal 'inbox' (unscheduled) or a 'YYYY-MM-DD' date.
   * Maps to NULL at the database boundary (see data/mappers.ts in Phase 8).
   */
  day: string
  /** Order within a day (calendar/week views). */
  order: number
  /** Order within a status column (kanban view). */
  korder: number

  // Recurrence. A template carries recurFreq != 'none' and recurParentId === null and is hidden
  // from the board; its materialized instances carry recurFreq 'none' and recurParentId = template id.
  recurFreq: RecurFreq
  recurInterval: number
  recurUntil: string | null
  recurParentId: string | null
  /** Dates (YYYY-MM-DD) of deleted occurrences — never regenerated (templates only). */
  recurSkip: string[]
  /**
   * The occurrence date (YYYY-MM-DD) this instance was materialized for. Immutable across drags —
   * unlike `day`, which the user can move — so materialization identifies covered occurrences by
   * origin and never resurrects a duplicate on the origin day. NULL for templates and
   * non-recurring tasks (and legacy instances that predate this field).
   */
  recurOriginDay: string | null
}

/** The sentinel used throughout app + dnd logic for an unscheduled task. */
export const INBOX = 'inbox'

/** Default (non-recurring) recurrence fields — spread into task constructors. */
export const NO_RECUR = {
  recurFreq: 'none' as RecurFreq,
  recurInterval: 1,
  recurUntil: null as string | null,
  recurParentId: null as string | null,
  recurSkip: [] as string[],
  recurOriginDay: null as string | null,
}

/** A task is a hidden recurrence template when it bears a rule and has no parent. */
export function isTemplate(t: Pick<Task, 'recurFreq' | 'recurParentId'>): boolean {
  return t.recurFreq !== 'none' && !t.recurParentId
}
