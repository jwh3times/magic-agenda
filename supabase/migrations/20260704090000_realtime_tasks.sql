-- Realtime: stream per-user task and settings changes to signed-in clients.
-- postgres_changes respects RLS for INSERT/UPDATE (subscribers only receive rows
-- their policies allow). DELETE events carry only the primary key and are not
-- filterable — the client reducer treats unknown ids as no-ops.
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
