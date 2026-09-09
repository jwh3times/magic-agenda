-- Account-level administration is separate from Board Membership. Admins can
-- manage rollout flags, not bypass Board authorization. Seed roles through SQL only.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated, service_role;
grant usage on schema app_private to authenticated;

create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin'))
);
alter table public.user_roles enable row level security;
revoke all on public.user_roles from anon, authenticated, service_role;
grant select on public.user_roles to anon, authenticated;
create policy user_roles_select_own on public.user_roles
  for select to authenticated using (user_id = (select auth.uid()));

-- No account argument: this helper can only answer for the caller. The schema
-- stays outside config.toml's API schemas, despite the grant needed by policies.
create function app_private.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = 'admin'
  );
$$;
revoke all on function app_private.is_admin() from public, anon, authenticated, service_role;
grant execute on function app_private.is_admin() to authenticated;

create table public.feature_flags (
  key text primary key check (length(btrim(key)) between 1 and 100),
  enabled boolean not null default false,
  description text not null default ''
);
alter table public.feature_flags enable row level security;
revoke all on public.feature_flags from anon, authenticated, service_role;
grant select on public.feature_flags to anon, authenticated;
grant insert (key, enabled, description), update (enabled, description), delete
  on public.feature_flags to authenticated;
create policy feature_flags_select_authenticated on public.feature_flags
  for select to authenticated using (true);
create policy feature_flags_insert_admin on public.feature_flags
  for insert to authenticated with check ((select app_private.is_admin()));
create policy feature_flags_update_admin on public.feature_flags
  for update to authenticated using ((select app_private.is_admin()))
  with check ((select app_private.is_admin()));
create policy feature_flags_delete_admin on public.feature_flags
  for delete to authenticated using ((select app_private.is_admin()));

-- Neither table is realtime-published or included in offline snapshots. A flag
-- is a UI rollout choice, never an authorization boundary; RLS checks live roles.
