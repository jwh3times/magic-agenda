-- Recurrence support (Phase 9c).
-- A recurring series is a hidden "template" row (recur_freq != 'none', recur_parent_id null) plus
-- materialized instance rows (recur_freq 'none', recur_parent_id = template id). recur_skip holds
-- the dates of deleted occurrences so they are not regenerated.

alter table public.tasks
  add column recur_skip jsonb not null default '[]'::jsonb;

-- At most one materialized instance per (template, day).
create unique index tasks_recur_instance_uniq
  on public.tasks (recur_parent_id, day)
  where recur_parent_id is not null;
