-- ---------------------------------------------------------------------------
-- An attachment object is readable only while a row names it
-- ---------------------------------------------------------------------------
-- Deleting a Task cascades its `task_attachments` rows and deliberately leaves the files, so Undo
-- can put the rows back (`src/data/attachments.ts`). `attachments_select_member` authorized on the
-- Board prefix alone, so those files stayed listable, downloadable, and signable by every current
-- member -- including a Viewer invited after the Task was deleted. That was weighed as dead storage
-- while every Board had one member; on a Shared Board it is disclosure of content its Owner
-- deleted.
--
-- The object policies now also require a `task_attachments` row for the object's path. The bytes
-- of a deleted Task's file are still there for Undo, and still collected by the Board sweep, but
-- no API role can see them.
--
-- Two flows read `storage.objects` under the caller's RLS and move with this:
--
-- 1. **Undo's restore.** `task_attachments_insert_editor` checked that the object exists with
--    matching metadata, as the caller. An orphan is now invisible to the caller by design, so the
--    check moves into a definer helper that answers one question about one path.
-- 2. **Removing one attachment.** Storage resolves the objects to delete under the caller's SELECT
--    policy, so the client now removes the object before the row (`removeAttachment`).
--
-- `storage_path` is unique by construction (it embeds the primary key); the index makes the
-- policy's lookup an index probe instead of a scan per object.
create unique index task_attachments_storage_path_uniq
  on public.task_attachments (storage_path);

-- The subquery runs as the caller, so `task_attachments_select_member` applies to it as well: the
-- row must be one the caller may read, which is the same Membership the prefix clause tests.
drop policy attachments_select_member on storage.objects;
create policy attachments_select_member on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] in (
      select m.board_id::text from public.board_memberships m
       where m.account_id = (select auth.uid()) and m.ended_at is null
    )
    and exists (
      select 1 from public.task_attachments a
       where a.storage_path = objects.name
    )
  );

-- Does an object exist at this path with exactly this size and MIME type? `security definer`
-- because the caller can no longer see an object that has no row, and a restore is precisely the
-- insert of that row. It reveals one bit about a path the caller must already name in full, and
-- the policy below asks it only alongside an Owner or Editor Membership of that path's Board.
-- In `app_private`, which the Data API does not expose, so it is not callable as an RPC.
create function app_private.attachment_object_matches(
  p_storage_path text,
  p_size_bytes bigint,
  p_mime_type text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from storage.objects o
     where o.bucket_id = 'attachments'
       and o.name = p_storage_path
       and (o.metadata ->> 'size')::bigint = p_size_bytes
       and o.metadata ->> 'mimetype' = p_mime_type
  );
$$;

-- Explicitly from anon and service_role, not only public (#384).
revoke all on function app_private.attachment_object_matches(text, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function app_private.attachment_object_matches(text, bigint, text)
  to authenticated;

-- Unchanged in meaning from 20260924181615: INSERT is a restore, never a second upload route. The
-- path is concatenated rather than read from `storage_path`, as before.
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
    and app_private.attachment_object_matches(
      task_attachments.board_id::text || '/' ||
      task_attachments.task_id::text || '/' ||
      task_attachments.id::text,
      task_attachments.size_bytes,
      task_attachments.mime_type
    )
  );
