import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { removeBoardAttachments } from "../_shared/attachments.ts";

/**
 * The service-role client, behind a factory so `Admin` below is *exactly* its type.
 *
 * `ReturnType<typeof createClient>` is not the same thing: called with no explicit generics in a
 * type position it resolves its defaults differently than the same call does in a value position,
 * and the two are not assignable to each other. Deriving the alias from this function keeps them
 * in step.
 */
function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
}
type Admin = ReturnType<typeof adminClient>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Deletes the CALLING user's auth account. The service-role client is created
 * only after the caller's JWT is verified, and only ever deletes the verified
 * caller's own id.
 *
 * The content goes with it, but not by a foreign key from `auth.users` any more:
 * `handle_account_deletion` (20260813210400_account_deletion.sql) runs before the
 * delete, ends the account's Memberships and drops its Private Boards, and
 * `tasks.board_id`'s own cascade takes the Tasks and Labels from there. The old
 * `tasks.user_id` cascade named in this docstring stopped being the mechanism at
 * the authorization cutover, and the column itself is gone.
 *
 * Attachment objects are swept BEFORE `deleteUser` (#399), and the order is
 * forced rather than tidy. The trigger drops the Private Boards from inside the
 * delete, and once a Board row is gone no membership matches the object path's
 * prefix -- so the files would be unreachable and undeletable, permanently. This
 * is also the only place the account half can be done: there is no client loop
 * here to orchestrate it.
 *
 * The Boards swept are exactly the ones the trigger will delete -- a current
 * Membership for this account, and exactly one current Membership in total. A
 * Shared Board that keeps another Owner survives, so its files must too.
 *
 * **The sole-Owner refusal is checked FIRST, and that order prevents data loss.**
 * The trigger refuses the whole deletion when the account is the sole Owner of a
 * Board somebody else is still on. Checked only there, the sweep would already
 * have deleted the private Boards' files, and the refusal would leave the account
 * alive with its Boards intact and their attachments gone. So the handler asks
 * `account_deletion_plan` up front and answers 409 `sole-owner` before touching
 * anything; the trigger stays the authority for a request that races this check.
 *
 * **Through a command, never the tables (#447).** The Board tables grant
 * `service_role` nothing, so this handler's old direct reads of
 * `board_memberships` were 42501 on any database without legacy default
 * privileges. `account_deletion_plan` (`service_role` only) mirrors the
 * trigger's three cases, and `tests/rls/deletion_commands.test.ts` checks the two
 * agree.
 */
export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const admin = adminClient();
  let plan: DeletionPlan;
  try {
    plan = await deletionPlan(admin, user.id);
  } catch (cause) {
    console.error("delete-account: deletion plan failed", cause);
    return json({ error: "Deletion failed" }, 500);
  }
  if (plan.soleOwnedShared > 0) {
    return json({ error: "sole-owner", boards: plan.soleOwnedShared }, 409);
  }

  // Sweep first, and abort the whole deletion if it fails. Leaving the account intact is the
  // recoverable outcome: the user can retry. Deleting the account with files stranded is not.
  try {
    await removeBoardAttachments(admin, plan.privateBoardIds);
  } catch (cause) {
    console.error("delete-account: attachment sweep failed", cause);
    return json({ error: "Deletion failed" }, 500);
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    // Irreversible endpoint: keep a server-side trail (function logs) while the
    // client only ever sees the generic message.
    console.error("delete-account: deleteUser failed", error);
    return json({ error: "Deletion failed" }, 500);
  }
  return json({ ok: true });
}

/** What deleting this account would do, as the handler needs it. */
export interface DeletionPlan {
  /** Boards the trigger will delete, whose attachment objects must be swept first. */
  privateBoardIds: string[];
  /** Boards whose sole Owner this account is while others remain; any at all refuses. */
  soleOwnedShared: number;
}

type PlanRow = { board_id: string; disposition: string };

/**
 * Folds `account_deletion_plan` rows into what the handler acts on. An unrecognized disposition
 * counts as blocking rather than ignored: a trigger that grew a new refusal case must not be
 * answered by sweeping files first.
 */
export function summarizePlan(rows: readonly PlanRow[]): DeletionPlan {
  const plan: DeletionPlan = { privateBoardIds: [], soleOwnedShared: 0 };
  for (const row of rows) {
    if (row.disposition === "private") plan.privateBoardIds.push(row.board_id);
    else if (row.disposition !== "shared") plan.soleOwnedShared += 1;
  }
  return plan;
}

async function deletionPlan(
  admin: Admin,
  accountId: string,
): Promise<DeletionPlan> {
  const { data, error } = await admin.rpc("account_deletion_plan", {
    p_account_id: accountId,
  });
  if (error) throw new Error(`account_deletion_plan: ${error.message}`);
  // Untyped client (no generated Database generic), so the rows are asserted here.
  return summarizePlan((data ?? []) as PlanRow[]);
}
