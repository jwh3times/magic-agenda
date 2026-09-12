import type { ActiveWorkflowStatus, WorkflowStatus } from '../types/task'

export interface CompletionState {
  status: WorkflowStatus
  completedAt: string | null
  reopenStatus: ActiveWorkflowStatus
  archivedAt: string | null
}

export type CompletionRequest = WorkflowStatus | 'toggle'

/**
 * Decide the complete/reopen half of a Task mutation.
 *
 * Every interaction crosses this seam: the card's quick action passes `toggle`, while the editor
 * and Kanban drag pass an explicit Workflow Status. The caller supplies `now`, keeping the module
 * pure and making one Completion timestamp travel with the rest of the Task in a single write.
 */
export function completionDecision(
  current: CompletionState,
  request: CompletionRequest,
  now: string,
): CompletionState {
  const target =
    request === 'toggle'
      ? current.status === 'completed'
        ? current.reopenStatus
        : 'completed'
      : request

  if (target === current.status) {
    return {
      status: current.status,
      completedAt: current.completedAt,
      reopenStatus: current.reopenStatus,
      archivedAt: current.archivedAt,
    }
  }

  if (target === 'completed') {
    const reopenStatus = current.status === 'completed' ? current.reopenStatus : current.status
    return {
      status: 'completed',
      completedAt: now,
      reopenStatus,
      archivedAt: null,
    }
  }

  return {
    status: target,
    completedAt: null,
    reopenStatus: target,
    archivedAt: null,
  }
}

export type ArchiveRequest = 'archive' | 'unarchive'

/**
 * Decide the archive/unarchive half of a Task mutation.
 *
 * Separate from `completionDecision` because Archive is its own transition rather than a Workflow
 * Status change (ADR-0003): Unarchiving returns a Task to the active Board *still Completed*, with
 * its Completed At untouched, so routing it through the completion seam would have to invent a
 * "change nothing about Completion" request. Reopening an Archived Task is the one operation that
 * spans both, and it stays a `completionDecision` — that function already clears Archive.
 *
 * Archiving a Task that is not Completed returns the state unchanged. The database refuses it
 * outright via `tasks_archived_at_requires_completed`, so this is the affordance layer agreeing
 * with the boundary rather than enforcing anything; callers gate the control as well.
 *
 * The supplied `now` is a guess in the same sense the Completion timestamp is: the lifecycle
 * trigger stamps the *first* Archive itself and preserves it across later writes, so a caller that
 * needs the authoritative value reads back the returned row.
 */
export function archiveDecision(
  current: CompletionState,
  request: ArchiveRequest,
  now: string,
): CompletionState {
  if (request === 'unarchive') return { ...current, archivedAt: null }
  if (current.status !== 'completed') return { ...current }
  // An already-Archived Task keeps its original instant, matching what the trigger would do.
  return { ...current, archivedAt: current.archivedAt ?? now }
}

/** Whether a Task is currently Archived, and so absent from every ordinary Board view. */
export function isArchived(task: Pick<CompletionState, 'archivedAt'>): boolean {
  return task.archivedAt !== null
}
