-- Attribution is evidence about a write, never a client assertion or an authorization input.
-- Existing attribution is not backfilled: we cannot infer historical authorship from containment.
create function public.stamp_task_attribution()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    new.author_kind := 'author';
    new.revision := 1;
  else
    new.revision := old.revision + 1;
    -- Leave author_id alone on UPDATE. The column grant prevents client forgery, while the
    -- foreign key must still be able to SET NULL when an author deletes their account.
  end if;
  new.last_editor_id := auth.uid();
  return new;
end;
$$;

revoke all on function public.stamp_task_attribution() from public;

create trigger tasks_stamp_attribution
before insert or update on public.tasks
for each row execute function public.stamp_task_attribution();

-- PostgREST upserts include every supplied column in both INSERT and UPDATE. Keep the full
-- taskToRow payload writable, including id; defaults/triggers own attribution and timestamps.
-- RLS still decides which Boards the caller can write. Administrative grants are unchanged.
revoke insert, update on public.tasks from authenticated;
grant insert (
  id, board_id, title, description, label_id, color, checklist, status,
  completed_at, reopen_status, archived_at, day, at_time, pinned, order_index, korder,
  recur_freq, recur_interval, recur_until, recur_parent_id, recur_skip, recur_origin_day
) on public.tasks to authenticated;
grant update (
  id, board_id, title, description, label_id, color, checklist, status,
  completed_at, reopen_status, archived_at, day, at_time, pinned, order_index, korder,
  recur_freq, recur_interval, recur_until, recur_parent_id, recur_skip, recur_origin_day
) on public.tasks to authenticated;
