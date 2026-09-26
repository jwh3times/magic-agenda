-- ---------------------------------------------------------------------------
-- Service-role commands for the two deletion Edge Functions (#447)
-- ---------------------------------------------------------------------------
-- `delete-board` and `delete-account` reached `boards` and `board_memberships` through their
-- service-role client, but the Board tables grant `service_role` nothing by design
-- (20260813210000_board_foundation.sql), and 20260918230000_board_deletion_is_a_command.sql revoked
-- `DELETE` on `boards` from it explicitly. `BYPASSRLS` skips policies, not privileges, so on a stack
-- without legacy default privileges both functions fail with 42501 before doing anything. Nothing
-- caught it: the local stack excludes `edge-runtime`, and no test called the tables as
-- `service_role`.
--
-- The fix keeps the posture rather than widening it: the Board tables still grant `service_role`
-- nothing, and each function gets narrow `security definer` commands executable by `service_role`
-- alone — the pattern `ical_feed` and `reminder_candidate_rows` already follow. The account
-- parameters are safe for the same reason `cancel_attachment_upload`'s is: only the Edge Function
-- can call these, and it passes the id of the caller it verified from the JWT.

-- Whether an Account is a current Owner of a Board. `delete-board` asks before sweeping the Board's
-- attachment objects, and must ask before, since the sweep cannot be undone.
create function public.is_current_board_owner(p_board_id uuid, p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.board_memberships membership
     where membership.board_id = p_board_id
       and membership.account_id = p_account_id
       and membership.role = 'owner'
       and membership.ended_at is null
  );
$$;

-- Delete a Board as its current Owner: lock the row, recheck Ownership under the lock (the sweep
-- ran in between, and a demotion may have landed meanwhile), then delete. The cascade takes the
-- Board's Tasks, Labels, Memberships, and attachment rows. `false` means "not an Owner now", and
-- the Board is untouched.
create function public.delete_board_as_owner(p_board_id uuid, p_account_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform 1 from public.boards board where board.id = p_board_id for update;
  if not public.is_current_board_owner(p_board_id, p_account_id) then
    return false;
  end if;
  delete from public.boards board where board.id = p_board_id;
  return true;
end;
$$;

-- What deleting an Account would do to each Board it is a current member of — the same three cases
-- `handle_account_deletion` distinguishes, so the Edge Function can act on them BEFORE the delete:
--
--   private            the Account is the only current member; the trigger deletes the Board,
--                      so its attachment objects must be swept first
--   sole-owner-shared  the Account is the only current Owner and others are still members; the
--                      trigger refuses the whole deletion
--   shared             the Board survives with another Owner; the Membership is ended
--
-- **The preflight is load-bearing, not cosmetic.** The function sweeps the private Boards' files
-- before calling `deleteUser`. If the trigger then refused on a sole-owned shared Board, the
-- account would survive with its private Boards intact and their files gone. Refusing first, from
-- this answer, is what prevents that; the trigger remains the authority for a request that races
-- it. `tests/rls/deletion_commands.test.ts` checks the two agree.
create function public.account_deletion_plan(p_account_id uuid)
returns table (board_id uuid, disposition text)
language sql
stable
security definer
set search_path = ''
as $$
  select mine.board_id,
         case
           when not exists (
             select 1 from public.board_memberships other
              where other.board_id = mine.board_id
                and other.ended_at is null
                and other.account_id is distinct from p_account_id
           ) then 'private'
           when mine.role = 'owner' and not exists (
             select 1 from public.board_memberships other_owner
              where other_owner.board_id = mine.board_id
                and other_owner.ended_at is null
                and other_owner.role = 'owner'
                and other_owner.account_id is distinct from p_account_id
           ) then 'sole-owner-shared'
           else 'shared'
         end
    from public.board_memberships mine
   where mine.account_id = p_account_id
     and mine.ended_at is null
   order by mine.board_id;
$$;

-- `service_role` only, and explicitly revoked from every other API role (#384).
revoke all on function public.is_current_board_owner(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.delete_board_as_owner(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.account_deletion_plan(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.is_current_board_owner(uuid, uuid) to service_role;
grant execute on function public.delete_board_as_owner(uuid, uuid) to service_role;
grant execute on function public.account_deletion_plan(uuid) to service_role;
