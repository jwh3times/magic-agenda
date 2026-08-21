import {
  asTask,
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

/**
 * DB row -> app Task: NULL day becomes the inbox sentinel, done is derived, order_index -> order.
 *
 * `asTask` picks which of the three shapes the row describes, so this is where a flat row becomes a
 * narrowed `StandaloneTask`, `SeriesDefinition`, or `Occurrence` and nothing downstream has to
 * re-derive it.
 */
export function rowToTask(row: TaskRow): Task {
  return asTask({
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
    excludedDates: Array.isArray(row.recur_skip) ? (row.recur_skip as string[]) : [],
    occurrenceDate: row.recur_origin_day,
  })
}

/** app Task -> DB insert/update: inbox sentinel becomes NULL, order -> order_index, done is not stored. */
/**
 * `board_id` is the authorization boundary, and now the only ownership column written.
 *
 * `user_id`, `category`, and `label_assignment_explicit` all left this payload with the Category
 * compatibility layer. The flag mattered more than it looks: it existed so the bridge could tell
 * "a stale client omitted `label_id`" from "this client chose Unlabeled", and the trigger was
 * dropped in the same migration precisely because omitting the flag makes it default to `false` —
 * which the bridge would have read as the stale case and used to assign the Work Label to every
 * Unlabeled Task.
 *
 * `user_id` came out one release later than the other two, and the asymmetry is worth remembering
 * rather than tidying away: it was `NOT NULL` with no default, and `Deploy Migrations` races the
 * Cloudflare Pages build on every merge — so a client that stopped sending it could reach users
 * before the migration relaxed it. E2E proved that rather than predicting it. The other two had
 * column defaults, so omitting them was valid on both sides of their migration.
 *
 * `user_id` has not been an authorization input since the v1.2.78 cutover; attribution lives in
 * `author_id` / `last_editor_id`. The column itself is dropped in #197.
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
    recur_skip: task.excludedDates,
    recur_origin_day: task.occurrenceDate,
  }
}
