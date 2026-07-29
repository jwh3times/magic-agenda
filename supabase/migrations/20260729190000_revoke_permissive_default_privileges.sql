-- Revoke the permissive Data API default privileges inherited from the legacy auto-expose era.
--
-- Production carries `pg_default_acl` entries granting `anon` and `authenticated` the full DML
-- set (arwdDxtm -- SELECT/INSERT/UPDATE/DELETE, plus TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) on
-- every table created in `public`, for BOTH the `postgres` and `supabase_admin` creator roles.
-- Those entries predate 20260729100000_explicit_data_api_grants.sql, and they are exactly the
-- thing that file's fail-closed premise assumed away: it was verified on a fresh local stack,
-- whose defaults are already restrictive, and never in production, where it turned out false.
-- Confirmed 2026-07-29 by querying pg_default_acl on production directly.
--
-- What that means without this file: any table created in `public` is world-readable AND
-- writable through the public anon key from the moment it exists, and the only thing standing
-- between that and a breach is remembering `enable row level security` on it. This is not
-- hypothetical tidiness -- it is the single assumption the whole grants design rests on.
--
-- `authenticated` is revoked for the same reason as `anon`, not as belt-and-braces: signup is
-- open (email confirmation and Google OAuth), so `authenticated` is `anon` plus one free
-- registration. A future table missing RLS would be readable by any stranger who signs up.
--
-- This changes NOTHING about existing tables. Default privileges are a template consulted at
-- CREATE time and are never applied retroactively, so `tasks` and `user_settings` keep the
-- explicit grants 20260729100000 gave them and the running app is unaffected.
--
-- Deliberately narrow -- only the four DML privileges, never `revoke all`. `all` would also
-- strip Dxtm, and REFERENCES in particular matters for future foreign keys while granting no
-- access to data.
--
-- `service_role` is deliberately untouched. It is meant to bypass this boundary: the Edge
-- Functions hold the service key precisely so they can do what the anon key must not.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;

-- The same for `supabase_admin`, which owns tables the platform creates (Studio, some
-- extensions). On Supabase `postgres` is not a superuser and may not be a member of
-- `supabase_admin`, in which case this statement is not ours to run and raises
-- `insufficient_privilege`. That is caught and reported rather than failing the deploy, because
-- the `postgres` revoke above already covers every table this repo's migrations create -- the
-- exposure that actually matters here.
--
-- If the SKIPPED notice appears in the `Deploy Migrations` log, the residual gap is real but
-- narrow: tables created out-of-band by the platform in `public` would still be auto-granted.
-- Closing that needs the dashboard or Supabase support, and `tests/rls/structure.test.ts` cannot
-- see it, because CI always runs against a fresh stack whose defaults are already restrictive.
do $do$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke select, insert, update, delete on tables from anon, authenticated';
  raise notice 'revoked supabase_admin default privileges on tables in public';
exception
  when insufficient_privilege then
    raise notice 'SKIPPED supabase_admin default privileges: insufficient privilege. Expected where postgres is not a member of supabase_admin. Residual gap: platform-created tables in public remain auto-granted to anon/authenticated.';
end
$do$;
