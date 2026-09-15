import {
  candidateKey,
  notificationTitle,
  type ReminderCandidate,
} from "./domain.ts";

export interface DeliveryClaim {
  id: string;
  candidate: ReminderCandidate;
}

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  authSecret: string;
}

export interface TargetClaim {
  id: string;
  subscription: PushSubscriptionRow;
  attemptCount: number;
}

export type Recheck = "eligible" | "completed" | "rescheduled" | "ineligible";

export interface ReminderStore {
  candidates(nowMs: number): Promise<ReminderCandidate[]>;
  claimDelivery(
    candidate: ReminderCandidate,
    token: string,
    nowMs: number,
  ): Promise<DeliveryClaim | null>;
  recheck(claim: DeliveryClaim, nowMs: number): Promise<Recheck>;
  suppress(
    claim: DeliveryClaim,
    token: string,
    reason: Exclude<Recheck, "eligible">,
    nowMs: number,
  ): Promise<void>;
  subscriptions(accountId: string): Promise<PushSubscriptionRow[]>;
  ensureTargets(
    claim: DeliveryClaim,
    subscriptions: PushSubscriptionRow[],
    nowMs: number,
  ): Promise<boolean>;
  claimTargets(
    claim: DeliveryClaim,
    token: string,
    nowMs: number,
  ): Promise<TargetClaim[]>;
  targetSucceeded(
    target: TargetClaim,
    token: string,
    nowMs: number,
  ): Promise<void>;
  targetRetry(
    target: TargetClaim,
    token: string,
    status: number | null,
    message: string,
    nowMs: number,
  ): Promise<void>;
  targetDead(
    target: TargetClaim,
    token: string,
    status: number,
    nowMs: number,
  ): Promise<void>;
  deleteSubscription(subscriptionId: string): Promise<void>;
  finalize(claim: DeliveryClaim, token: string, nowMs: number): Promise<void>;
  release(claim: DeliveryClaim, token: string): Promise<void>;
}

export interface PushTransport {
  send(
    subscription: PushSubscriptionRow,
    payload: string,
    topic: string,
  ): Promise<void>;
}

export class PushFailure extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

function topic(candidate: ReminderCandidate): string {
  const bytes = new TextEncoder().encode(candidateKey(candidate));
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return `ma-${(hash >>> 0).toString(36)}`;
}

export async function runReminderSender(
  store: ReminderStore,
  push: PushTransport,
  nowMs = Date.now(),
): Promise<
  { candidates: number; delivered: number; retried: number; dead: number }
> {
  const candidates = await store.candidates(nowMs);
  let delivered = 0;
  let retried = 0;
  let dead = 0;
  for (const candidate of candidates) {
    const token = crypto.randomUUID();
    const claim = await store.claimDelivery(candidate, token, nowMs);
    if (!claim) continue;
    const current = await store.recheck(claim, nowMs);
    if (current !== "eligible") {
      await store.suppress(claim, token, current, nowMs);
      continue;
    }
    const subscriptions = await store.subscriptions(candidate.accountId);
    const hasTargets = await store.ensureTargets(claim, subscriptions, nowMs);
    if (!hasTargets) {
      await store.release(claim, token);
      continue;
    }
    const targets = await store.claimTargets(claim, token, nowMs);
    const payload = JSON.stringify({
      title: notificationTitle(candidate.leadMinutes),
      body: candidate.taskTitle || "A scheduled task",
      url: `/?board=${encodeURIComponent(candidate.boardId)}`,
      tag: `reminder-${claim.id}`,
    });
    for (const target of targets) {
      try {
        await push.send(target.subscription, payload, topic(candidate));
        await store.targetSucceeded(target, token, nowMs);
        delivered++;
      } catch (error) {
        const failure = error instanceof PushFailure
          ? error
          : new PushFailure(String(error), null);
        if (failure.status === 404 || failure.status === 410) {
          await store.targetDead(target, token, failure.status, nowMs);
          await store.deleteSubscription(target.subscription.id);
          dead++;
        } else {
          await store.targetRetry(
            target,
            token,
            failure.status,
            failure.message,
            nowMs,
          );
          retried++;
        }
      }
    }
    await store.finalize(claim, token, nowMs);
  }
  return { candidates: candidates.length, delivered, retried, dead };
}
