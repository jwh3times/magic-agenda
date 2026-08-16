import type { Status, Task } from '../types/task'

export interface FilterQuery {
  text: string
  /** A Label id, all Labels, or the first-class null assignment. */
  labelId: string
  status: Status | 'all'
  pinned: boolean
}

export const EMPTY_FILTER: FilterQuery = { text: '', labelId: 'all', status: 'all', pinned: false }

export function isFilterActive(q: FilterQuery): boolean {
  return q.text.trim() !== '' || q.labelId !== 'all' || q.status !== 'all' || q.pinned
}

/** Pure client-side filter by text, optional Label, status, and pinned. Facets AND together. */
export function applyFilters(tasks: Task[], q: FilterQuery): Task[] {
  const text = q.text.trim().toLowerCase()
  return tasks.filter((t) => {
    if (q.pinned && !t.pinned) return false
    if (q.labelId === 'unlabeled' && t.labelId !== null) return false
    if (q.labelId !== 'all' && q.labelId !== 'unlabeled' && t.labelId !== q.labelId) return false
    if (q.status !== 'all' && t.status !== q.status) return false
    if (text && !`${t.title} ${t.description}`.toLowerCase().includes(text)) return false
    return true
  })
}
