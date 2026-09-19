-- Board deletion becomes a command, so attachments cannot be stranded (#399).
--
-- The Data API `DELETE` on `boards` is withdrawn. `delete-board` -- which removes the Board's
-- attachment objects first and the row second -- becomes the only way a client can delete a Board.
--
-- **Why the grant has to go rather than merely being discouraged.** Deleting the Board row destroys
-- the `board_memberships` row that `attachments_delete_editor` matches the object path's first
-- segment against. After that, no caller can authorize the object delete: the files are unreachable
-- *and* undeletable, permanently. A client that still holds `DELETE` on `boards` can reach that
-- state in one request, whatever the UI does, so leaving the grant in place would leave the
-- guarantee decorative.
--
-- **This restores the symmetry the schema already had on the other side.** `boards` has never had
-- an INSERT grant for `authenticated`: `create_board` is an RPC because a Board and its Owner
-- Membership must appear *together*, and no client-writable INSERT can be non-escalating. Deletion
-- is the exact mirror -- the objects and the rows must disappear together, in order -- so it
-- belongs behind a command for the same reason. Until now creation was a command and deletion was
-- a grant, which is the asymmetry this closes.
--
-- **`boards_delete_owner` is deliberately kept.** It no longer authorizes the app's delete path,
-- because the Edge Function holds a service-role client that bypasses RLS and checks Ownership
-- itself. It stays as defence in depth: if a future migration re-grants DELETE, or some other
-- caller reaches the table directly, the policy is what still refuses a non-Owner. A boundary
-- should not depend on a grant to hold.
revoke delete on table public.boards from authenticated;

-- `anon` and `service_role` never had it; revoking explicitly anyway, because `revoke ... from
-- public` alone is what let seven functions drift in production (#384) and the same reasoning
-- applies to a table grant that might be inherited from `pg_default_acl`.
revoke delete on table public.boards from anon, service_role;
