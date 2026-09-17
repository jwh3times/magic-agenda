import { dueMomentAtZone } from "../../../src/data/dueMomentCore.ts";

export interface ReminderPreference {
  accountId: string;
  timezone: string;
  leadMinutes: number;
}

export interface CurrentMembership {
  accountId: string;
  boardId: string;
}

export interface ReminderTask {
  id: string;
  boardId: string;
  title: string;
  day: string | null;
  atTime: string | null;
  status: string;
  recurFreq: string;
  recurParentId: string | null;
  updatedAtMs: number;
}

export interface ReminderCandidate {
  accountId: string;
  boardId: string;
  taskId: string;
  taskTitle: string;
  timezone: string;
  leadMinutes: number;
  dueMomentMs: number;
  windowOpensMs: number;
}

export interface CandidateInputs {
  preferences: readonly ReminderPreference[];
  memberships: readonly CurrentMembership[];
  tasks: readonly ReminderTask[];
}

const SCHEDULER_INTERVAL_MS = 5 * 60_000;

export function candidateKey(candidate: ReminderCandidate): string {
  return `${candidate.accountId}|${candidate.taskId}|${candidate.dueMomentMs}`;
}

/** New Reminder windows open at lead time and close immediately after the Due Moment. */
export function planReminderCandidates(
  inputs: CandidateInputs,
  nowMs: number,
): ReminderCandidate[] {
  const tasksByBoard = new Map<string, ReminderTask[]>();
  for (const task of inputs.tasks) {
    const list = tasksByBoard.get(task.boardId) ?? [];
    list.push(task);
    tasksByBoard.set(task.boardId, list);
  }
  const boardsByAccount = new Map<string, Set<string>>();
  for (const membership of inputs.memberships) {
    const boards = boardsByAccount.get(membership.accountId) ??
      new Set<string>();
    boards.add(membership.boardId);
    boardsByAccount.set(membership.accountId, boards);
  }

  const candidates = new Map<string, ReminderCandidate>();
  for (const preference of inputs.preferences) {
    for (const boardId of boardsByAccount.get(preference.accountId) ?? []) {
      for (const task of tasksByBoard.get(boardId) ?? []) {
        if (!task.day || task.status === "done") continue;
        if (task.recurFreq !== "none" && task.recurParentId === null) continue;
        const due = dueMomentAtZone(task.day, task.atTime, preference.timezone);
        if (!due) continue;
        const windowOpensMs = due.instantMs - preference.leadMinutes * 60_000;
        // A zero-lead Reminder cannot be observed before its Due Moment. The five-minute scheduler
        // therefore gets one interval of grace, while updatedAt prevents a Task created, moved, or
        // reopened after its Due Moment from replaying a missed Reminder.
        const windowClosesMs = due.instantMs +
          (preference.leadMinutes === 0 ? SCHEDULER_INTERVAL_MS : 0);
        if (nowMs < windowOpensMs || nowMs > windowClosesMs) continue;
        if (nowMs > due.instantMs && task.updatedAtMs > due.instantMs) continue;
        const candidate: ReminderCandidate = {
          accountId: preference.accountId,
          boardId,
          taskId: task.id,
          taskTitle: task.title,
          timezone: preference.timezone,
          leadMinutes: preference.leadMinutes,
          dueMomentMs: due.instantMs,
          windowOpensMs,
        };
        candidates.set(candidateKey(candidate), candidate);
      }
    }
  }
  return [...candidates.values()];
}

export function notificationTitle(leadMinutes: number): string {
  if (leadMinutes === 0) return "Task due now";
  if (leadMinutes === 60) return "Task due in 1 hour";
  if (leadMinutes === 120) return "Task due in 2 hours";
  if (leadMinutes === 1440) return "Task due in 1 day";
  return `Task due in ${leadMinutes} minutes`;
}
