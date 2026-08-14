-- Two triggers: signup now seeds a whole Account, and inserts without a Board get routed to one.

-- ---------------------------------------------------------------------------
-- 1. Signup seeds settings + profile + initial Board + Owner Membership, atomically
-- ---------------------------------------------------------------------------
-- A trigger on `auth.users` runs inside the signup transaction, so all four rows land or the signup
-- fails. That is the correct trade -- an Account with no Board is a broken account, and a loud
-- signup failure is easier to diagnose than a silently half-provisioned one -- but it does mean
-- this function is on the critical path of every registration. It is covered by the RLS
-- integration suite, which creates real users through the real auth API.
--
-- HARDENED here, as the plan requires of any `security definer` function:
--
--   * `set search_path = ''` replaces `search_path = public`. With a non-empty path, an unqualified
--     name in the body resolves through whatever schemas are on it, so anyone who can create
--     objects in one of them can shadow a name this function depends on. Only `postgres` can create
--     in `public` here, so this was never exploitable -- it is closed because a definer function
--     with a writable schema on its path is a standing invitation, not because it broke.
--     The cost is that EVERY reference below must be schema-qualified; an unqualified one is now a
--     hard error at runtime rather than a silent resolution.
--   * EXECUTE is revoked from PUBLIC. PostgreSQL grants it by default, which for a definer function
--     means anyone who can reach the schema can run it with the owner's rights. Postgres checks
--     EXECUTE when a trigger is CREATED, not when it fires, so the existing trigger keeps working.
--
-- `security definer` itself is still required and is not the weakness: the function must insert
-- past RLS on four tables during a transaction where `auth.uid()` is not yet the new user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_board uuid;
begin
  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.account_profiles (account_id)
  values (new.id)
  on conflict (account_id) do nothing;

  -- No `on conflict` guard is possible for a Board: its identity is generated, so there is nothing
  -- to conflict on. The membership guard below is what makes a retry safe -- if this account
  -- somehow already has a current Membership, do not mint a second Board for it.
  if not exists (
    select 1 from public.board_memberships m
     where m.account_id = new.id and m.ended_at is null
  ) then
    insert into public.boards (name) values ('My Board')
      returning id into new_board;

    insert into public.board_memberships (board_id, account_id, role)
    values (new_board, new.id, 'owner');
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

-- The trigger already exists from the initial schema and is unchanged; only the function body and
-- its security properties move. Recreating the trigger is unnecessary and would briefly drop it.

-- ---------------------------------------------------------------------------
-- 2. Compatibility: infer `board_id` for clients that do not send one
-- ---------------------------------------------------------------------------
-- TEMPORARY, AND ITS REMOVAL IS A SECURITY EVENT, NOT A CLEANUP CHORE.
--
-- Until every deployed client sends `board_id`, an insert from the currently-shipped app would land
-- a task with a NULL board. This routes it to the account's single Board.
--
-- That is safe ONLY while each account has exactly one Board. The moment a second Board can exist,
-- this trigger silently files a stale client's task into whichever Board it picks -- the wrong one,
-- with no error. **It must be dropped in the same release that enables Board creation**, so that a
-- pre-cutover client hits the NOT NULL constraint and fails closed instead.
--
-- This is the stale-client enforcement mechanism, and it is deliberately a server-side one. A
-- client-version prompt cannot do this job: navigations are network-first, so the service worker
-- only updates on a navigation, and a board tab left open for weeks never navigates.
--
-- Deliberately NOT `security definer`. The caller can always see their own Membership under the
-- `board_memberships` policy, and `tasks`' own INSERT policy already forces `user_id = auth.uid()`,
-- so an invoker function has exactly the reach it needs. If a future caller cannot resolve its own
-- Board here, that is a signal worth failing on rather than papering over with owner rights.
create or replace function public.tasks_infer_board_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.board_id is null then
    select m.board_id into new.board_id
      from public.board_memberships m
     where m.account_id = new.user_id
       and m.ended_at is null
     order by m.joined_at
     limit 1;
  end if;
  return new;
end;
$$;

revoke all on function public.tasks_infer_board_id() from public;
grant execute on function public.tasks_infer_board_id() to authenticated;

drop trigger if exists tasks_infer_board_id_before_insert on public.tasks;
create trigger tasks_infer_board_id_before_insert
  before insert on public.tasks
  for each row execute function public.tasks_infer_board_id();
