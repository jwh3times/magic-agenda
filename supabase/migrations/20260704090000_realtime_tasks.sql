-- Realtime: stream per-user task and settings changes to signed-in clients.
-- postgres_changes respects RLS for INSERT/UPDATE (subscribers only receive rows
-- their policies allow). DELETE events carry only the primary key and are not
-- filterable — the client reducer treats unknown ids as no-ops.
alter publication supabase_realtime add table public.tasks, public.user_settings;
