import type { ChecklistItem, TaskDraft } from '../types/task'

export const TASK_LIMITS = {
  title: 500,
  description: 20_000,
  checklistItems: 200,
  checklistBytes: 65_536,
  recurInterval: 366,
} as const

/** Match jsonb::text spacing for the three fields persisted by cleanDraft. Key order changes
 * byte order but not size. The RLS suite compares this calculation with PostgreSQL directly. */
export function checklistBytes(items: ChecklistItem[]): number {
  const json = `[${items
    .map(
      ({ id, text, done }) =>
        `{"id": ${JSON.stringify(id)}, "text": ${JSON.stringify(text)}, "done": ${JSON.stringify(done)}}`,
    )
    .join(', ')}]`
  return new TextEncoder().encode(json).length
}

/** Editor feedback mirrors the database constraints, including drafts loaded from old caches. */
export function taskLimitError(task: TaskDraft): string | null {
  if (Array.from(task.title).length > TASK_LIMITS.title)
    return 'Use at most 500 characters for the title.'
  if (Array.from(task.description).length > TASK_LIMITS.description)
    return 'Use at most 20,000 characters for the description.'
  if (task.checklist.length > TASK_LIMITS.checklistItems) return 'Use at most 200 checklist items.'
  if (checklistBytes(task.checklist) > TASK_LIMITS.checklistBytes)
    return 'Shorten the checklist: its total size must be 64 KiB or less.'
  if (
    !Number.isInteger(task.recurInterval) ||
    task.recurInterval < 1 ||
    task.recurInterval > TASK_LIMITS.recurInterval
  )
    return 'Use a repeat interval from 1 to 366.'
  return null
}
