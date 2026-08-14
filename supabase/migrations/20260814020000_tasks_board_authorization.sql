-- The authorization cutover: task access stops being "is this your row" and becomes "are you a
-- member of this Board".
--
-- THIS IS THE RISKIEST MIGRATION IN THE PROJECT. Every other change so far could be wrong and cost
-- a feature; this one can cost a person access to their own tasks. Three properties make it safe to
-- run, and all three are worth checking before touching it again:
--
--   1. Every task already has a `board_id` (backfilled and asserted in 20260813210200) and every
--      Account has exactly one Board, so the new predicate selects precisely the rows the old one
--      did. This is a change of *reason*, not of *result*.
--   2. The currently-deployed client already sends `board_id` on every write (v1.2.77), and older
--      clients are covered by the `tasks_infer_board_id` trigger, which stays until Board creation
--      ships. So no writer depends on the column being nullable.
--   3. `user_id` is left in place and still written. It is now unused by authorization but remains
--      the fallback if this has to be reverted in a hurry — dropping it is a separate, later step.

-- ---------------------------------------------------------------------------
-- 1. Containment becomes mandatory
-- ---------------------------------------------------------------------------
-- Re-assert before enforcing. `set not null` scans the table anyway, so this costs nothing and
-- turns a constraint violation buried in a migration log into a named, explanatory failure.
do $$
declare
  orphans bigint;
begin
  select count(*) into orphans from public.tasks where board_id is null;
  if orphans > 0 then
    raise exception
      'Cannot enforce board containment: % task(s) have no board_id. Re-run the phase 1 backfill.',
      orphans;
  end if;
end $$;

alter table public.tasks
  alter column board_id set not null;

-- ---------------------------------------------------------------------------
-- 2. A Recurring Series cannot span Boards
-- ---------------------------------------------------------------------------
-- The old self-reference was `recur_parent_id -> tasks(id)`, which says nothing about Boards: an
-- instance could point at a template in another Board and the database would allow it. Qualifying
-- the reference by `board_id` makes that unrepresentable rather than merely unlikely.
--
-- The composite foreign key needs a matching unique constraint to point at. `(board_id, id)` is
-- redundant with the primary key on `id` alone, and that is fine — it exists to be referenced.
create unique index if not exists tasks_board_id_uniq on public.tasks (board_id, id);

alter table public.tasks
  drop constraint if exists tasks_recur_parent_id_fkey;

-- MATCH SIMPLE (the default) is what makes this work for standalone tasks: when ANY column of the
-- key is NULL the constraint is not enforced, and `recur_parent_id` is NULL for every non-instance.
-- So this constrains instances only, which is exactly the intent.
alter table public.tasks
  add constraint tasks_recur_parent_same_board
  foreign key (board_id, recur_parent_id)
  references public.tasks (board_id, id)
  on delete cascade;

-- Occurrence uniqueness moves from per-Account to per-Board. Same shape, one column swapped: at
-- most one materialized instance per (Board, template, origin occurrence).
--
-- This constraint stops being a guard against one user's StrictMode double-invoke and starts being
-- the thing that keeps concurrent clients from double-materializing the same occurrence, which is
-- why 20260813210200 detached the legacy NULL-origin rows that sat outside it.
drop index if exists public.tasks_recur_instance_uniq;

create unique index tasks_recur_instance_uniq
  on public.tasks (board_id, recur_parent_id, recur_origin_day)
  where recur_parent_id is not null;

-- ---------------------------------------------------------------------------
-- 3. The cutover itself
-- ---------------------------------------------------------------------------
-- Replaces the four legacy policies, which target PUBLIC and compare `user_id` to `auth.uid()`.
-- The new ones name `authenticated` explicitly, so `anon` matches no policy at all and reads zero
-- rows rather than relying on `auth.uid()` being NULL to make a predicate false. Same outcome, one
-- fewer thing to reason about — and it removes four of the seven entries recorded in
-- tests/rls/baseline.test.ts as applying to PUBLIC.
--
-- SHAPE: `board_id in (select ...)` rather than a helper function of `board_id`.
--
-- A function taking the row's Board id cannot be hoisted to an InitPlan, so it would run once per
-- row on the hottest query in the application. This uncorrelated subquery is evaluated once per
-- statement and hashed. `(select auth.uid())` inside it is the same trick one level down.
--
-- It also needs no `security definer` helper and therefore no private schema, which is the
-- non-obvious part: a policy that subqueries a DIFFERENT relation does not recurse. Only a
-- self-referential predicate does — a co-member clause ON `board_memberships` raises `infinite
-- recursion detected in policy for relation`, and that is a sharing feature, not this one.
-- Measured on a local stack, not assumed.
drop policy if exists tasks_select_own on public.tasks;
drop policy if exists tasks_insert_own on public.tasks;
drop policy if exists tasks_update_own on public.tasks;
drop policy if exists tasks_delete_own on public.tasks;

-- Read: any current member, whatever their role. Viewers included — that is what Viewer means.
create policy tasks_select_member on public.tasks
  for select to authenticated
  using (
    board_id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid()) and m.ended_at is null
    )
  );

-- Write: Owner or Editor. A Viewer is read-only inside the app, and this is where that is actually
-- enforced rather than merely rendered.
--
-- INSERT's `with check` is what stops a member of Board A from filing a task into Board B: the
-- incoming `board_id` must itself be one they may edit. Before this, `tests/rls/boards.test.ts`
-- proved that exact insert succeeded — that test flips in this release.
create policy tasks_insert_editor on public.tasks
  for insert to authenticated
  with check (
    board_id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid())
         and m.ended_at is null
         and m.role in ('owner', 'editor')
    )
  );

-- UPDATE needs BOTH clauses and they are not the same question: `using` decides which rows may be
-- targeted, `with check` decides what they may become. Without the second, an editable task could
-- be UPDATEd to carry another Board's id — moving content across a boundary the INSERT policy
-- guards. Transfer is a deliberate command, not something a plain update may do.
create policy tasks_update_editor on public.tasks
  for update to authenticated
  using (
    board_id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid())
         and m.ended_at is null
         and m.role in ('owner', 'editor')
    )
  )
  with check (
    board_id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid())
         and m.ended_at is null
         and m.role in ('owner', 'editor')
    )
  );

create policy tasks_delete_editor on public.tasks
  for delete to authenticated
  using (
    board_id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid())
         and m.ended_at is null
         and m.role in ('owner', 'editor')
    )
  );

-- The membership lookup these four policies make is `(account_id, board_id) where ended_at is null`,
-- which `board_memberships_account_idx` (20260813210000) already covers.
