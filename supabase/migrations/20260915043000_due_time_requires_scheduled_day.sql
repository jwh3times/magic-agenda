-- v1.12.6 made every supported client clear Due Time while moving a Task to Inbox. Enforce the
-- same Due Moment invariant for imports, older callers, and direct Data API writes.

-- NOT VALID starts protecting new writes immediately while still allowing the legacy rows below
-- to exist until this transaction repairs them.
alter table public.tasks
  add constraint tasks_due_time_requires_scheduled_day
  check (day is not null or at_time is null) not valid;

-- This semantic cleanup is not a user edit. Preserve timestamps, revision, and attribution while
-- clearing only the field Inbox cannot carry.
alter table public.tasks disable trigger tasks_set_updated_at;
alter table public.tasks disable trigger tasks_stamp_attribution;

update public.tasks
   set at_time = null
 where day is null
   and at_time is not null;

alter table public.tasks enable trigger tasks_stamp_attribution;
alter table public.tasks enable trigger tasks_set_updated_at;

do $$
declare
  offenders bigint;
begin
  select count(*) into offenders
    from public.tasks
   where day is null
     and at_time is not null;
  if offenders > 0 then
    raise exception 'due-time cleanup left % Inbox task row(s) with at_time', offenders;
  end if;
end;
$$;

alter table public.tasks validate constraint tasks_due_time_requires_scheduled_day;
