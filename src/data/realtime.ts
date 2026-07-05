import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { isTemplate, type Task } from '../types/task'
import { instanceOrigin } from './recurrence'
import { rowToTask } from './mappers'
import type { Database } from '../types/database.types'

type TaskRow = Database['public']['Tables']['tasks']['Row']

export interface BoardState {
  /** Board tasks (non-recurring + materialized instances). */
  tasks: Task[]
  /** Hidden recurrence templates (the useTasks templatesRef contents). */
  templates: Task[]
}

export type TaskChange =
  { type: 'INSERT'; task: Task } | { type: 'UPDATE'; task: Task } | { type: 'DELETE'; id: string }

/** Normalize a realtime payload into a TaskChange, or null for unusable payloads. */
export function payloadToChange(p: RealtimePostgresChangesPayload<TaskRow>): TaskChange | null {
  if (p.eventType === 'DELETE') {
    // DELETE events carry only the replica identity (the primary key).
    const id = (p.old as Partial<TaskRow>).id
    return id ? { type: 'DELETE', id } : null
  }
  if (p.eventType === 'INSERT' || p.eventType === 'UPDATE') {
    // Same defensiveness as the DELETE branch: a partial/nullish row (publication
    // anomaly, misbehaving client) must be dropped, not mapped into a garbage Task.
    const row = p.new as Partial<TaskRow> | null
    if (!row || typeof row.id !== 'string') return null
    return { type: p.eventType, task: rowToTask(row as TaskRow) }
  }
  return null
}

// Key-order-sensitive by design: every Task here is built by rowToTask (fixed key
// order) or object spread of one, so serializations are comparable. Worst case for
// a divergent constructor is a false NEGATIVE (one redundant re-render) — never a
// skipped real update.
const sameTask = (a: Task, b: Task) => JSON.stringify(a) === JSON.stringify(b)

/** The occurrence an instance covers — mirrors the (recur_parent_id, recur_origin_day) index. */
const instanceKey = (t: Task) => `${t.recurParentId}|${instanceOrigin(t)}`

/**
 * Apply one remote change to local board state. Pure. Returns the SAME state
 * object when the change is a no-op so callers can cheaply skip re-renders
 * (DELETE events for other users' rows arrive unfiltered and must cost nothing).
 */
export function applyTaskChange(state: BoardState, change: TaskChange): BoardState {
  if (change.type === 'DELETE') {
    if (state.templates.some((t) => t.id === change.id)) {
      // Template deletes cascade to instances server-side; drop them locally now —
      // the instances' own DELETE echoes then no-op here.
      return {
        tasks: state.tasks.filter((t) => t.recurParentId !== change.id),
        templates: state.templates.filter((t) => t.id !== change.id),
      }
    }
    if (!state.tasks.some((t) => t.id === change.id)) return state
    return { ...state, tasks: state.tasks.filter((t) => t.id !== change.id) }
  }

  const task = change.task

  if (isTemplate(task)) {
    // A template row never renders on the board; a task edited into a series
    // also moves out of the board list (mirrors the useTasks updateTask branch).
    const existing = state.templates.find((t) => t.id === task.id)
    const wasBoardTask = state.tasks.some((t) => t.id === task.id)
    if (existing && !wasBoardTask && sameTask(existing, task)) return state
    return {
      tasks: wasBoardTask ? state.tasks.filter((t) => t.id !== task.id) : state.tasks,
      templates: existing
        ? state.templates.map((t) => (t.id === task.id ? task : t))
        : [...state.templates, task],
    }
  }

  const wasTemplate = state.templates.some((t) => t.id === task.id)
  const templates = wasTemplate ? state.templates.filter((t) => t.id !== task.id) : state.templates

  const existing = state.tasks.find((t) => t.id === task.id)
  if (existing) {
    if (!wasTemplate && sameTask(existing, task)) return state
    return { templates, tasks: state.tasks.map((t) => (t.id === task.id ? task : t)) }
  }

  // New row. Another device may have materialized the same occurrence we hold
  // locally under a different id — the committed event wins (the unique index
  // rejects the loser server-side).
  if (task.recurParentId) {
    const key = instanceKey(task)
    const dupe = state.tasks.find((t) => t.recurParentId && instanceKey(t) === key)
    if (dupe) {
      return { templates, tasks: state.tasks.map((t) => (t.id === dupe.id ? task : t)) }
    }
  }
  return { templates, tasks: [...state.tasks, task] }
}
