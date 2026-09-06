-- Bound per-task content even for clients that bypass the editor. Production was preflighted
-- with counts for each predicate before this migration; no existing rows needed correction.
-- JSON text bytes are stable across TOAST compression (pg_column_size is not) and measurable
-- in the editor. CASE keeps malformed JSON from calling jsonb_array_length on a scalar/object.
alter table public.tasks
  add constraint tasks_title_length check (char_length(title) <= 500),
  add constraint tasks_description_length check (char_length(description) <= 20000),
  add constraint tasks_checklist_limits check (
    case when jsonb_typeof(checklist) = 'array' then
      jsonb_array_length(checklist) <= 200 and octet_length(checklist::text) <= 65536
    else false end
  ),
  add constraint tasks_recur_interval_range check (recur_interval between 1 and 366);
