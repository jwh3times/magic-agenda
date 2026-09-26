-- ---------------------------------------------------------------------------
-- Membership administration (#438, part of #279)
-- ---------------------------------------------------------------------------
-- Three commands: an Owner changes a member's role, an Owner removes a member, and any member
-- leaves. They are commands rather than grants for the reason `board_memberships` has never had a
-- role grant: **a Board always keeps at least one current Owner**, and that invariant spans rows —
-- no policy can see the other Memberships of the Board, and none can see the old row.
--
-- Concurrency is the whole difficulty. Two Owners demoting each other, or both leaving, each see
-- "another Owner exists" if they read at the same time, and both succeed, leaving none. So every
-- command first takes the Board row lock (`select … for update` on `boards`), the same lock
-- `handle_account_deletion` takes, and only then reads the Memberships. The second of two
-- concurrent commands waits, then reads the first one's result and refuses.
--
-- Memberships are ended (`ended_at`, `end_reason`), never deleted: an ended row is history, and
-- `board_memberships_select_own` deliberately keeps it visible to its own account so a live
-- client can observe its revocation (#439).
--
-- Refusals raise with a stable token as the message, which the client maps to its outcome
-- vocabulary (`src/board/memberAdmin.ts`):
--   last-owner        the change would leave the Board with no current Owner
--   membership-ended  the CALLER has no current Membership of that Board (also: no such
--                     Membership or Board — the caller cannot tell those apart, by design)
--   not-owner         the caller is a current member but not an Owner
--   member-ended      the TARGET Membership has already ended
--   invalid-role      the requested role is not one of the three
--
-- No account parameters: the caller is `auth.uid()`, and targets are named by Membership id.

create function public.change_member_role(p_membership_id uuid, p_role text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.board_memberships%rowtype;
  caller_role text;
begin
  if p_role is null or p_role not in ('owner', 'editor', 'viewer') then
    raise exception using errcode = 'P0001', message = 'invalid-role';
  end if;

  select membership.* into target
    from public.board_memberships membership
   where membership.id = p_membership_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'membership-ended';
  end if;

  perform 1 from public.boards board where board.id = target.board_id for update;

  select membership.role into caller_role
    from public.board_memberships membership
   where membership.board_id = target.board_id
     and membership.account_id = (select auth.uid())
     and membership.ended_at is null;
  if caller_role is null then
    raise exception using errcode = 'P0001', message = 'membership-ended';
  end if;
  if caller_role <> 'owner' then
    raise exception using errcode = 'P0001', message = 'not-owner';
  end if;

  -- Re-read under the lock: the row read above may predate a concurrent command.
  select membership.* into target
    from public.board_memberships membership
   where membership.id = p_membership_id;
  if target.ended_at is not null then
    raise exception using errcode = 'P0001', message = 'member-ended';
  end if;
  if target.role = p_role then
    return;
  end if;

  if target.role = 'owner' and not exists (
    select 1 from public.board_memberships other
     where other.board_id = target.board_id
       and other.ended_at is null
       and other.role = 'owner'
       and other.id <> target.id
  ) then
    raise exception using errcode = 'P0001', message = 'last-owner';
  end if;

  update public.board_memberships membership
     set role = p_role
   where membership.id = target.id;
end;
$$;

create function public.remove_member(p_membership_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.board_memberships%rowtype;
  caller_role text;
begin
  select membership.* into target
    from public.board_memberships membership
   where membership.id = p_membership_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'membership-ended';
  end if;

  perform 1 from public.boards board where board.id = target.board_id for update;

  select membership.role into caller_role
    from public.board_memberships membership
   where membership.board_id = target.board_id
     and membership.account_id = (select auth.uid())
     and membership.ended_at is null;
  if caller_role is null then
    raise exception using errcode = 'P0001', message = 'membership-ended';
  end if;
  if caller_role <> 'owner' then
    raise exception using errcode = 'P0001', message = 'not-owner';
  end if;

  select membership.* into target
    from public.board_memberships membership
   where membership.id = p_membership_id;
  if target.ended_at is not null then
    raise exception using errcode = 'P0001', message = 'member-ended';
  end if;

  if target.role = 'owner' and not exists (
    select 1 from public.board_memberships other
     where other.board_id = target.board_id
       and other.ended_at is null
       and other.role = 'owner'
       and other.id <> target.id
  ) then
    raise exception using errcode = 'P0001', message = 'last-owner';
  end if;

  -- An Owner removing themselves is leaving, and is recorded as such.
  update public.board_memberships membership
     set ended_at = pg_catalog.now(),
         end_reason = case when target.account_id = (select auth.uid()) then 'left' else 'removed' end
   where membership.id = target.id;
end;
$$;

-- Leaving takes a Board, not a Membership id: a member always knows the Board they are on, and it
-- can only ever end the caller's own row. The sole Owner cannot leave — including the sole member
-- of a Private Board, where leaving would strand the Board unreachable; deleting it is the way out.
create function public.leave_board(p_board_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  mine public.board_memberships%rowtype;
begin
  perform 1 from public.boards board where board.id = p_board_id for update;

  select membership.* into mine
    from public.board_memberships membership
   where membership.board_id = p_board_id
     and membership.account_id = (select auth.uid())
     and membership.ended_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'membership-ended';
  end if;

  if mine.role = 'owner' and not exists (
    select 1 from public.board_memberships other
     where other.board_id = p_board_id
       and other.ended_at is null
       and other.role = 'owner'
       and other.id <> mine.id
  ) then
    raise exception using errcode = 'P0001', message = 'last-owner';
  end if;

  update public.board_memberships membership
     set ended_at = pg_catalog.now(),
         end_reason = 'left'
   where membership.id = mine.id;
end;
$$;

-- Explicitly from anon and service_role, not only public (#384).
revoke all on function public.change_member_role(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.remove_member(uuid) from public, anon, authenticated, service_role;
revoke all on function public.leave_board(uuid) from public, anon, authenticated, service_role;
grant execute on function public.change_member_role(uuid, text) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;
grant execute on function public.leave_board(uuid) to authenticated;
