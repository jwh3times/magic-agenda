import { dueMomentAtZone } from "../../../src/data/dueMomentCore.ts";

export interface ReminderPreference {
  accountId: string;
  timezone: string;
  leadMinutes: number;
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

/**
 * One (Account, Task) the database says to remind: a row of
 * `reminder_candidate_rows()`. Who is reminded about what is decided there
 * (#441), so the pairing must reach the planner intact. Splitting it into
 * Accounts and Tasks and re-crossing them by Board reminds every member about
 * every Task on a shared Board.
 */
export interface ReminderPairing {
  preference: ReminderPreference;
  task: ReminderTask;
}

const SCHEDULER_INTERVAL_MS = 5 * 60_000;

export function pairingKey(accountId: string, taskId: string): string {
  return `${accountId}|${taskId}`;
}

export function candidateKey(candidate: ReminderCandidate): string {
  return `${candidate.accountId}|${candidate.taskId}|${candidate.dueMomentMs}`;
}

/** New Reminder windows open at lead time and close immediately after the Due Moment. */
export function planReminderCandidates(
  pairings: readonly ReminderPairing[],
  nowMs: number,
): ReminderCandidate[] {
  const candidates = new Map<string, ReminderCandidate>();
  for (const { preference, task } of pairings) {
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
      boardId: task.boardId,
      taskId: task.id,
      taskTitle: task.title,
      timezone: preference.timezone,
      leadMinutes: preference.leadMinutes,
      dueMomentMs: due.instantMs,
      windowOpensMs,
    };
    candidates.set(candidateKey(candidate), candidate);
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
