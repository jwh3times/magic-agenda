-- ---------------------------------------------------------------------------
-- apply_task_writes: one transaction per plan, and no upsert anywhere (#434, part of #279)
-- ---------------------------------------------------------------------------
-- The pure planners in `src/data/series.ts` return plans — rows to write, then deletions — that the
-- client used to execute as several independent requests, most of them upserts. With two writers
-- that breaks in two ways:
--
-- 1. **A half-applied plan.** A Series edit is a definition row plus its Occurrences plus trimming
--    deletions. Separate requests could land some and not others, or interleave with another
--    member's edit to the same Series between steps.
-- 2. **Resurrection.** An upsert of a row another member just deleted silently re-creates it. Every
--    reorder, roll-forward, bulk change, and Series edit wrote that way.
--
-- This command executes a whole plan in one call, and so in one transaction, in a fixed order:
--
--   a. `p_expected` — `[{id, revision}]`, the Series definitions the plan was computed against — is
--      locked (`for update`) and checked. A mismatch raises `stale-revision` and nothing is written.
--      Two concurrent Series edits therefore serialize, and the second is refused, not merged.
--   b. `p_inserts` — rows that are genuinely new (a new definition, new Occurrences, rows Undo puts
--      back) — `on conflict do nothing`, untargeted: an id that exists, or an Occurrence another
--      client or the daily job already produced, is skipped, never overwritten.
--   c. `p_updates` — rows that already exist — **UPDATE only**. A row deleted meanwhile matches
--      nothing and stays deleted; the client sees it missing from the result and reloads.
--   d. `p_deletions` — `{by: 'id'|'ids'|'occurrence-after'|'occurrence-from', …}`, the planner's own
--      `DeletionTarget` shape.
--
-- It returns every row inserted or updated, post-trigger, for the client to reconcile.
--
-- **Security invoker, deliberately.** It runs as the caller, so the Task RLS policies and the
-- column grants remain the whole authority — a definer would have to re-implement both. Every
-- statement is also scoped to `p_board_id`, and the composite foreign key keeps a Series on one
-- Board (`(board_id, recur_parent_id) -> (board_id, id)`), so a plan cannot split one across Boards.
-- The column list is exactly `taskToRow`'s: what the client writes, nothing the database stamps.

create function public.apply_task_writes(
  p_board_id uuid,
  p_expected jsonb,
  p_inserts jsonb,
  p_updates jsonb,
  p_deletions jsonb
)
returns setof public.tasks
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  expectation jsonb;
  current_revision bigint;
  deletion jsonb;
begin
  for expectation in select * from pg_catalog.jsonb_array_elements(coalesce(p_expected, '[]'::jsonb))
  loop
    select task.revision into current_revision
      from public.tasks task
     where task.id = (expectation->>'id')::uuid
       and task.board_id = p_board_id
       for update;
    if current_revision is null
       or current_revision <> (expectation->>'revision')::bigint then
      raise exception using errcode = 'P0001', message = 'stale-revision';
    end if;
  end loop;

  return query
    insert into public.tasks (
      id, board_id, title, description, label_id, assignee_account_id, color, checklist, status,
      completed_at, reopen_status, archived_at, day, at_time, pinned, order_index, korder,
      recur_freq, recur_interval, recur_weekdays, recur_count, recur_until,
      recur_parent_id, recur_skip, recur_origin_day
    )
    select
      row_.id, p_board_id, row_.title, row_.description, row_.label_id, row_.assignee_account_id,
      row_.color, row_.checklist, row_.status, row_.completed_at, row_.reopen_status,
      row_.archived_at, row_.day, row_.at_time, row_.pinned, row_.order_index, row_.korder,
      row_.recur_freq, row_.recur_interval, row_.recur_weekdays, row_.recur_count,
      row_.recur_until, row_.recur_parent_id, row_.recur_skip, row_.recur_origin_day
    from pg_catalog.jsonb_populate_recordset(null::public.tasks, coalesce(p_inserts, '[]'::jsonb))
      with ordinality as row_
    order by row_.ordinality
    on conflict do nothing
    returning *;

  return query
    update public.tasks task
       set title = row_.title,
           description = row_.description,
           label_id = row_.label_id,
           assignee_account_id = row_.assignee_account_id,
           color = row_.color,
           checklist = row_.checklist,
           status = row_.status,
           completed_at = row_.completed_at,
           reopen_status = row_.reopen_status,
           archived_at = row_.archived_at,
           day = row_.day,
           at_time = row_.at_time,
           pinned = row_.pinned,
           order_index = row_.order_index,
           korder = row_.korder,
           recur_freq = row_.recur_freq,
           recur_interval = row_.recur_interval,
           recur_weekdays = row_.recur_weekdays,
           recur_count = row_.recur_count,
           recur_until = row_.recur_until,
           recur_parent_id = row_.recur_parent_id,
           recur_skip = row_.recur_skip,
           recur_origin_day = row_.recur_origin_day
      from pg_catalog.jsonb_populate_recordset(null::public.tasks, coalesce(p_updates, '[]'::jsonb))
        as row_
     where task.id = row_.id
       and task.board_id = p_board_id
    returning task.*;

  for deletion in select * from pg_catalog.jsonb_array_elements(coalesce(p_deletions, '[]'::jsonb))
  loop
    case deletion->>'by'
      when 'id' then
        delete from public.tasks task
         where task.board_id = p_board_id and task.id = (deletion->>'id')::uuid;
      when 'ids' then
        delete from public.tasks task
         where task.board_id = p_board_id
           and task.id in (
             select (value #>> '{}')::uuid
               from pg_catalog.jsonb_array_elements(deletion->'ids') as value
           );
      when 'occurrence-after' then
        delete from public.tasks task
         where task.board_id = p_board_id
           and task.recur_parent_id = (deletion->>'parentId')::uuid
           and task.recur_origin_day > (deletion->>'day')::date;
      when 'occurrence-from' then
        delete from public.tasks task
         where task.board_id = p_board_id
           and task.recur_parent_id = (deletion->>'parentId')::uuid
           and task.recur_origin_day >= (deletion->>'day')::date;
      else
        raise exception using errcode = 'P0001', message = 'invalid-deletion';
    end case;
  end loop;
end;
$$;

revoke all on function public.apply_task_writes(uuid, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_task_writes(uuid, jsonb, jsonb, jsonb, jsonb) to authenticated;
