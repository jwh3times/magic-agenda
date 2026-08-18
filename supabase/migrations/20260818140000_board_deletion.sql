-- Board deletion: an Owner may destroy a Board they own, and everything contained in it.
--
-- Unlike creation, this is a plain DELETE rather than an RPC, and the asymmetry is not an
-- oversight. Creation had to write two rows that must exist together — a Board with no Membership
-- is unreachable by every policy here — and no client-writable Membership INSERT can be made
-- non-escalating. Deletion writes one row; the Board's contents follow through foreign keys that
-- already exist. There is nothing to make atomic that Postgres is not already making atomic, so a
-- definer function would add a privilege surface and buy nothing.
--
-- What follows the row is the whole point, and is worth stating plainly because no policy says it:
-- `tasks.board_id`, `labels.board_id`, and `board_memberships.board_id` are each
-- `on delete cascade`, so deleting a Board destroys every Task in it (recurrence templates and
-- their instances included), its entire Label vocabulary, and the Membership that granted access.
-- Referential actions are not subject to RLS — they run as the referencing table's owner — so the
-- caller's policies on `tasks` and `labels` neither permit nor prevent any of it. The Owner-only
-- DELETE policy on this table is therefore the ONLY thing standing in front of all of it.
--
-- Deliberately NOT guarded against deleting a Board that other people are members of. That guard
-- exists in `handle_account_deletion`, for a different situation: there the account is leaving, and
-- destroying content belonging to members who did not ask for it is not its call to make. Here the
-- caller is the Owner, and destroying an owned Board is what Ownership means. Revisit only if the
-- domain model later says a Shared Board needs co-owner consent; today every Board has exactly one
-- Membership and the question has no subject.
--
-- Deleting your LAST Board is allowed. Zero Boards is a legitimate domain state, not an error —
-- `resolveSelection` already returns null for it and documents the product answer as "offer to
-- create or join one, never silently mint another".

create policy boards_delete_owner on public.boards
  for delete to authenticated
  using (
    id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid())
         and m.ended_at is null
         and m.role = 'owner'
    )
  );

-- No column list: DELETE privilege is not column-scoped in PostgreSQL, and there is nothing here
-- for a column grant to narrow. The policy above is the entire boundary.
grant delete on table public.boards to authenticated;
