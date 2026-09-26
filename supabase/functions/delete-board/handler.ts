import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { removeBoardAttachments } from "../_shared/attachments.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Deletes one Board: its attachment objects first, then the Board row.
 *
 * **Why this is a command rather than a Data API DELETE (#399).** `create_board` is an RPC because
 * a Board and its Owner Membership must appear *together*, and no client-writable INSERT can be
 * non-escalating. Deletion is the exact mirror: the objects and the rows must disappear together,
 * in order, and a client-driven sequence cannot guarantee that against an interrupted run.
 *
 * **The order is forced, not preferred.** `attachments_delete_editor` authorizes by matching the
 * path's first segment against `board_memberships`. Deleting the Board destroys that membership, so
 * afterwards nobody can authorize the object delete -- the files become unreachable *and*
 * undeletable, permanently. Objects first, every time.
 *
 * **A failure must leave the Board intact.** If the object sweep throws we return an error and do
 * not touch the rows, so the user can retry and finish. A Board that still exists with some files
 * already gone is recoverable; a deleted Board with files stranded is not. `remove()` on an absent
 * path is not an error, which is what makes the retry safe.
 *
 * **Authorization is this handler's own job.** The service-role client bypasses RLS entirely, so
 * `boards_delete_owner` protects nothing here. Ownership is checked explicitly below, against the
 * verified caller's id, before any destructive step.
 *
 * **Through commands, never the tables (#447).** The Board tables grant `service_role` nothing,
 * and `BYPASSRLS` skips policies, not privileges -- this handler used to read `board_memberships`
 * and delete from `boards` directly, and both were 42501 on any database without legacy default
 * privileges. `is_current_board_owner` and `delete_board_as_owner` (`service_role` only) are its
 * whole reach; `tests/rls/deletion_commands.test.ts` calls them as `service_role` and fails if any
 * function reads a Board table directly again.
 */
export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const user = await requireUser(req);
  if (user instanceof Response) return user;

  let boardId: unknown;
  try {
    ({ boardId } = await req.json());
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (typeof boardId !== "string" || !isUuid(boardId)) {
    return json({ error: "boardId must be a uuid" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // The caller must be a CURRENT OWNER of this Board. `ended_at is null` matters as much as the
  // role: a former Owner is not an Owner. Anything else is 404 rather than 403, so this endpoint
  // cannot be used to probe which Board ids exist.
  const { data: isOwner, error: ownerError } = await admin.rpc(
    "is_current_board_owner",
    { p_board_id: boardId, p_account_id: user.id },
  );
  if (ownerError) {
    console.error("delete-board: ownership check failed", ownerError);
    return json({ error: "Deletion failed" }, 500);
  }
  if (isOwner !== true) return json({ error: "Board not found" }, 404);

  // Objects first. Throwing here leaves every row untouched, which is the recoverable state.
  try {
    await removeBoardAttachments(admin, [boardId]);
  } catch (cause) {
    console.error("delete-board: attachment sweep failed", cause);
    return json({ error: "Deletion failed" }, 500);
  }

  // Rechecks Ownership under the Board row lock: a demotion may have landed during the sweep.
  const { data: deleted, error: deleteError } = await admin.rpc(
    "delete_board_as_owner",
    { p_board_id: boardId, p_account_id: user.id },
  );
  if (deleteError) {
    // The objects are already gone and the Board is not. That is the one inconsistent state this
    // can produce, and it is the harmless direction: a retry deletes the Board, and the attachment
    // rows go with it through the cascade. Logged because it should never happen.
    console.error("delete-board: board delete failed after sweep", deleteError);
    return json({ error: "Deletion failed" }, 500);
  }
  if (deleted !== true) {
    // Demoted between the check and the delete. The Board stands, with its files already swept --
    // the same harmless direction as above -- and the caller is no longer entitled to retry.
    return json({ error: "Board not found" }, 404);
  }

  return json({ ok: true });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
