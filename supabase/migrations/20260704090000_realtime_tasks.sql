-- Realtime: stream per-user task and settings changes to signed-in clients.
-- postgres_changes respects RLS for INSERT/UPDATE (subscribers only receive rows
-- their policies allow).
--
-- DELETE is the documented exception and a CROSS-TENANT DISCLOSURE BOUNDARY, not
-- just a client-correctness quirk: Postgres cannot check a subscriber's access to
-- an already-deleted row, so every DELETE here is fanned out to ALL subscribers
-- with no owner check. Payloads are capped at the replica identity (DEFAULT), so
-- only primary keys travel: an opaque task uuid, and — for user_settings, whose PK
-- IS the auth user id — that user's real auth.users uuid on account deletion. What
-- leaks is cross-tenant activity metadata (deletion volume, timing, account
-- deletions). The ids grant nothing: every policy compares against JWT-derived
-- auth.uid(), never a client-supplied id, and the client reducer treats unknown
-- ids as no-ops.
--
-- Therefore, for any table added to this publication:
--   1. NEVER put a secret or semantically meaningful value in its primary key.
--   2. NEVER `alter table ... disable row level security` on it — that is the one
--      change that escalates this to shipping full deleted rows to every
--      subscriber. (With RLS on, Supabase caps the old record at primary keys even
--      under REPLICA IDENTITY FULL.)
-- Rejected fix, recorded so it is not re-proposed: dropping user_settings from the
-- publication breaks useSettings' INSERT/UPDATE sync, and `publish` is a
-- publication-level parameter — DELETE cannot be excluded per table. Publication
-- row filters do not help either; they are evaluated at WAL-decode time and cannot
-- reference auth.uid(). (2026-07-25 security review, Finding 2 — Low, accepted.)
-- Guarded per table: the publication may already contain a table (e.g. realtime
-- was once toggled in the dashboard), and a bare `alter publication ... add table`
-- would then 42710 and wedge the auto-applied migration pipeline.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_settings'
  ) then
    alter publication supabase_realtime add table public.user_settings;
  end if;
end $$;
