-- Magic Agenda — initial schema (Phase 6)
-- Tables: tasks, user_settings. Per-user isolation via Row-Level Security.
-- Note: SQL `order` is reserved, so the calendar order column is `order_index`.
--       `done` is derived in the app (status = 'done') and is NOT stored.
--       Day NULL = inbox / unscheduled (the app's 'inbox' sentinel maps to NULL here).

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '',
  description text not null default '',
  category text not null default 'work'
    check (category in ('work', 'personal', 'errands', 'ideas', 'health')),
  color text not null default 'yellow'
    check (color in ('yellow', 'pink', 'blue', 'mint', 'lilac', 'orange')),
  checklist jsonb not null default '[]'::jsonb,          -- [{ id, text, done }]
  status text not null default 'todo'
    check (status in ('todo', 'doing', 'done')),
  day date,                                              -- NULL = inbox / unscheduled
  order_index int not null default 0,                    -- order within a day (calendar/week)
  korder int not null default 0,                         -- order within a status (kanban)
  recur_freq text not null default 'none'
    check (recur_freq in ('none', 'daily', 'weekly', 'monthly')),
  recur_interval int not null default 1,
  recur_until date,
  recur_parent_id uuid references public.tasks (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_user_day_idx on public.tasks (user_id, day, order_index);
create index tasks_user_status_idx on public.tasks (user_id, status, korder);

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- RLS: default-deny once enabled, then scope every operation to the owner.
alter table public.tasks enable row level security;

create policy tasks_select_own on public.tasks
  for select using (auth.uid() = user_id);
create policy tasks_insert_own on public.tasks
  for insert with check (auth.uid() = user_id);
create policy tasks_update_own on public.tasks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy tasks_delete_own on public.tasks
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- user_settings
-- ---------------------------------------------------------------------------
create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  theme text not null default 'cork'
    check (theme in ('cork', 'brutal', 'glass')),
  default_view text not null default 'calendar'
    check (default_view in ('calendar', 'week', 'agenda', 'kanban')),
  updated_at timestamptz not null default now()
);

create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

alter table public.user_settings enable row level security;

create policy user_settings_select_own on public.user_settings
  for select using (auth.uid() = user_id);
create policy user_settings_insert_own on public.user_settings
  for insert with check (auth.uid() = user_id);
create policy user_settings_update_own on public.user_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Auto-create a settings row when a user signs up.
-- security definer so it can insert past RLS during the auth trigger.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
