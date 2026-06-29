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
}

/** The sentinel used throughout app + dnd logic for an unscheduled task. */
export const INBOX = 'inbox'
