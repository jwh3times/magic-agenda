-- Account deletion has to end Memberships before `auth.users` disappears.
--
-- WHY THIS IS REQUIRED BY THE PREVIOUS MIGRATIONS, NOT OPTIONAL POLISH
--
-- `board_memberships.account_id` is `on delete set null` (so surviving Board content keeps a
-- Former Member attribution rather than cascading away), and the table carries
-- `check (account_id is not null or ended_at is not null)`. Deleting an `auth.users` row therefore
-- nulls `account_id` on a row whose `ended_at` is still NULL, and the check fires:
--
--   Database error deleting user
--
-- Confirmed by the RLS integration suite, whose teardown deletes real users. Without this trigger,
-- `delete-account` -- which calls `auth.admin.deleteUser` and relies entirely on cascades -- is
-- broken for every account. The constraint is right and the deletion path was incomplete.
--
-- Deleting the trigger to "fix" a future deletion failure would reintroduce that, so if this ever
-- gets in the way, fix the ordering, not the constraint.

create or replace function public.handle_account_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sole_owned bigint;
begin
  -- `old.id`, never `auth.uid()`. `auth.admin.deleteUser` executes administratively through the
  -- service role, so `auth.uid()` is not the departing account here -- reading it would check the
  -- wrong person's memberships, which is the kind of mistake that passes every test written by
  -- someone signed in as themselves.

  -- Lock the affected Boards for the duration of the transaction, so a concurrent role change or
  -- removal cannot invalidate the sole-owner decision between the check and the writes below.
  perform 1
     from public.boards b
    where exists (
      select 1 from public.board_memberships m
       where m.board_id = b.id and m.account_id = old.id and m.ended_at is null
    )
    for update;

  -- Refuse when this Account is the only Owner of a Board that OTHER people are still on. Deleting
  -- would either strand that Board ownerless or destroy content belonging to members who did not
  -- ask for it; the domain model says the account must add another Owner or delete the Board first.
  --
  -- This cannot trigger today -- every Board has exactly one Membership until sharing ships -- and
  -- it is here precisely because it must already exist and be correct on the day the first Board is
  -- shared. The Edge Function may present a friendlier preflight, but this is the authoritative
  -- check: it is the one that a request racing the preflight still has to pass.
  select count(*) into sole_owned
    from public.board_memberships mine
   where mine.account_id = old.id
     and mine.ended_at is null
     and mine.role = 'owner'
     and exists (
       select 1 from public.board_memberships other
        where other.board_id = mine.board_id
          and other.ended_at is null
          and other.account_id is distinct from old.id
     )
     and not exists (
       select 1 from public.board_memberships other_owner
        where other_owner.board_id = mine.board_id
          and other_owner.ended_at is null
          and other_owner.role = 'owner'
          and other_owner.account_id is distinct from old.id
     );

  if sole_owned > 0 then
    raise exception
      'Account is the sole owner of % shared board(s); add another owner or delete them first',
      sole_owned
      using errcode = 'restrict_violation';
  end if;

  -- Private Boards -- exactly one current Membership, this account's -- are deleted outright. The
  -- cascade takes their tasks and the Membership row with them, so nothing is left to violate the
  -- check constraint.
  delete from public.boards b
   where exists (
     select 1 from public.board_memberships m
      where m.board_id = b.id and m.account_id = old.id and m.ended_at is null
   )
     and (
       select count(*) from public.board_memberships m2
        where m2.board_id = b.id and m2.ended_at is null
     ) = 1;

  -- Anything still current is a Shared Board that keeps another Owner. End the Membership so that
  -- the FK's `set null` lands on an already-ended row and the check constraint holds.
  update public.board_memberships
     set ended_at = now(),
         end_reason = 'account-deleted'
   where account_id = old.id
     and ended_at is null;

  return old;
end;
$$;

revoke all on function public.handle_account_deletion() from public;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  before delete on auth.users
  for each row execute function public.handle_account_deletion();
