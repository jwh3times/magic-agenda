import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import type { Label } from '../types/label'

type LabelRow = Database['public']['Tables']['labels']['Row']

/**
 * Remote Label changes, normalized and applied purely.
 *
 * Same split as `src/data/realtime.ts` does for tasks, and for the same reason: the decision about
 * what a payload *means* and what the vocabulary *becomes* is testable without a socket, while
 * `useLabels` keeps only the subscription and the state.
 */

export type LabelChange = { type: 'UPSERT'; label: Label } | { type: 'DELETE'; id: string }

const toLabel = (row: LabelRow): Label => ({
  id: row.id,
  boardId: row.board_id,
  name: row.name,
  dotColor: row.dot_color,
  position: row.position,
})

/**
 * Normalize a payload into a change, or null when it is unusable.
 *
 * INSERT and UPDATE collapse into one `UPSERT` case deliberately. The reducer has to be idempotent
 * regardless — a reconnect replays a reload over whatever arrived during the outage — so branching
 * on which of the two it was would create a distinction with no consequence and one more path to
 * get wrong.
 */
export function payloadToLabelChange(
  payload: RealtimePostgresChangesPayload<LabelRow>,
): LabelChange | null {
  if (payload.eventType === 'DELETE') {
    // A DELETE payload carries only the replica identity — the primary key — so there is no row to
    // rebuild here, only an id to remove.
    const id = (payload.old as Partial<LabelRow> | null)?.id
    return id ? { type: 'DELETE', id } : null
  }
  const row = payload.new as Partial<LabelRow> | null
  if (!row?.id || !row.board_id || typeof row.name !== 'string') return null
  return { type: 'UPSERT', label: toLabel(row as LabelRow) }
}

const byPosition = (a: Label, b: Label) => a.position - b.position || a.id.localeCompare(b.id)

/**
 * The vocabulary after one remote change.
 *
 * Always re-sorted, because a remote reorder arrives as several independent UPDATEs and the list
 * would otherwise render in arrival order between them. Ties break by id so a transient duplicate
 * position — legal, since nothing constrains `(board_id, position)` — still produces a stable
 * order rather than one that flickers as the rest of the batch lands.
 */
export function applyLabelChange(labels: readonly Label[], change: LabelChange): Label[] {
  if (change.type === 'DELETE') {
    return labels.filter((l) => l.id !== change.id)
  }
  const without = labels.filter((l) => l.id !== change.label.id)
  return [...without, change.label].sort(byPosition)
}
