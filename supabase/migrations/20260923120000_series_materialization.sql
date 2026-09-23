-- Server-side Series materialization (#424).
--
-- Until now only the client extended a Series' rolling horizon, on load, so a Board nobody with
-- write access opened for 90 days stopped showing future Occurrences — today an idle Board, and
-- with Shared Boards (#279) any Board whose Editors are away, in front of its Viewers. A daily job
-- now does the same work server-side. It runs the **client's own pure planner**
-- (`src/data/series.ts`, imported by the `materialize-series` Edge Function exactly as
-- `send-reminders` imports `dueMomentCore.ts`), so there is one definition of "which Occurrences
-- are missing", not two. These two commands are its only reach into the database.
--
-- **Invoker, not definer.** `service_role` already holds DML on `tasks` (it is not a Board table;
-- see `docs/agents/boards.md`), so neither command needs to borrow a privilege. `security invoker`
-- is strictly narrower than the definer the issue anticipated, and EXECUTE is granted to
-- `service_role` alone, so no client can call either one.

-- ---------------------------------------------------------------------------
-- series_materialization_state: what the planner needs, as one value
-- ---------------------------------------------------------------------------
-- Every Series definition as a full row, so the Edge Function maps it with the client's own
-- `rowToTask` rather than a second mapping; plus the identity of every Occurrence at or after
-- `p_from`, which is all `pendingInstances` needs to know about existing instances.
--
-- One jsonb value rather than a set of rows, because PostgREST caps a set-returning RPC at
-- `max_rows` (1000) exactly as it caps a table read, and a silently truncated state would make
-- covered Occurrences look missing. The `p_from` bound keeps it proportional to the window, not to
-- all history: the planner never proposes a day below its floor, so older Occurrences cannot matter.
create function public.series_materialization_state(p_from date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'definitions', coalesce(
      (
        select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(definition) order by definition.id)
        from public.tasks definition
        where definition.recur_parent_id is null
          and definition.recur_freq <> 'none'
          and definition.day is not null
      ),
      '[]'::jsonb
    ),
    'occurrences', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'recur_parent_id', occurrence.recur_parent_id,
            'recur_origin_day', occurrence.recur_origin_day::text,
            'day', occurrence.day::text
          )
          order by occurrence.recur_parent_id, occurrence.recur_origin_day
        )
        from public.tasks occurrence
        where occurrence.recur_parent_id is not null
          and occurrence.recur_origin_day >= p_from
      ),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.series_materialization_state(date)
  from public, anon, authenticated, service_role;
grant execute on function public.series_materialization_state(date) to service_role;

-- ---------------------------------------------------------------------------
-- insert_materialized_occurrences: a write that can race the client
-- ---------------------------------------------------------------------------
-- Rows arrive in `taskToRow`'s shape. The column list below is exactly that shape: everything the
-- client itself writes, and nothing the database owns (`created_at`, `updated_at`, `revision`, and
-- the attribution columns, which `stamp_task_attribution` stamps — `author_id` is NULL here because
-- there is no `auth.uid()`, the documented behaviour for administrative writes).
--
-- **`on conflict do nothing`, with no target, is the point of this command.** The client
-- materializes on load with a plain batch insert, and the job can run at the same moment; the
-- `(recur_parent_id, recur_origin_day)` unique index is partial, which PostgREST's `on_conflict`
-- cannot target. Untargeted, any unique violation becomes a skipped row instead of a failed batch.
--
-- The `exists` filter admits only an Occurrence of a **current Series definition on the same
-- Board**. The composite foreign key would refuse a cross-Board parent anyway, but as an error that
-- fails the whole batch; filtering makes a definition deleted mid-run cost one skipped row. A
-- deletion that commits between this statement's snapshot and its foreign-key check can still
-- fail the batch, which the job logs and the next day's run repairs.
create function public.insert_materialized_occurrences(p_rows jsonb)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  with inserted as (
    insert into public.tasks (
      id, board_id, title, description, label_id, color, checklist, status,
      completed_at, reopen_status, archived_at, day, at_time, pinned, order_index, korder,
      recur_freq, recur_interval, recur_weekdays, recur_count, recur_until,
      recur_parent_id, recur_skip, recur_origin_day
    )
    select
      candidate.id, candidate.board_id, candidate.title, candidate.description,
      candidate.label_id, candidate.color, candidate.checklist, candidate.status,
      candidate.completed_at, candidate.reopen_status, candidate.archived_at, candidate.day,
      candidate.at_time, candidate.pinned, candidate.order_index, candidate.korder,
      candidate.recur_freq, candidate.recur_interval, candidate.recur_weekdays,
      candidate.recur_count, candidate.recur_until, candidate.recur_parent_id,
      candidate.recur_skip, candidate.recur_origin_day
    from pg_catalog.jsonb_populate_recordset(null::public.tasks, p_rows) candidate
    where candidate.recur_parent_id is not null
      and candidate.recur_origin_day is not null
      and exists (
        select 1
        from public.tasks definition
        where definition.id = candidate.recur_parent_id
          and definition.board_id = candidate.board_id
          and definition.recur_parent_id is null
          and definition.recur_freq <> 'none'
      )
    on conflict do nothing
    returning 1
  )
  select pg_catalog.count(*)::integer from inserted;
$$;

revoke all on function public.insert_materialized_occurrences(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.insert_materialized_occurrences(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- The daily schedule
-- ---------------------------------------------------------------------------
-- Same shape as `send-task-reminders` (20260915070000), and deliberately the same two Vault
-- entries: the reminder function's URL with its function name swapped, and the one cron bearer
-- secret, which Supabase exposes to every Edge Function as `REMINDER_CRON_SECRET`. A second
-- secret would need its own provisioning round for a job whose worst case, if the secret leaked,
-- is an idempotent, bounded insert of Occurrences that were due to exist anyway. Rotating the
-- reminder secret rotates both, which is the intended coupling.
--
-- 03:17 UTC: off the hour, and after midnight in every zone east of UTC-3, so "tomorrow" as the
-- planner sees it has already begun for most users.
select cron.unschedule(jobid)
  from cron.job
 where jobname = 'materialize-series';

select cron.schedule(
  'materialize-series',
  '17 3 * * *',
  $$
    select net.http_post(
      url := pg_catalog.replace(
        (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'reminder_function_url'
        ),
        '/send-reminders',
        '/materialize-series'
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'reminder_cron_secret'
        )
      ),
      body := jsonb_build_object('scheduled_at', pg_catalog.now())
    );
  $$
);
