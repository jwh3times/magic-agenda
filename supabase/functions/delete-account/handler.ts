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
 * TODO(#279): that trigger raises `restrict_violation` when the account is the
 * sole Owner of a Board somebody else is still a member of. No such Board can
 * exist until sharing ships, so today it is unreachable -- but once it can
 * happen, it surfaces here as a generic `Deletion failed` 500 telling the user
 * nothing they could act on. Map it to its own message then.
 */
export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const admin = adminClient();
  // Sweep first, and abort the whole deletion if it fails. Leaving the account intact is the
  // recoverable outcome: the user can retry. Deleting the account with files stranded is not.
  try {
    await removeBoardAttachments(admin, await privateBoardIds(admin, user.id));
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

/**
 * The Boards `handle_account_deletion` will delete: this account is a current member, and it is the
 * only current member. Mirrors the predicate in `20260813210400_account_deletion.sql` -- if that
 * trigger's definition of a Private Board ever changes, this has to change with it, or the sweep
 * and the cascade stop agreeing about which Boards are going away.
 */
async function privateBoardIds(
  admin: Admin,
  accountId: string,
): Promise<string[]> {
  // `.returns<>()` because this client is untyped -- it has no generated Database generic, so
  // PostgREST rows infer as `never` and every field access is a type error.
  const { data, error } = await admin
    .from("board_memberships")
    .select("board_id")
    .eq("account_id", accountId)
    .is("ended_at", null)
    .returns<{ board_id: string }[]>();
  if (error) throw new Error(`membership lookup: ${error.message}`);

  const boardIds: string[] = [];
  for (const row of data ?? []) {
    const { count, error: countError } = await admin
      .from("board_memberships")
      .select("board_id", { count: "exact", head: true })
      .eq("board_id", row.board_id)
      .is("ended_at", null);
    if (countError) throw new Error(`membership count: ${countError.message}`);
    if (count === 1) boardIds.push(row.board_id);
  }
  return boardIds;
}
