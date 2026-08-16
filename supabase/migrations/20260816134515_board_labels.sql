-- Board-scoped Labels replace the fixed Category vocabulary without breaking a stale deployed
-- client. This release is deliberately additive: `tasks.category` remains, while `label_id` is the
-- new authoritative assignment and a temporary compatibility marker distinguishes "old client
-- omitted label_id" from "new client explicitly chose Unlabeled".

-- ---------------------------------------------------------------------------
-- 1. Board-owned Label definitions
-- ---------------------------------------------------------------------------
create table public.labels (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  name text not null,
  dot_color text not null,
  position integer not null,
  -- Temporary deploy-window alias. It is not domain identity or system-label status: it only lets
  -- a stale client keep addressing a seeded Label after its Owner renames the display name. New
  -- Labels have NULL here, clients cannot write it, and issue #180 drops it with `category`.
  legacy_category text
    check (
      legacy_category is null
      or legacy_category in ('work', 'personal', 'errands', 'ideas', 'health')
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint labels_name_trimmed
    check (name = btrim(name) and char_length(name) between 1 and 80),
  constraint labels_dot_color_hex
    check (dot_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint labels_position_nonnegative check (position >= 0)
);

-- The display name preserves casing, but its identity within a Board does not depend on case.
create unique index labels_board_name_ci_uniq
  on public.labels (board_id, lower(name));

-- Composite uniqueness exists so Task containment can be enforced by a composite foreign key.
-- `id` alone is already globally unique; the redundancy is intentional and reference-owned.
create unique index labels_board_id_uniq
  on public.labels (board_id, id);

-- At most one surviving seeded Label answers to each stale Category within a Board.
create unique index labels_board_legacy_category_uniq
  on public.labels (board_id, legacy_category)
  where legacy_category is not null;

-- The app's normal read is one Board ordered by position; `id` makes ties deterministic.
create index labels_board_position_idx
  on public.labels (board_id, position, id);

create trigger labels_set_updated_at
  before update on public.labels
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Authorization and Data API reachability
-- ---------------------------------------------------------------------------
alter table public.labels enable row level security;

-- Any current member may consume the shared vocabulary. Editors assign existing Labels to Tasks,
-- but only Owners reorganize the vocabulary itself.
create policy labels_select_member on public.labels
  for select to authenticated
  using (
    board_id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid()) and m.ended_at is null
    )
  );

create policy labels_insert_owner on public.labels
  for insert to authenticated
  with check (
    board_id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid())
         and m.ended_at is null
         and m.role = 'owner'
    )
  );

create policy labels_update_owner on public.labels
  for update to authenticated
  using (
    board_id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid())
         and m.ended_at is null
         and m.role = 'owner'
    )
  )
  with check (
    board_id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid())
         and m.ended_at is null
         and m.role = 'owner'
    )
  );

create policy labels_delete_owner on public.labels
  for delete to authenticated
  using (
    board_id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid())
         and m.ended_at is null
         and m.role = 'owner'
    )
  );

-- The local stack still carries a permissive `supabase_admin` default ACL. Revoke first so the
-- migration's explicit grants, not whichever role created the table, define Data API reachability.
revoke all on table public.labels from anon, authenticated, service_role;
grant select on table public.labels to anon, authenticated;
grant insert (board_id, name, dot_color, position) on table public.labels to authenticated;
grant update (name, dot_color, position) on table public.labels to authenticated;
grant delete on table public.labels to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Optional Task assignment, seed data, and existing-row backfill
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column label_id uuid,
  -- False means a stale client omitted the new field. The v2 client always sends true, including
  -- when it intentionally sends `label_id = NULL` for Unlabeled. Issue #180 drops this marker.
  add column label_assignment_explicit boolean not null default false;

insert into public.labels (board_id, name, dot_color, position, legacy_category)
select b.id, seed.name, seed.dot_color, seed.position, seed.legacy_category
  from public.boards b
 cross join (
   values
     ('Work', '#2563eb', 0, 'work'),
     ('Personal', '#db2777', 1, 'personal'),
     ('Errands', '#d97706', 2, 'errands'),
     ('Ideas', '#7c3aed', 3, 'ideas'),
     ('Health', '#059669', 4, 'health')
 ) as seed(name, dot_color, position, legacy_category)
on conflict do nothing;

update public.tasks t
   set label_id = l.id
  from public.labels l
 where l.board_id = t.board_id
   and l.legacy_category = t.category
   and t.label_id is null;

-- At this instant every Task is legacy-shaped and its checked Category has a seeded match. Fail
-- the migration rather than silently turn production Tasks into Unlabeled Tasks.
do $$
declare
  unmapped bigint;
begin
  select count(*) into unmapped from public.tasks where label_id is null;
  if unmapped > 0 then
    raise exception 'Label backfill incomplete: % Task(s) have no Label', unmapped;
  end if;
end $$;

-- Column-list SET NULL clears only the optional Label id. The Board containment key remains NOT
-- NULL, and the composite key makes a cross-Board Label assignment unrepresentable.
alter table public.tasks
  add constraint tasks_label_same_board
  foreign key (board_id, label_id)
  references public.labels (board_id, id)
  on delete set null (label_id);

-- PostgreSQL does not index the referencing side of a foreign key automatically. Label deletion
-- uses this lookup to clear assignments without scanning every Task.
create index tasks_board_label_idx
  on public.tasks (board_id, label_id)
  where label_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Stale-client translation during the deploy window
-- ---------------------------------------------------------------------------
create or replace function public.tasks_sync_legacy_category_label()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.label_assignment_explicit
     and (tg_op = 'INSERT' or new.category is distinct from old.category) then
    select l.id into new.label_id
      from public.labels l
     where l.board_id = new.board_id
       and l.legacy_category = new.category;
  end if;

  return new;
end;
$$;

revoke all on function public.tasks_sync_legacy_category_label() from public;
grant execute on function public.tasks_sync_legacy_category_label() to authenticated;

-- PostgreSQL orders same-event triggers by name. `tasks_infer_board_id_before_insert` therefore
-- runs first, populating Board containment before this trigger looks up a Board-scoped Label.
create trigger tasks_sync_legacy_category_label_before_write
  before insert or update of category on public.tasks
  for each row execute function public.tasks_sync_legacy_category_label();

-- New Boards receive the same ordinary seeded Labels inside the signup transaction. They carry no
-- permanent built-in status; Owners may rename, recolor, reorder, or delete them immediately.
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

  if not exists (
    select 1 from public.board_memberships m
     where m.account_id = new.id and m.ended_at is null
  ) then
    insert into public.boards (name) values ('My Board')
      returning id into new_board;

    insert into public.board_memberships (board_id, account_id, role)
    values (new_board, new.id, 'owner');

    insert into public.labels (board_id, name, dot_color, position, legacy_category)
    values
      (new_board, 'Work', '#2563eb', 0, 'work'),
      (new_board, 'Personal', '#db2777', 1, 'personal'),
      (new_board, 'Errands', '#d97706', 2, 'errands'),
      (new_board, 'Ideas', '#7c3aed', 3, 'ideas'),
      (new_board, 'Health', '#059669', 4, 'health');
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;
