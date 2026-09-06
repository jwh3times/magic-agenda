import { supabase } from '../lib/supabase'
import type { Database } from '../types/database.types'

type TaskRow = Database['public']['Tables']['tasks']['Row']
const PAGE_SIZE = 1000

/**
 * Return a complete Board or an error, never a successful partial result. Exact counts keep a
 * lower server cap from looking like the last page. Stable id ordering and duplicate/count checks
 * catch pagination drift; separate requests are still not a transactional snapshot.
 */
export async function loadBoardTasks(boardId: string) {
  const rows: TaskRow[] = []
  const ids = new Set<string>()
  let expectedCount: number | null = null
  const incomplete = () => ({
    data: null,
    error: { message: 'Could not load the complete Board. Please reload and try again.' },
    status: 409,
  })
  if (!boardId) return incomplete()

  for (;;) {
    const response = await supabase
      .from('tasks')
      .select('*', { count: 'exact' })
      .eq('board_id', boardId)
      .order('id', { ascending: true })
      .range(rows.length, rows.length + PAGE_SIZE - 1)
    const { data, error, count, status } = response
    if (error) return { data: null, error, status }
    if (count === null || data === null) return incomplete()
    expectedCount ??= count
    if (count !== expectedCount) return incomplete()
    for (const row of data) {
      if (ids.has(row.id)) return incomplete()
      ids.add(row.id)
      rows.push(row)
    }
    if (rows.length === expectedCount) return { data: rows, error: null, status }
    if (rows.length > expectedCount || data.length === 0) return incomplete()
  }
}
