-- Per-device Reminder outcomes (#267).
--
-- A delivery is Account × Task × Due Moment; its targets are the devices that existed when a
-- sender claimed it. Keeping target outcomes separately lets a retry skip devices that already
-- accepted the push while retrying only transient failures on the others.

alter table public.reminder_deliveries
  add column suppressed_at timestamptz,
  add column suppression_reason text
    check (suppression_reason in ('completed', 'rescheduled', 'ineligible')),
  add constraint reminder_deliveries_suppression_shape
    check ((suppressed_at is null) = (suppression_reason is null)),
  add constraint reminder_deliveries_one_terminal_outcome
    check (delivered_at is null or suppressed_at is null);

create table public.reminder_delivery_targets (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.reminder_deliveries (id) on delete cascade,
  subscription_id uuid references public.push_subscriptions (id) on delete set null,
  endpoint_hash text not null check (char_length(endpoint_hash) = 43),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'dead')),
  attempt_count int not null default 0 check (attempt_count between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  last_status_code int check (last_status_code between 100 and 599),
  last_error text check (char_length(last_error) <= 500),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminder_delivery_targets_delivery_endpoint_uniq unique (delivery_id, endpoint_hash),
  constraint reminder_delivery_targets_claim_shape
    check (
      (claim_token is null and claimed_at is null and claim_expires_at is null)
      or
      (claim_token is not null and claimed_at is not null and claim_expires_at > claimed_at)
    ),
  constraint reminder_delivery_targets_success_shape
    check ((status = 'succeeded') = (delivered_at is not null))
);

create index reminder_delivery_targets_pending_idx
  on public.reminder_delivery_targets (next_attempt_at, claim_expires_at)
  where status = 'pending';

create trigger reminder_delivery_targets_set_updated_at
before update on public.reminder_delivery_targets
for each row execute function public.set_updated_at();

alter table public.reminder_delivery_targets enable row level security;

create policy reminder_delivery_targets_server_only on public.reminder_delivery_targets
  for select to authenticated
  using (false);

grant select on public.reminder_delivery_targets to anon, authenticated, service_role;
grant insert, update, delete on public.reminder_delivery_targets to service_role;
