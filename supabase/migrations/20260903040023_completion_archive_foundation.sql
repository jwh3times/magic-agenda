-- Add only nullable persistence in this release. The deployed client neither reads nor writes
-- these fields, so existing rows and every current payload remain valid while the migration and
-- Pages deployment race. Completion lifecycle semantics, backfill, and enforcement land later.
alter table public.tasks
  add column completed_at timestamptz,
  add column reopen_status text,
  add column archived_at timestamptz,
  add constraint tasks_reopen_status_active
    check (reopen_status in ('todo', 'doing'));
