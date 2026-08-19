import {
  INBOX,
  type ChecklistItem,
  type Color,
  type RecurFreq,
  type Status,
  type Task,
} from '../types/task'
import { isScheduled } from '../lib/dates'
import type { Database, Json } from '../types/database.types'

type TaskRow = Database['public']['Tables']['tasks']['Row']
type TaskInsert = Database['public']['Tables']['tasks']['Insert']

/** Coerce the stored JSON checklist into validated ChecklistItem[], dropping malformed entries. */
export function parseChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return []
  const out: ChecklistItem[] = []
  for (const v of value) {
    if (v && typeof v === 'object' && 'id' in v && 'text' in v) {
      const o = v as Record<string, unknown>
      out.push({ id: String(o.id), text: String(o.text), done: Boolean(o.done) })
    }
  }
  return out
}

/** DB row -> app Task: NULL day becomes the inbox sentinel, done is derived, order_index -> order. */
export function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    labelId: row.label_id,
    color: row.color as Color,
    checklist: parseChecklist(row.checklist),
    status: row.status as Status,
    done: row.status === 'done',
    day: row.day ?? INBOX,
    atTime: row.at_time ? row.at_time.slice(0, 5) : null,
    pinned: row.pinned ?? false,
    order: row.order_index,
    korder: row.korder,
    recurFreq: row.recur_freq as RecurFreq,
    recurInterval: row.recur_interval,
    recurUntil: row.recur_until,
    recurParentId: row.recur_parent_id,
    recurSkip: Array.isArray(row.recur_skip) ? (row.recur_skip as string[]) : [],
    recurOriginDay: row.recur_origin_day,
  }
}

/** app Task -> DB insert/update: inbox sentinel becomes NULL, order -> order_index, done is not stored. */
/**
 * `board_id` is the authorization boundary, and now the only ownership column written.
 *
 * `user_id` and `label_assignment_explicit` were both dropped from this payload when the
 * compatibility layer was retired. The second one mattered more than it looks: it existed so the
 * Category bridge could tell "a stale client omitted `label_id`" from "this client chose
 * Unlabeled", and the bridge trigger was dropped in the same migration precisely because omitting
 * the flag makes it default to `false` — which that trigger would have read as the stale case and
 * used to assign the Work Label to every Unlabeled Task.
 */
export function taskToRow(task: Task, boardId: string): TaskInsert {
  return {
    id: task.id,
    board_id: boardId,
    title: task.title,
    description: task.description,
    label_id: task.labelId,
    color: task.color,
    checklist: task.checklist as unknown as Json,
    status: task.status,
    day: isScheduled(task.day) ? task.day : null,
    at_time: task.atTime,
    pinned: task.pinned,
    order_index: task.order,
    korder: task.korder,
    recur_freq: task.recurFreq,
    recur_interval: task.recurInterval,
    recur_until: task.recurUntil,
    recur_parent_id: task.recurParentId,
    recur_skip: task.recurSkip,
    recur_origin_day: task.recurOriginDay,
  }
}
