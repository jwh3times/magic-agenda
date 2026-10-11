import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.116.0";
import type { Database } from "../../../src/types/database.types.ts";
import { dueMomentAtZone } from "../../../src/data/dueMomentCore.ts";
import {
  candidateKey,
  pairingKey,
  planReminderCandidates,
  type ReminderCandidate,
  type ReminderPairing,
} from "./domain.ts";
import type {
  DeliveryClaim,
  PushSubscriptionRow,
  Recheck,
  ReminderStore,
  TargetClaim,
} from "./sender.ts";

type Client = SupabaseClient<Database>;
const CLAIM_MS = 4 * 60_000;
const MAX_ATTEMPTS = 20;
const PAGE_SIZE = 1000;

function required<T>(
  data: T | null,
  error: { message: string } | null,
  operation: string,
): T {
  if (error) throw new Error(`${operation}: ${error.message}`);
  if (data === null) throw new Error(`${operation}: no row returned`);
  return data;
}

async function endpointHash(endpoint: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/u,
    "",
  );
}

export class SupabaseReminderStore implements ReminderStore {
  constructor(private readonly client: Client) {}

  /**
   * One pairing per row, keyed by (Account, Task); never regrouped.
   *
   * Every row or an error, never a successful partial answer: PostgREST caps
   * a response at `max_rows` without saying so, and a truncated answer would
   * drop Reminders and make `recheck()` suppress claims whose row was cut.
   * The exact count keeps a lower cap from looking like the last page; the
   * stable order and the count and duplicate checks catch drift between
   * pages. Separate requests are still not a transactional snapshot.
   */
  private async pairings(): Promise<Map<string, ReminderPairing>> {
    const incomplete = () =>
      new Error("load reminder candidates: incomplete answer");
    const pairings = new Map<string, ReminderPairing>();
    let expected: number | null = null;
    for (;;) {
      const result = await this.client
        .rpc("reminder_candidate_rows", undefined, { count: "exact" })
        .order("account_id", { ascending: true })
        .order("task_id", { ascending: true })
        .range(pairings.size, pairings.size + PAGE_SIZE - 1);
      if (result.error) {
        throw new Error(`load reminder candidates: ${result.error.message}`);
      }
      if (result.count === null || result.data === null) throw incomplete();
      expected ??= result.count;
      if (result.count !== expected) throw incomplete();
      for (const row of result.data) {
        const key = pairingKey(row.account_id, row.task_id);
        if (pairings.has(key)) throw incomplete();
        pairings.set(key, {
          preference: {
            accountId: row.account_id,
            timezone: row.timezone,
            leadMinutes: row.lead_minutes,
          },
          task: {
            id: row.task_id,
            boardId: row.board_id,
            title: row.task_title,
            day: row.task_day,
            atTime: row.task_at_time,
            status: row.task_status,
            recurFreq: row.recur_freq,
            recurParentId: row.recur_parent_id,
            updatedAtMs: Date.parse(row.task_updated_at),
          },
        });
      }
      if (pairings.size === expected) return pairings;
      if (pairings.size > expected || result.data.length === 0) {
        throw incomplete();
      }
    }
  }

  async candidates(nowMs: number): Promise<ReminderCandidate[]> {
    const pairings = await this.pairings();
    const candidates = new Map(
      planReminderCandidates([...pairings.values()], nowMs).map((
        candidate,
      ) => [candidateKey(candidate), candidate]),
    );

    const readyTargets = await this.client
      .from("reminder_delivery_targets")
      .select("delivery_id")
      .eq("status", "pending")
      .lte("next_attempt_at", new Date(nowMs).toISOString())
      .gt("attempt_count", 0);
    if (readyTargets.error) {
      throw new Error(`load retry targets: ${readyTargets.error.message}`);
    }
    const deliveryIds = [
      ...new Set((readyTargets.data ?? []).map((row) => row.delivery_id)),
    ];
    if (deliveryIds.length === 0) return [...candidates.values()];

    const deliveries = await this.client
      .from("reminder_deliveries")
      .select("id, account_id, task_id, due_moment, window_opens_at")
      .in("id", deliveryIds)
      .is("delivered_at", null)
      .is("suppressed_at", null);
    if (deliveries.error) {
      throw new Error(`load retry deliveries: ${deliveries.error.message}`);
    }
    for (const delivery of deliveries.data ?? []) {
      const pairing = pairings.get(
        pairingKey(delivery.account_id, delivery.task_id),
      );
      if (!pairing) continue;
      const { preference, task } = pairing;
      if (!task.day) continue;
      const due = dueMomentAtZone(task.day, task.atTime, preference.timezone);
      if (!due || due.instantMs !== Date.parse(delivery.due_moment)) continue;
      const candidate: ReminderCandidate = {
        accountId: preference.accountId,
        boardId: task.boardId,
        taskId: task.id,
        taskTitle: task.title,
        timezone: preference.timezone,
        leadMinutes: preference.leadMinutes,
        dueMomentMs: due.instantMs,
        windowOpensMs: Date.parse(delivery.window_opens_at),
      };
      candidates.set(candidateKey(candidate), candidate);
    }
    return [...candidates.values()];
  }

  async claimDelivery(
    candidate: ReminderCandidate,
    token: string,
    nowMs: number,
  ): Promise<DeliveryClaim | null> {
    const due = new Date(candidate.dueMomentMs).toISOString();
    const inserted = await this.client.from("reminder_deliveries").upsert(
      {
        account_id: candidate.accountId,
        task_id: candidate.taskId,
        due_moment: due,
        window_opens_at: new Date(candidate.windowOpensMs).toISOString(),
      },
      { onConflict: "account_id,task_id,due_moment", ignoreDuplicates: true },
    );
    if (inserted.error) {
      throw new Error(`ensure delivery: ${inserted.error.message}`);
    }
    const rowResult = await this.client
      .from("reminder_deliveries")
      .select("*")
      .eq("account_id", candidate.accountId)
      .eq("task_id", candidate.taskId)
      .eq("due_moment", due)
      .single();
    const row = required(rowResult.data, rowResult.error, "read delivery");
    if (
      row.delivered_at || (row.suppressed_at && nowMs > candidate.dueMomentMs)
    ) return null;

    const now = new Date(nowMs).toISOString();
    const claimed = await this.client
      .from("reminder_deliveries")
      .update({
        claim_token: token,
        claimed_at: now,
        claim_expires_at: new Date(nowMs + CLAIM_MS).toISOString(),
        suppressed_at: null,
        suppression_reason: null,
      })
      .eq("id", row.id)
      .is("delivered_at", null)
      .or(`claim_expires_at.is.null,claim_expires_at.lt.${now}`)
      .select("*")
      .maybeSingle();
    if (claimed.error) {
      throw new Error(`claim delivery: ${claimed.error.message}`);
    }
    return claimed.data ? { id: claimed.data.id, candidate } : null;
  }

  async recheck(claim: DeliveryClaim, _nowMs: number): Promise<Recheck> {
    const pairing = (await this.pairings()).get(
      pairingKey(claim.candidate.accountId, claim.candidate.taskId),
    );
    // No row means the database no longer pairs this Account with this Task:
    // the Task is gone or unscheduled, the Membership or the Reminder
    // preference ended, or the Task was assigned to someone else.
    if (!pairing) return "ineligible";
    const { preference, task } = pairing;
    if (task.status === "done") return "completed";
    if (
      !task.day || (task.recurFreq !== "none" && task.recurParentId === null)
    ) return "ineligible";
    const due = dueMomentAtZone(task.day, task.atTime, preference.timezone);
    return due?.instantMs === claim.candidate.dueMomentMs
      ? "eligible"
      : "rescheduled";
  }

  async suppress(
    claim: DeliveryClaim,
    token: string,
    reason: Exclude<Recheck, "eligible">,
    nowMs: number,
  ): Promise<void> {
    const result = await this.client
      .from("reminder_deliveries")
      .update({
        suppressed_at: new Date(nowMs).toISOString(),
        suppression_reason: reason,
        claim_token: null,
        claimed_at: null,
        claim_expires_at: null,
      })
      .eq("id", claim.id)
      .eq("claim_token", token);
    if (result.error) {
      throw new Error(`suppress delivery: ${result.error.message}`);
    }
  }

  async subscriptions(accountId: string): Promise<PushSubscriptionRow[]> {
    const result = await this.client
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth_secret")
      .eq("account_id", accountId);
    if (result.error) {
      throw new Error(`load subscriptions: ${result.error.message}`);
    }
    return (result.data ?? []).map((row) => ({
      id: row.id,
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      authSecret: row.auth_secret,
    }));
  }

  async ensureTargets(
    claim: DeliveryClaim,
    subscriptions: PushSubscriptionRow[],
    nowMs: number,
  ): Promise<boolean> {
    const existing = await this.client
      .from("reminder_delivery_targets")
      .select("id", { count: "exact", head: true })
      .eq("delivery_id", claim.id);
    if (existing.error) {
      throw new Error(`count delivery targets: ${existing.error.message}`);
    }
    // Snapshot the device set on the first attempt. A device enrolled during a later retry must
    // not receive an old Reminder, especially after the Due Moment has passed.
    if ((existing.count ?? 0) > 0) return true;
    if (subscriptions.length === 0) return false;
    const rows = await Promise.all(
      subscriptions.map(async (subscription) => ({
        delivery_id: claim.id,
        subscription_id: subscription.id,
        endpoint_hash: await endpointHash(subscription.endpoint),
        next_attempt_at: new Date(nowMs).toISOString(),
      })),
    );
    const result = await this.client
      .from("reminder_delivery_targets")
      .upsert(rows, {
        onConflict: "delivery_id,endpoint_hash",
        ignoreDuplicates: true,
      });
    if (result.error) {
      throw new Error(`ensure targets: ${result.error.message}`);
    }
    return true;
  }

  async claimTargets(
    claim: DeliveryClaim,
    token: string,
    nowMs: number,
  ): Promise<TargetClaim[]> {
    const now = new Date(nowMs).toISOString();
    const result = await this.client
      .from("reminder_delivery_targets")
      .select("id, subscription_id, attempt_count")
      .eq("delivery_id", claim.id)
      .eq("status", "pending")
      .lte("next_attempt_at", now);
    if (result.error) throw new Error(`load targets: ${result.error.message}`);
    const subscriptions = new Map(
      (await this.subscriptions(claim.candidate.accountId)).map((
        row,
      ) => [row.id, row]),
    );
    const claimed: TargetClaim[] = [];
    for (const target of result.data ?? []) {
      const subscription = target.subscription_id
        ? subscriptions.get(target.subscription_id)
        : undefined;
      if (!subscription) {
        const retired = await this.client
          .from("reminder_delivery_targets")
          .update({
            status: "dead",
            attempt_count: Math.min(target.attempt_count + 1, MAX_ATTEMPTS),
            claim_token: null,
            claimed_at: null,
            claim_expires_at: null,
            last_error: "Subscription was removed.",
          })
          .eq("id", target.id)
          .eq("status", "pending");
        if (retired.error) {
          throw new Error(`retire missing target: ${retired.error.message}`);
        }
        continue;
      }
      const update = await this.client
        .from("reminder_delivery_targets")
        .update({
          claim_token: token,
          claimed_at: now,
          claim_expires_at: new Date(nowMs + CLAIM_MS).toISOString(),
        })
        .eq("id", target.id)
        .eq("status", "pending")
        .or(`claim_expires_at.is.null,claim_expires_at.lt.${now}`)
        .select("id")
        .maybeSingle();
      if (update.error) {
        throw new Error(`claim target: ${update.error.message}`);
      }
      if (update.data) {
        claimed.push({
          id: target.id,
          subscription,
          attemptCount: target.attempt_count,
        });
      }
    }
    return claimed;
  }

  async targetSucceeded(
    target: TargetClaim,
    token: string,
    nowMs: number,
  ): Promise<void> {
    await this.updateTarget(target, token, {
      status: "succeeded",
      attempt_count: Math.min(target.attemptCount + 1, MAX_ATTEMPTS),
      delivered_at: new Date(nowMs).toISOString(),
      claim_token: null,
      claimed_at: null,
      claim_expires_at: null,
      last_error: null,
      last_status_code: null,
    });
  }

  async targetRetry(
    target: TargetClaim,
    token: string,
    status: number | null,
    _message: string,
    nowMs: number,
  ): Promise<void> {
    const attempt = target.attemptCount + 1;
    const exhausted = attempt >= MAX_ATTEMPTS;
    const delay = Math.min(
      6 * 60 * 60_000,
      5 * 60_000 * 2 ** Math.min(attempt - 1, 6),
    );
    await this.updateTarget(target, token, {
      status: exhausted ? "dead" : "pending",
      attempt_count: attempt,
      next_attempt_at: new Date(nowMs + delay).toISOString(),
      claim_token: null,
      claimed_at: null,
      claim_expires_at: null,
      last_status_code: status,
      // Provider errors can embed endpoints or response bodies. Persist only a bounded category;
      // the attempt/status fields contain everything needed to operate the retry queue.
      last_error: status === null
        ? "Push transport failed."
        : `Push provider returned HTTP ${status}.`,
    });
  }

  async targetDead(
    target: TargetClaim,
    token: string,
    status: number,
    _nowMs: number,
  ): Promise<void> {
    await this.updateTarget(target, token, {
      status: "dead",
      attempt_count: Math.min(target.attemptCount + 1, MAX_ATTEMPTS),
      claim_token: null,
      claimed_at: null,
      claim_expires_at: null,
      last_status_code: status,
      last_error: "Push endpoint is no longer registered.",
    });
  }

  private async updateTarget(
    target: TargetClaim,
    token: string,
    values: Database["public"]["Tables"]["reminder_delivery_targets"]["Update"],
  ): Promise<void> {
    const result = await this.client
      .from("reminder_delivery_targets")
      .update(values)
      .eq("id", target.id)
      .eq("claim_token", token);
    if (result.error) throw new Error(`update target: ${result.error.message}`);
  }

  async deleteSubscription(subscriptionId: string): Promise<void> {
    const result = await this.client.from("push_subscriptions").delete().eq(
      "id",
      subscriptionId,
    );
    if (result.error) {
      throw new Error(`delete subscription: ${result.error.message}`);
    }
  }

  async finalize(
    claim: DeliveryClaim,
    token: string,
    nowMs: number,
  ): Promise<void> {
    const pending = await this.client
      .from("reminder_delivery_targets")
      .select("id", { count: "exact", head: true })
      .eq("delivery_id", claim.id)
      .eq("status", "pending");
    if (pending.error) {
      throw new Error(`count pending targets: ${pending.error.message}`);
    }
    const result = await this.client
      .from("reminder_deliveries")
      .update({
        delivered_at: pending.count === 0
          ? new Date(nowMs).toISOString()
          : null,
        claim_token: null,
        claimed_at: null,
        claim_expires_at: null,
      })
      .eq("id", claim.id)
      .eq("claim_token", token);
    if (result.error) {
      throw new Error(`finalize delivery: ${result.error.message}`);
    }
  }

  async release(claim: DeliveryClaim, token: string): Promise<void> {
    const result = await this.client
      .from("reminder_deliveries")
      .update({ claim_token: null, claimed_at: null, claim_expires_at: null })
      .eq("id", claim.id)
      .eq("claim_token", token);
    if (result.error) {
      throw new Error(`release delivery: ${result.error.message}`);
    }
  }
}

export function productionStore(): SupabaseReminderStore {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Supabase service configuration is missing.");
  }
  return new SupabaseReminderStore(
    createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  );
}
