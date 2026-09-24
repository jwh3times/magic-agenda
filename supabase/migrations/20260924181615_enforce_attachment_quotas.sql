-- Attachment uploads are commands now (#400).
--
-- Supabase Storage evaluates INSERT RLS before it has the authoritative object metadata, then
-- completes the upload as its superuser. A client can therefore omit or misstate the size seen by
-- the policy, and an RLS-only aggregate quota is bypassable. Remove both client write paths: the
-- upload Edge Function authenticates the caller, reserves quota transactionally, and writes the
-- object with service-role only. SELECT and DELETE remain membership-scoped so members can view
-- files and Editors can keep using the row-first attachment deletion flow.
drop policy attachments_insert_editor on storage.objects;
drop policy attachments_update_editor on storage.objects;

-- INSERT stays available for Undo (#404), which restores a row for an object deliberately left in
-- storage when its Task was deleted. The object must already exist, and its authoritative metadata
-- must match exactly. That makes direct INSERT a restore operation rather than a second upload
-- route, and removes `size_bytes` / `mime_type` as client assertions.
drop policy task_attachments_insert_editor on public.task_attachments;
create policy task_attachments_insert_editor on public.task_attachments
  for insert to authenticated
  with check (
    board_id in (
      select m.board_id
        from public.board_memberships m
       where m.account_id = (select auth.uid())
         and m.ended_at is null
         and m.role in ('owner', 'editor')
    )
    and exists (
      select 1
        from storage.objects o
       where o.bucket_id = 'attachments'
         and o.name = (
           task_attachments.board_id::text || '/' ||
           task_attachments.task_id::text || '/' ||
           task_attachments.id::text
         )
         and (o.metadata ->> 'size')::bigint = task_attachments.size_bytes
         and o.metadata ->> 'mimetype' = task_attachments.mime_type
    )
  );

-- A service-created reservation carries the verified caller explicitly. Direct Data API clients
-- still cannot name `uploaded_by` because its column is absent from their INSERT grant, so
-- preserving a non-null internal value does not make attribution client-asserted.
create or replace function public.stamp_attachment_uploader()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.uploaded_by := coalesce(new.uploaded_by, auth.uid());
  return new;
end;
$$;

revoke execute on function public.stamp_attachment_uploader()
  from public, anon, authenticated, service_role;

create function public.cancel_attachment_upload(
  p_account_id uuid,
  p_attachment_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.task_attachments a
   where a.id = p_attachment_id
     and a.uploaded_by = p_account_id
     and not exists (
       select 1
         from storage.objects o
        where o.bucket_id = 'attachments'
          and o.name = a.storage_path
     );
$$;

revoke execute on function public.cancel_attachment_upload(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_attachment_upload(uuid, uuid)
  to service_role;

create function public.reserve_attachment_upload(
  p_account_id uuid,
  p_attachment_id uuid,
  p_board_id uuid,
  p_task_id uuid,
  p_filename text,
  p_mime_type text,
  p_size_bytes bigint
)
returns public.task_attachments
language plpgsql
security definer
set search_path = ''
as $$
declare
  reserved public.task_attachments;
  used_bytes bigint;
  used_objects bigint;
begin
  if not exists (
    select 1
      from public.board_memberships m
     where m.board_id = p_board_id
       and m.account_id = p_account_id
       and m.ended_at is null
       and m.role in ('owner', 'editor')
  ) then
    raise insufficient_privilege using message = 'attachment_upload_forbidden';
  end if;

  -- Serialize reservations for one Board. A hash collision only serializes two unrelated Boards;
  -- it cannot weaken the quota. Holding the transaction lock through the aggregate and INSERT is
  -- what stops two uploads just below the limit from both being admitted.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_board_id::text, 0)
  );

  select coalesce(sum(usage.size_bytes), 0), count(*)
    into used_bytes, used_objects
    from (
      -- The object row is authoritative once upload completes, including legacy orphans that have
      -- no task_attachments row at all.
      select o.name as storage_path, (o.metadata ->> 'size')::bigint as size_bytes
        from storage.objects o
       where o.bucket_id = 'attachments'
         and (storage.foldername(o.name))[1] = p_board_id::text

      union all

      -- Before the service-role upload finishes, the reservation row is the only durable fact.
      -- Count only recent missing-object rows: a crashed command must not consume quota forever.
      -- Once its object appears, NOT EXISTS drops the reservation half so each attachment counts
      -- exactly once.
      select a.storage_path, a.size_bytes
        from public.task_attachments a
       where a.board_id = p_board_id
         and a.created_at >= pg_catalog.now() - interval '15 minutes'
         and not exists (
           select 1
             from storage.objects o
            where o.bucket_id = 'attachments'
              and o.name = a.storage_path
         )
    ) usage;

  if used_objects >= 1000 then
    raise check_violation using message = 'attachment_object_quota_exceeded';
  end if;
  if used_bytes + p_size_bytes > 104857600 then
    raise check_violation using message = 'attachment_byte_quota_exceeded';
  end if;

  insert into public.task_attachments (
    id,
    board_id,
    task_id,
    filename,
    mime_type,
    size_bytes,
    uploaded_by
  ) values (
    p_attachment_id,
    p_board_id,
    p_task_id,
    p_filename,
    p_mime_type,
    p_size_bytes,
    p_account_id
  )
  returning * into reserved;

  return reserved;
end;
$$;

revoke execute on function public.reserve_attachment_upload(
  uuid, uuid, uuid, uuid, text, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.reserve_attachment_upload(
  uuid, uuid, uuid, uuid, text, text, bigint
) to service_role;
