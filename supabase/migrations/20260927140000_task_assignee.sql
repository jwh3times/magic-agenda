-- ---------------------------------------------------------------------------
-- Task Assignee (#440, part of #279)
-- ---------------------------------------------------------------------------
-- Who is doing a Task, on a Board more than one person can see. Decided for the first Shared Board
-- schema rather than after, because reminder targeting (#441) depends on it.
--
-- `assignee_account_id` names a **current member of the Task's Board**, or nothing. A plain foreign
-- key cannot say "current" — Memberships keep their history — so:
--
-- 1. `tasks_enforce_assignee` refuses an assignment to anyone without a current Membership of the
--    Task's Board, whenever the assignee (or the Board) changes. It is `security definer` because
--    the caller can read only their own Membership row, so the check could not otherwise see the
--    co-member it is asking about. It raises `assignee-not-member`.
-- 2. `board_memberships_clear_assignments` clears an Account's assignments on a Board in the same
--    statement that ends its Membership there — removal, leaving, or account deletion — so an
--    ended member is never left holding work, even for a moment.
--
-- Assignment grants nothing. It is attribution, like Author and Last Editor: no policy reads it.
-- It is Series Content (`src/data/fieldOwnership.ts`): an Occurrence can be reassigned alone, or
-- "this and all future", and materialized Occurrences inherit the definition's — which is why
-- `insert_materialized_occurrences` is recreated below with the column in its list.
--
-- Not in the export file: an account id means nothing on another Board, so export omits it and
-- import arrives unassigned (`src/data/exportImport.ts`).

alter table public.tasks
  add column assignee_account_id uuid references auth.users (id) on delete set null;

-- Covers the foreign key, and serves the clearing trigger's (board, assignee) lookup.
create index tasks_board_assignee_idx on public.tasks (assignee_account_id, board_id)
  where assignee_account_id is not null;

grant insert (assignee_account_id), update (assignee_account_id) on public.tasks to authenticated;

create function public.enforce_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_account_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.assignee_account_id is not distinct from old.assignee_account_id
     and new.board_id is not distinct from old.board_id then
    return new;
  end if;
  if not exists (
    select 1 from public.board_memberships membership
     where membership.board_id = new.board_id
       and membership.account_id = new.assignee_account_id
       and membership.ended_at is null
  ) then
    raise exception using errcode = '23514', message = 'assignee-not-member';
  end if;
  return new;
end;
$$;

create trigger tasks_enforce_assignee
  before insert or update of assignee_account_id, board_id on public.tasks
  for each row execute function public.enforce_task_assignee();

create function public.clear_ended_member_assignments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tasks task
     set assignee_account_id = null
   where task.board_id = old.board_id
     and task.assignee_account_id = old.account_id;
  return new;
end;
$$;

create trigger board_memberships_clear_assignments
  after update of ended_at on public.board_memberships
  for each row
  when (old.ended_at is null and new.ended_at is not null and old.account_id is not null)
  execute function public.clear_ended_member_assignments();

-- Owner only: both run as triggers, never as RPCs.
revoke all on function public.enforce_task_assignee() from public, anon, authenticated, service_role;
revoke all on function public.clear_ended_member_assignments()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- insert_materialized_occurrences, with the assignee (see 20260923120000 for the rest)
-- ---------------------------------------------------------------------------
create or replace function public.insert_materialized_occurrences(p_rows jsonb)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  with inserted as (
    insert into public.tasks (
      id, board_id, title, description, label_id, color, checklist, status,
      completed_at, reopen_status, archived_at, day, at_time, pinned, order_index, korder,
      recur_freq, recur_interval, recur_weekdays, recur_count, recur_until,
      recur_parent_id, recur_skip, recur_origin_day, assignee_account_id
    )
    select
      candidate.id, candidate.board_id, candidate.title, candidate.description,
      candidate.label_id, candidate.color, candidate.checklist, candidate.status,
      candidate.completed_at, candidate.reopen_status, candidate.archived_at, candidate.day,
      candidate.at_time, candidate.pinned, candidate.order_index, candidate.korder,
      candidate.recur_freq, candidate.recur_interval, candidate.recur_weekdays,
      candidate.recur_count, candidate.recur_until, candidate.recur_parent_id,
      candidate.recur_skip, candidate.recur_origin_day, candidate.assignee_account_id
    from pg_catalog.jsonb_populate_recordset(null::public.tasks, p_rows) candidate
    where candidate.recur_parent_id is not null
      and candidate.recur_origin_day is not null
      and exists (
        select 1
        from public.tasks definition
        where definition.id = candidate.recur_parent_id
          and definition.board_id = candidate.board_id
          and definition.recur_parent_id is null
          and definition.recur_freq <> 'none'
      )
    on conflict do nothing
    returning 1
  )
  select pg_catalog.count(*)::integer from inserted;
$$;
