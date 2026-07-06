import type { Category, Status, Task } from '../types/task'

export interface FilterQuery {
  text: string
  category: Category | 'all'
  status: Status | 'all'
  pinned: boolean
}

export const EMPTY_FILTER: FilterQuery = { text: '', category: 'all', status: 'all', pinned: false }

export function isFilterActive(q: FilterQuery): boolean {
  return q.text.trim() !== '' || q.category !== 'all' || q.status !== 'all' || q.pinned
}

/** Pure client-side filter by text (title/description), category, status, and pinned. Facets AND together. */
export function applyFilters(tasks: Task[], q: FilterQuery): Task[] {
  const text = q.text.trim().toLowerCase()
  return tasks.filter((t) => {
    if (q.pinned && !t.pinned) return false
    if (q.category !== 'all' && t.category !== q.category) return false
    if (q.status !== 'all' && t.status !== q.status) return false
    if (text && !`${t.title} ${t.description}`.toLowerCase().includes(text)) return false
    return true
  })
}
