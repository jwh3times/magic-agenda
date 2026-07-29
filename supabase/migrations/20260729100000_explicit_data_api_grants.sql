-- Explicit Data API grants.
--
-- `supabase/config.toml` leaves `auto_expose_new_tables` unset, so entities created in `public`
-- are NOT reachable through the Data API roles (anon, authenticated, service_role) without
-- explicit GRANTs -- the new cloud default. No earlier migration grants anything; production
-- works only because its tables were created under the legacy auto-expose behaviour. That
-- compatibility flag is REMOVED on 2026-10-30, so this file is what keeps the Data API working
-- for anything added after that date. It is a no-op against production, where these grants
-- already exist.
--
-- `anon` genuinely needs SELECT here, and RLS -- not the grant -- is what denies it. An
-- unauthenticated select must resolve to zero rows with NO error: `useSettings` branches on
-- exactly that distinction (an error means "fall back to the snapshot", no rows means "no
-- settings row yet"). Revoking anon would turn empty results into 42501 errors and silently
-- change that behaviour. tests/rls/policies.test.ts pins it.
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on public.tasks
  to anon, authenticated, service_role;

grant select, insert, update, delete on public.user_settings
  to anon, authenticated, service_role;

grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;

-- Future tables, so that forgetting is survivable. "Any migration adding a table must grant it"
-- is documentation, not enforcement; this makes the default correct. It is NOT a substitute for
-- the check in tests/rls/structure.test.ts: default privileges apply only to objects created by
-- the role this runs as, so a table created by any other role still lands ungranted.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;

alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
