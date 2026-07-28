-- Week start + timezone for the settings page (roadmap 4.1).
--
-- `timezone` is an IANA id; NULL means "follow whatever browser the user is on", which is the
-- behavior every existing row already has. Item 3.2's server-side reminder sender cannot read
-- NULL as "browser" -- it has no browser -- so that flow will have to prompt for a concrete zone.
--
-- No CHECK on `timezone`: a CHECK constraint cannot reference `pg_timezone_names`, and a bad
-- value only ever affects its own owner, where the client falls back to browser-local.
--
-- `user_settings` is in the `supabase_realtime` publication. Neither column is part of the
-- primary key, so the standing "no secrets in a replicated PK" rule is unaffected.
alter table public.user_settings
  add column if not exists week_start int not null default 0,
  add column if not exists timezone text;

alter table public.user_settings
  drop constraint if exists user_settings_week_start_range;

alter table public.user_settings
  add constraint user_settings_week_start_range check (week_start between 0 and 6);
