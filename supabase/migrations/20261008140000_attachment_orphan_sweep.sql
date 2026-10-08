-- ---------------------------------------------------------------------------
-- Sweep attachment objects that no row names
-- ---------------------------------------------------------------------------
-- 20261008120000 made a row-less object unreadable. It is still stored, still counted by the
-- attachment quota, and no API role can remove it any more. This is the cleanup #278 left for
-- later: a daily job that deletes the bytes.
--
-- **Two runs, never one.** Undo restores a deleted Task's attachments by re-inserting their rows,
-- so an object must not be removed in the same moment it becomes row-less. `storage.objects` has
-- no "orphaned since", so the command records when it first saw an object without a row and
-- offers it for removal only on a later call, after a grace period. A restore in between drops
-- the mark.
--
-- The command only decides. The `sweep-attachments` Edge Function does the removing, because
-- Supabase forbids direct DML on the storage tables and the Storage API is the supported path.

-- Not in `public`: nothing reads this through the Data API, and `app_private` is not exposed.
-- RLS is enabled with no policy and every API grant is revoked, so only the definer below
-- reaches it.
create table app_private.attachment_orphan_marks (
  storage_path text primary key,
  first_seen timestamptz not null default now()
);
alter table app_private.attachment_orphan_marks enable row level security;
revoke all on table app_private.attachment_orphan_marks from public, anon, authenticated, service_role;

-- Returns the paths that are safe to remove now: row-less on an earlier call, still row-less, and
-- first seen more than `p_grace_seconds` ago. `security definer` because it reads
-- `storage.objects` and the marks; granted to `service_role` only, like the other cron commands.
create function public.collect_attachment_orphans(p_grace_seconds integer, p_limit integer)
returns setof text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_grace_seconds is null or p_grace_seconds < 0 or p_limit is null or p_limit < 1 then
    raise exception using errcode = '22023', message = 'invalid-argument';
  end if;

  -- Forget marks that no longer describe an orphan: the row came back (Undo), or the object is
  -- gone (swept by an earlier run, or by Board deletion).
  delete from app_private.attachment_orphan_marks mark
   where exists (
           select 1 from public.task_attachments a where a.storage_path = mark.storage_path
         )
      or not exists (
           select 1 from storage.objects o
            where o.bucket_id = 'attachments' and o.name = mark.storage_path
         );

  -- Offer what an earlier call marked. Selected before this call's own marks are written, so an
  -- object is never marked and offered by the same call, whatever the grace period.
  return query
    select mark.storage_path
      from app_private.attachment_orphan_marks mark
     where mark.first_seen <= pg_catalog.now() - pg_catalog.make_interval(secs => p_grace_seconds)
     order by mark.first_seen, mark.storage_path
     limit p_limit;

  insert into app_private.attachment_orphan_marks (storage_path)
  select o.name
    from storage.objects o
   where o.bucket_id = 'attachments'
     and not exists (
           select 1 from public.task_attachments a where a.storage_path = o.name
         )
  on conflict do nothing;
end;
$$;

-- Explicitly from anon and service_role, not only public (#384).
revoke all on function public.collect_attachment_orphans(integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.collect_attachment_orphans(integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- The daily schedule
-- ---------------------------------------------------------------------------
-- Same shape as `materialize-series` (20260923120000) and the same two Vault entries: the reminder
-- function's URL with its function name swapped, and the one cron bearer secret. The worst case if
-- that secret leaked is an early run of a job that removes only files nobody can read.
select cron.unschedule(jobid)
  from cron.job
 where jobname = 'sweep-attachments';

select cron.schedule(
  'sweep-attachments',
  '47 3 * * *',
  $$
    select net.http_post(
      url := pg_catalog.replace(
        (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'reminder_function_url'
        ),
        '/send-reminders',
        '/sweep-attachments'
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
