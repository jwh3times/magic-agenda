-- ---------------------------------------------------------------------------
-- Reminders on a Shared Board go to the Assignee, not to every member (#441, part of #279)
-- ---------------------------------------------------------------------------
-- `reminder_candidate_rows` joined every current Membership to every Task on the Board. With one
-- member per Board that was exactly right; with two it would push every member a reminder for
-- every timed Task. Now, on a Board with **more than one** current member, a member is reminded
-- about a Task only when:
--
--   - they are its Assignee (#440), or
--   - it has no Assignee and they have opted in for that Board (`remind_unassigned`).
--
-- A Board with a single current member — every Private Board — behaves exactly as before, so
-- nobody's existing reminders change when this ships. The opt-in is a per-Membership preference
-- that the member sets on their own row, like `default_view`: a column grant is the mechanism, and
-- `board_memberships_update_own` already scopes it to the caller's current Membership.

alter table public.board_memberships
  add column remind_unassigned boolean not null default false;

grant update (remind_unassigned) on public.board_memberships to authenticated;

create or replace function public.reminder_candidate_rows()
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
    case when task.at_time is null then null else pg_catalog.to_char(task.at_time, 'HH24:MI') end,
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
    and task.day is not null
    and (
      task.assignee_account_id = membership.account_id
      or (task.assignee_account_id is null and membership.remind_unassigned)
      or not exists (
        select 1 from public.board_memberships other
         where other.board_id = membership.board_id
           and other.ended_at is null
           and other.id <> membership.id
      )
    );
$$;
