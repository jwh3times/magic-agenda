-- Explicit Data API grants.
--
-- `supabase/config.toml` leaves `auto_expose_new_tables` unset, so entities created in `public`
-- are NOT reachable through the Data API roles (anon, authenticated, service_role) without
-- explicit GRANTs -- the new cloud default. No earlier migration grants anything; production
-- works only because its tables were created under the legacy auto-expose behaviour. That
-- compatibility flag is REMOVED on 2026-10-30, so this file is what keeps the Data API working
-- for anything added after that date. It is a no-op against production: a reviewer confirmed
-- production already carries the `pg_default_acl` entries that grant these two tables to
-- anon/authenticated/service_role, so restating the grants here changes nothing there.
--
-- `anon` genuinely needs SELECT here, and RLS -- not the grant -- is what denies it. An
-- unauthenticated select must resolve to zero rows with NO error: `useSettings` branches on
-- exactly that distinction (an error means "fall back to the snapshot", no rows means "no
-- settings row yet"). Revoking anon would turn empty results into 42501 errors and silently
-- change that behaviour. tests/rls/policies.test.ts pins it.
--
-- Deliberately NO `alter default privileges` in this file. That clause would auto-grant every
-- table ever created afterward by the role running migrations, forever -- so "forgot to enable
-- row-level security on a new table" would degrade from a loud `42501` into a silently
-- world-readable table through the public anon key, in a repo whose entire model is that every
-- table default-denies until proven otherwise. Without it, a new table is simply unreachable
-- until it is granted right here, in this file: a loud error a developer hits the moment they
-- touch the Data API, not a leak someone discovers later. The structural test in
-- tests/rls/structure.test.ts ("every table in public is reachable by the Data API roles") is the
-- backstop that catches a table which shipped without its grant.
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on public.tasks
  to anon, authenticated, service_role;

grant select, insert, update, delete on public.user_settings
  to anon, authenticated, service_role;

grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;
