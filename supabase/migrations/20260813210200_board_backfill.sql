-- Backfill: give every existing Account a Profile, one Board, and an Owner Membership, then route
-- every existing task through it.
--
-- Every statement here is idempotent and re-runnable. That is not politeness -- `supabase db push`
-- applies migrations to production on merge, and a partially-applied migration that cannot be
-- safely re-run is an outage with no clean recovery.

-- ---------------------------------------------------------------------------
-- 1. One Profile per Account
-- ---------------------------------------------------------------------------
-- Display Name is left as the empty-string default rather than seeded from auth metadata. A
-- neutral fallback is the point: `raw_user_meta_data` is user-controlled, and seeding display text
-- from it at scale would import whatever a signup form accepted, unvalidated, into a field other
-- members will eventually see. The app renders its own fallback for an empty name.
insert into public.account_profiles (account_id)
select u.id from auth.users u
on conflict (account_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. One Board + Owner Membership per Account
-- ---------------------------------------------------------------------------
-- A row-at-a-time loop rather than a set-based insert, because the Board id has to be carried into
-- the Membership row: a single `insert ... select ... returning` cannot correlate its generated ids
-- back to the accounts they were generated for.
--
-- The guard is on a CURRENT membership existing, so re-running never creates a second Board, and an
-- account whose only membership has ended correctly gets a fresh one.
--
-- Default View moves from the account-wide `user_settings` row to this Membership -- it is the one
-- setting the domain model scopes to a Membership rather than an Account. `user_settings.default_view`
-- is left in place and authoritative for now; it is dropped in the cleanup phase, once nothing reads it.
do $$
declare
  account record;
  new_board uuid;
begin
  for account in select id from auth.users loop
    if not exists (
      select 1 from public.board_memberships m
       where m.account_id = account.id and m.ended_at is null
    ) then
      insert into public.boards (name) values ('My Board')
        returning id into new_board;

      insert into public.board_memberships (board_id, account_id, role, default_view)
      values (
        new_board,
        account.id,
        'owner',
        coalesce(
          (select s.default_view from public.user_settings s where s.user_id = account.id),
          'calendar'
        )
      );
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Route every existing task through its Account's Board
-- ---------------------------------------------------------------------------
update public.tasks t
   set board_id = m.board_id
  from public.board_memberships m
 where m.account_id = t.user_id
   and m.ended_at is null
   and t.board_id is null;

-- Attribution for existing rows: the owner authored them, by definition -- there was no one else.
update public.tasks
   set author_id = user_id
 where author_id is null;

-- ---------------------------------------------------------------------------
-- 4. Close the NULL-origin recurrence hole
-- ---------------------------------------------------------------------------
-- A closed legacy set: instances that were sitting in the inbox when 20260630130000 ran, whose
-- origin occurrence that migration could not recover. `makeInstance` has stamped an origin on every
-- instance created since, so the set cannot grow.
--
-- They fall OUTSIDE `tasks_recur_instance_uniq` entirely, because the index is partial on
-- `recur_parent_id is not null` and NULLs are distinct anyway. That is tolerable while the
-- constraint only has to catch one user's StrictMode double-insert. It stops being tolerable at the
-- cutover, when the Board-scoped version of that index becomes the thing standing between
-- concurrent clients and duplicate occurrence rows.
--
-- Detaching rather than deleting: `instanceOrigin` already returns the meaningless 'inbox' for
-- these, so they behave as ordinary inbox tasks today. Clearing `recur_parent_id` makes them what
-- they already are and removes them from the index's scope, without destroying task text a person
-- actually wrote. Correct at zero rows.
update public.tasks
   set recur_parent_id = null
 where recur_parent_id is not null
   and recur_origin_day is null;

-- ---------------------------------------------------------------------------
-- 5. Assert the gate
-- ---------------------------------------------------------------------------
-- The phase gate is "every task has one Board, every Board has an Owner". Checked here rather than
-- only in the test suite, because this migration runs against production data that no test sees --
-- and a silent partial backfill is exactly the failure that would not surface until the cutover
-- made `board_id` NOT NULL.
do $$
declare
  orphan_tasks bigint;
  ownerless_boards bigint;
  accounts_without_board bigint;
begin
  select count(*) into orphan_tasks from public.tasks where board_id is null;
  if orphan_tasks > 0 then
    raise exception 'Backfill incomplete: % task(s) still have no board_id', orphan_tasks;
  end if;

  select count(*) into ownerless_boards
    from public.boards b
   where not exists (
     select 1 from public.board_memberships m
      where m.board_id = b.id and m.role = 'owner' and m.ended_at is null
   );
  if ownerless_boards > 0 then
    raise exception 'Backfill incomplete: % board(s) have no current owner', ownerless_boards;
  end if;

  select count(*) into accounts_without_board
    from auth.users u
   where not exists (
     select 1 from public.board_memberships m
      where m.account_id = u.id and m.ended_at is null
   );
  if accounts_without_board > 0 then
    raise exception 'Backfill incomplete: % account(s) have no board', accounts_without_board;
  end if;
end $$;
