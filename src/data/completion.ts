import type { ActiveWorkflowStatus, WorkflowStatus } from '../types/task'

export interface CompletionState {
  status: WorkflowStatus
  completedAt: string | null
  reopenStatus: ActiveWorkflowStatus | null
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
        ? (current.reopenStatus ?? 'todo')
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
    const reopenStatus =
      current.status === 'completed' ? (current.reopenStatus ?? 'todo') : current.status
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
