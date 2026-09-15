-- Reminder persistence foundation (#267).
--
-- This release is additive and intentionally ships before any client writes the new settings
-- column or subscription table. `useSettings.persist` names every field it knows, so the database
-- must accept that future payload before the Pages build containing it can be deployed.

-- ---------------------------------------------------------------------------
-- Account reminder preference
-- ---------------------------------------------------------------------------

-- NULL is off. Zero means "at the Due Moment"; the upper bound keeps a malformed client from
-- opening an unbounded sender scan while still allowing a full-week lead.
alter table public.user_settings
  add column reminder_lead_minutes int,
  add constraint user_settings_reminder_lead_range
    check (reminder_lead_minutes between 0 and 10080);

-- A server has no browser whose zone it can follow. Keep Automatic (`timezone is null`) available
-- while reminders are off, but refuse to enable delivery until the Account has selected a real
-- IANA zone. A CHECK cannot query `pg_timezone_names`, so this belongs in a trigger.
create function public.enforce_reminder_preferences()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.reminder_lead_minutes is not null
     and not exists (
       select 1
         from pg_catalog.pg_timezone_names
        where name = new.timezone
     ) then
    raise check_violation using
      constraint = 'user_settings_reminder_timezone',
      message = 'reminders require a concrete IANA timezone';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_reminder_preferences() from public;

create trigger user_settings_enforce_reminder_preferences
before insert or update on public.user_settings
for each row execute function public.enforce_reminder_preferences();

-- ---------------------------------------------------------------------------
-- Browser push subscriptions
-- ---------------------------------------------------------------------------

-- One Account may subscribe several browsers/devices. Endpoint and key material are credentials:
-- they are never replicated and RLS exposes them only to their owner. The opaque UUID, rather than
-- the endpoint, is the primary key.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null check (char_length(endpoint) between 1 and 4096),
  p256dh text not null check (char_length(p256dh) between 1 and 256),
  auth_secret text not null check (char_length(auth_secret) between 1 and 256),
  expiration_time timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_account_endpoint_uniq unique (account_id, endpoint)
);

create index push_subscriptions_account_idx on public.push_subscriptions (account_id);

create trigger push_subscriptions_set_updated_at
before update on public.push_subscriptions
for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (account_id = (select auth.uid()));
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated
  with check (account_id = (select auth.uid()));
create policy push_subscriptions_update_own on public.push_subscriptions
  for update to authenticated
  using (account_id = (select auth.uid()))
  with check (account_id = (select auth.uid()));
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated
  using (account_id = (select auth.uid()));

-- Anonymous SELECT is deliberate: RLS returns [] rather than a privilege error, matching every
-- other client table. Only authenticated Accounts may mutate their own subscriptions. The sender
-- needs read/delete so a permanent 404/410 can retire a dead endpoint.
grant select on public.push_subscriptions to anon, authenticated, service_role;
grant insert, update, delete on public.push_subscriptions to authenticated;
grant delete on public.push_subscriptions to service_role;

-- ---------------------------------------------------------------------------
-- Server-owned delivery ledger
-- ---------------------------------------------------------------------------

-- The uniqueness key is Account × Task × Due Moment. It deliberately excludes reminder lead: an
-- Account changing the lead while a window is open must not receive the same reminder twice. Due
-- Moment is derived by the sender and not persisted on the Task.
create table public.reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  due_moment timestamptz not null,
  window_opens_at timestamptz not null,
  claim_token uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminder_deliveries_account_task_due_uniq
    unique (account_id, task_id, due_moment),
  constraint reminder_deliveries_window_order
    check (window_opens_at <= due_moment),
  constraint reminder_deliveries_claim_shape
    check (
      (claim_token is null and claimed_at is null and claim_expires_at is null)
      or
      (claim_token is not null and claimed_at is not null and claim_expires_at > claimed_at)
    ),
  constraint reminder_deliveries_delivered_after_window
    check (delivered_at is null or delivered_at >= window_opens_at)
);

create index reminder_deliveries_pending_idx
  on public.reminder_deliveries (claim_expires_at, window_opens_at)
  where delivered_at is null;

create trigger reminder_deliveries_set_updated_at
before update on public.reminder_deliveries
for each row execute function public.set_updated_at();

alter table public.reminder_deliveries enable row level security;

-- A policy row keeps the structural default-deny outage check honest, while its literal false
-- makes the ledger invisible to every Account. The service role bypasses RLS and is the only
-- writer; explicit client SELECT grants preserve the API's empty-result behavior.
create policy reminder_deliveries_server_only on public.reminder_deliveries
  for select to authenticated
  using (false);

grant select on public.reminder_deliveries to anon, authenticated, service_role;
grant insert, update, delete on public.reminder_deliveries to service_role;
