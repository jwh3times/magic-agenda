import type { Task, WorkflowStatus } from '../types/task'

export interface FilterQuery {
  text: string
  /** A Label id, all Labels, or the first-class null assignment. */
  labelId: string
  status: WorkflowStatus | 'all'
  pinned: boolean
  /**
   * "Assigned to me" (#440): the viewer's account id, or null for everyone's Tasks. The id is
   * passed in rather than read here, so this stays a pure function of its arguments.
   */
  assignedTo: string | null
}

export const EMPTY_FILTER: FilterQuery = {
  text: '',
  labelId: 'all',
  status: 'all',
  pinned: false,
  assignedTo: null,
}

export function isFilterActive(q: FilterQuery): boolean {
  return (
    q.text.trim() !== '' ||
    q.labelId !== 'all' ||
    q.status !== 'all' ||
    q.pinned ||
    q.assignedTo !== null
  )
}

/** Pure client-side filter by text, optional Label, status, pinned, and assignee. Facets AND together. */
export function applyFilters(tasks: Task[], q: FilterQuery): Task[] {
  const text = q.text.trim().toLowerCase()
  return tasks.filter((t) => {
    if (q.pinned && !t.pinned) return false
    if (q.assignedTo !== null && t.assigneeId !== q.assignedTo) return false
    if (q.labelId === 'unlabeled' && t.labelId !== null) return false
    if (q.labelId !== 'all' && q.labelId !== 'unlabeled' && t.labelId !== q.labelId) return false
    if (q.status !== 'all' && t.status !== q.status) return false
    if (text && !`${t.title} ${t.description}`.toLowerCase().includes(text)) return false
    return true
  })
}
