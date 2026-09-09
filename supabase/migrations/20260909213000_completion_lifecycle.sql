-- ADR-0003 makes Workflow Status the single source of truth and Completion the transition into it.
-- The v1.8.58 client writes the lifecycle fields, but a client from before it -- or any direct Data
-- API write -- knows only `status`. This migration fills in what that compatibility window left
-- unknown, then moves ownership of every lifecycle value from the client to PostgreSQL.

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- The backfill must not look like an edit. `tasks_set_updated_at` would overwrite the very column
-- the Completion proxy below reads, and `tasks_stamp_attribution` would bump `revision` on every
-- row and stamp `last_editor_id` NULL -- an administrative write with no authenticated user --
-- rewriting the attribution #291 deliberately declined to backfill.
alter table public.tasks disable trigger tasks_set_updated_at;
alter table public.tasks disable trigger tasks_stamp_attribution;

-- An active Task carries no Completion or Archive state. `reopen_status` is filled only where it is
-- missing: a value a compatible client already wrote is a record of real intent, while the current
-- status is only the best available guess at one.
update public.tasks
   set completed_at = null,
       archived_at = null,
       reopen_status = coalesce(reopen_status, status)
 where status <> 'done'
   and (completed_at is not null or archived_at is not null or reopen_status is null);

-- `updated_at` is the closest surviving proxy for a historical Completion. The exact instant was
-- never recorded: migration time would invent a spike on today's date, and `created_at` describes
-- when the Task was written rather than when the work finished. The prior active status is simply
-- unknowable, so a legacy Completed Task reopens to To Do (ADR-0003). Existing `archived_at` values
-- are retained here and cleared only on the active rows above.
update public.tasks
   set completed_at = coalesce(completed_at, updated_at),
       reopen_status = coalesce(reopen_status, 'todo')
 where status = 'done'
   and (completed_at is null or reopen_status is null);

alter table public.tasks enable trigger tasks_stamp_attribution;
alter table public.tasks enable trigger tasks_set_updated_at;

-- Assert before constraining, so a backfill that missed a shape names the shape rather than
-- surfacing as whichever CHECK happens to be validated first.
do $$
declare
  offenders bigint;
begin
  select count(*) into offenders
    from public.tasks
   where (completed_at is not null) <> (status = 'done')
      or reopen_status is null
      or (archived_at is not null and status <> 'done');
  if offenders > 0 then
    raise exception
      'completion backfill left % task row(s) violating the lifecycle invariants', offenders;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The authoritative transition
-- ---------------------------------------------------------------------------

-- Invoker security: this decides Task content, never access, and RLS still owns which rows the
-- caller may write at all. The empty `search_path` is the repository's consistency rule for every
-- function body rather than a privilege boundary here, so every reference is schema-qualified.
create function public.enforce_task_completion_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'done' then
    if tg_op = 'INSERT' then
      -- A row that arrives already Completed has no earlier active status to remember, and its
      -- Completed At may be real history: an import restores the instant a v3 backup recorded.
      new.completed_at := coalesce(new.completed_at, pg_catalog.now());
      new.reopen_status := coalesce(new.reopen_status, 'todo');
    elsif old.status = 'done' then
      -- Remaining Completed is an ordinary edit. Completed At describes this Completion and only a
      -- transition may establish it, so the stored value outranks whatever the payload carried.
      new.completed_at := old.completed_at;
      new.reopen_status := old.reopen_status;
    else
      -- Entering Completed. The remembered active status is the one being left, read from the
      -- stored row rather than from the client's claim -- which is what lets a payload that knows
      -- only `status` still produce a coherent row.
      new.completed_at := pg_catalog.now();
      new.reopen_status := old.status;
    end if;

    -- Archive is a transition too. The first one is stamped here, staying Archived preserves the
    -- original instant, and clearing the field unarchives. An INSERT keeps what it supplied, for
    -- the same import-fidelity reason as Completed At.
    if tg_op = 'UPDATE' and new.archived_at is not null then
      new.archived_at := coalesce(old.archived_at, pg_catalog.now());
    end if;
  else
    -- Active. Completion and Archive state cannot survive the move, and the status just entered
    -- becomes the one a later Reopen returns to.
    new.completed_at := null;
    new.archived_at := null;
    new.reopen_status := new.status;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_task_completion_lifecycle() from public;

-- Fires before `tasks_set_updated_at` and `tasks_stamp_attribution` by name order. Nothing here
-- depends on that, and nothing there reads a lifecycle column.
create trigger tasks_enforce_completion_lifecycle
before insert or update on public.tasks
for each row execute function public.enforce_task_completion_lifecycle();

-- ---------------------------------------------------------------------------
-- Invariants
-- ---------------------------------------------------------------------------

-- Every Task remembers an active status, so the column is NOT NULL rather than merely checked. The
-- default that comes with it is never observable -- the trigger above rewrites `reopen_status` on
-- every insert -- and exists only so the column stays omittable: without it, NOT NULL makes
-- `reopen_status` a *required* field in the generated Insert type, forcing every caller to name a
-- value the database is about to discard.
alter table public.tasks
  alter column reopen_status set not null,
  alter column reopen_status set default 'todo';

-- Both constraints are named, so error mapping and tests key on SQLSTATE plus a constraint name and
-- never on message prose. They are not redundant with the trigger: `data.sql` restores under
-- `session_replication_role = replica`, which fires no triggers at all, so a restore meets these and
-- nothing else. `tasks_reopen_status_active` from the foundation release still owns the value domain.
alter table public.tasks
  add constraint tasks_completed_at_matches_status
    check ((completed_at is not null) = (status = 'done')),
  add constraint tasks_archived_at_requires_completed
    check (archived_at is null or status = 'done');
