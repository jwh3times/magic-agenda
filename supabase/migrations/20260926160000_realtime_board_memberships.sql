-- ---------------------------------------------------------------------------
-- Publish board_memberships to realtime: live revocation (#439, part of #279)
-- ---------------------------------------------------------------------------
-- Nothing pushed "you were removed" to a client. RLS stops delivering a Board's Task events the
-- moment a Membership ends, so a foreground tab with a healthy channel simply went quiet and kept
-- showing — and offering edits to — a Board it no longer belonged to.
--
-- Membership administration (#438) ends Memberships with an UPDATE and never deletes them, and
-- `board_memberships_select_own` deliberately keeps ended rows visible to their own account. So with
-- the table published, each client receives exactly one signal: the UPDATE that sets `ended_at` on
-- its own row. `postgres_changes` applies that SELECT policy to INSERT and UPDATE, so no client ever
-- receives another member's row — which matters, because the row carries that member's calendar-feed
-- token (`ical_token`, #277). Each member receives only their own.
--
-- The two standing rules for a published table (see 20260704090000_realtime_tasks.sql) hold:
--   1. The primary key is a random uuid with no meaning. DELETE events are fanned out to every
--      subscriber without an owner check, and a Membership row is deleted only by the Board-deletion
--      cascade, so what leaks is that *some* Membership id somewhere was deleted — nothing more.
--      The client ignores DELETEs for ids it does not hold, so the fan-out also costs no reload.
--   2. RLS stays enabled on this table. Disabling it would ship whole deleted rows, feed tokens
--      included, to every subscriber.
--
-- Guarded like the earlier publication migrations, so a table already added through the dashboard
-- cannot 42710 and wedge the auto-applied pipeline.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_memberships'
  ) then
    alter publication supabase_realtime add table public.board_memberships;
  end if;
end
$$;
