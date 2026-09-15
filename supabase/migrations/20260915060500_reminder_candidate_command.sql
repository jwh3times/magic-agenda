-- Narrow server-side read command for the Reminder sender (#267).
--
-- `service_role` deliberately has no table grant on Board Memberships: administration is
-- command-owned, and widening the table just for this scheduled reader would undo that boundary.
-- This definer exposes only the joined fields required to derive Account-specific Due Moments.

create function public.reminder_candidate_rows()
returns table (
  account_id uuid,
  timezone text,
  lead_minutes int,
  board_id uuid,
  task_id uuid,
  task_title text,
  task_day text,
  task_at_time text,
  task_status text,
  recur_freq text,
  recur_parent_id uuid,
  task_updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    settings.user_id,
    settings.timezone,
    settings.reminder_lead_minutes,
    membership.board_id,
    task.id,
    task.title,
    task.day::text,
    case when task.at_time is null then null else to_char(task.at_time, 'HH24:MI') end,
    task.status,
    task.recur_freq,
    task.recur_parent_id,
    task.updated_at
  from public.user_settings settings
  join public.board_memberships membership
    on membership.account_id = settings.user_id
   and membership.ended_at is null
  join public.tasks task on task.board_id = membership.board_id
  where settings.reminder_lead_minutes is not null
    and settings.timezone is not null
    and task.day is not null;
$$;

revoke all on function public.reminder_candidate_rows() from public, anon, authenticated;
grant execute on function public.reminder_candidate_rows() to service_role;
