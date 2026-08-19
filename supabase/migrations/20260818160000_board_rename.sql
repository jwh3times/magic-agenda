-- Board rename: the last of the Board lifecycle operations, and the least dangerous.
--
-- Renaming cannot produce a second Board, so it carries none of the stale-client hazard that made
-- creation and the `tasks_infer_board_id` drop one indivisible release. It ships separately for
-- exactly that reason.

-- ---------------------------------------------------------------------------
-- 1. A Board name is stored trimmed
-- ---------------------------------------------------------------------------
-- Matches `labels_name_trimmed`, and for the same reason: without it "Work" and "Work " are two
-- different names that render identically, and the difference surfaces only as a confirmation
-- prompt that refuses input the user is certain they typed correctly.
--
-- Safe to add without a backfill. Every name in existence is `'My Board'` (the column default, the
-- signup trigger, and the backfill all use it) or came through `create_board`, which already
-- `btrim`s. The length bound is the column's original check and is unchanged.
alter table public.boards
  add constraint boards_name_trimmed check (name = btrim(name));

-- ---------------------------------------------------------------------------
-- 2. Owner-only rename
-- ---------------------------------------------------------------------------
-- `using` picks which rows may be targeted; `with check` decides what they may become.
--
-- Be honest about the second one: it is redundant *today*. The only writable column is `name`, by
-- the grant below, and `name` appears in neither predicate — so there is currently no update that
-- `using` admits and `with check` rejects. It is here because that is a property of the grant, not
-- of the policy, and a later `grant update (id)` would silently turn this into the one thing that
-- stops a Board being renumbered out of its Owner's reach. Costing nothing now is the point.
create policy boards_update_owner on public.boards
  for update to authenticated
  using (
    id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid())
         and m.ended_at is null
         and m.role = 'owner'
    )
  )
  with check (
    id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid())
         and m.ended_at is null
         and m.role = 'owner'
    )
  );

-- Column-level, exactly as `board_memberships.default_view` and `account_profiles.display_name`
-- are: RLS cannot express "only this column changed", because a policy cannot see the old row. The
-- grant is what keeps `id`, `created_at`, and `updated_at` out of reach; the policy only decides
-- whose rows are in scope. Both halves are load-bearing and neither substitutes for the other.
grant update (name) on table public.boards to authenticated;
