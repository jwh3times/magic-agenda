-- Task attachments: storage bucket, object policies, and the `task_attachments` table (#278).
--
-- Database foundation only. Nothing user-visible ships here: there is no client code that writes
-- to this table yet. That split is deliberate -- every authorization decision for this feature
-- lives in this file, and reviewing it apart from editor UI is the point.

-- ---------------------------------------------------------------------------
-- 1. The bucket
-- ---------------------------------------------------------------------------
-- Created here rather than declared in `config.toml`, for two reasons. The bucket and the policies
-- below are one unit -- a bucket reachable with no policy, or a policy naming a bucket that does
-- not exist, is a half-built boundary -- and a migration puts them in the same transaction.
-- `config.toml`'s `[storage.buckets.*]` is local scaffolding; `Deploy Auth Config` is not the
-- pipeline that should own an authorization surface.
--
-- `public = false` is the whole security posture of the bucket: every read goes through a signed
-- URL minted for a caller who passed the policies below. A public bucket would make each of those
-- policies decorative, because the object URL alone would serve the file.
--
-- `file_size_limit` and `allowed_mime_types` are enforced by the storage API itself, so they hold
-- for a caller who bypasses our client entirely. The matching CHECKs on the table below are the
-- second half of the same rule, and neither makes the other redundant: the bucket governs the
-- bytes, the table governs the row that claims to describe them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  10485760, -- 10 MiB, matching task_attachments_size_within_limit below
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Object policies, keyed on the path prefix
-- ---------------------------------------------------------------------------
-- Object paths are `<board_id>/<task_id>/<attachment_id>` -- the correction the issue calls for.
-- The roadmap's original `userId/taskId/filename` predates the authorization cutover: Tasks are
-- contained by Board, `tasks.user_id` is gone, and a user-prefixed path would reintroduce exactly
-- the two-ownership-models trap that `board_id = NULL` was rejected for.
--
-- **The human filename is deliberately NOT in the path.** It lives in the table instead, which
-- removes a whole class of problem rather than mitigating it: no traversal sequences to strip, no
-- Unicode normalization to get right, no collision when two uploads share a name, and a rename is
-- a column update rather than a move. The object name is an opaque uuid we generated.
--
-- The prefix is compared **as text**, never cast to uuid. `(storage.foldername(name))[1]::uuid`
-- would raise 22P02 on a malformed path -- turning a denial into an error, and handing a caller a
-- way to tell "no such board" apart from "not a uuid".
--
-- Scoped to `bucket_id = 'attachments'` in every policy, so nothing here widens any other bucket.

-- Read: any current member, whatever their role. Viewers included -- that is what Viewer means,
-- and it matches `tasks_select_member`.
create policy attachments_select_member on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] in (
      select m.board_id::text from public.board_memberships m
       where m.account_id = (select auth.uid()) and m.ended_at is null
    )
  );

-- Write: Owner or Editor, mirroring `tasks_insert_editor` / `tasks_delete_editor`. A Viewer is
-- read-only, and this is where that is enforced rather than merely rendered.
create policy attachments_insert_editor on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] in (
      select m.board_id::text from public.board_memberships m
       where m.account_id = (select auth.uid())
         and m.ended_at is null
         and m.role in ('owner', 'editor')
    )
  );

-- UPDATE needs both clauses for the same reason `tasks_update_editor` does: `using` decides which
-- objects may be targeted, `with check` decides what they may become. Without the second, an
-- editable object could be renamed into another Board's prefix -- moving a file across the
-- boundary the INSERT policy guards.
create policy attachments_update_editor on storage.objects
  for update to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] in (
      select m.board_id::text from public.board_memberships m
       where m.account_id = (select auth.uid())
         and m.ended_at is null
         and m.role in ('owner', 'editor')
    )
  )
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] in (
      select m.board_id::text from public.board_memberships m
       where m.account_id = (select auth.uid())
         and m.ended_at is null
         and m.role in ('owner', 'editor')
    )
  );

create policy attachments_delete_editor on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] in (
      select m.board_id::text from public.board_memberships m
       where m.account_id = (select auth.uid())
         and m.ended_at is null
         and m.role in ('owner', 'editor')
    )
  );

-- ---------------------------------------------------------------------------
-- 3. `task_attachments`
-- ---------------------------------------------------------------------------
-- A table rather than jsonb on `tasks`, per the issue: deletes cascade, and a quota stays
-- queryable. A jsonb array would make "how many bytes does this Board hold" a scan-and-parse.
create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null,
  task_id uuid not null,

  -- Fully derived, so it cannot drift from the row that owns it. A plain column would let an
  -- UPDATE point the row at another Board's object while leaving `board_id` alone -- which the
  -- policies below would then happily authorize, because they read `board_id`. Generated STORED
  -- removes that gap by construction rather than by a CHECK someone could relax later.
  storage_path text generated always as (
    board_id::text || '/' || task_id::text || '/' || id::text
  ) stored,

  filename text not null,
  mime_type text not null,
  size_bytes bigint not null,

  -- Attribution, not authorization. `on delete set null` so a deleted account leaves the
  -- attachment reachable by the Board rather than cascading a file away from people still using
  -- it -- the same call `tasks.author_id` makes.
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  -- **This composite FK is the load-bearing line in the table.** Referencing `tasks (board_id, id)`
  -- through `tasks_board_id_uniq` makes "the attachment's Board is the task's Board" a structural
  -- guarantee rather than something the application remembers -- the same device
  -- `tasks_label_same_board` and `tasks_recur_parent_same_board` already use. Without it, a row
  -- could name task X and board Y, and every policy here reads `board_id`.
  --
  -- `on delete cascade` is the issue's "task delete produces a DB cascade": the rows go with the
  -- task, and the storage objects are cleaned up best-effort by the client (PR 2), with orphans
  -- accepted and a scheduled sweep left for later.
  constraint task_attachments_task_same_board
    foreign key (board_id, task_id) references public.tasks (board_id, id) on delete cascade,

  -- The table half of the bucket's own limits. Both exist deliberately -- see the bucket comment.
  constraint task_attachments_size_within_limit
    check (size_bytes > 0 and size_bytes <= 10485760),
  constraint task_attachments_mime_allowed
    check (mime_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf')),
  constraint task_attachments_filename_nonempty
    check (char_length(filename) between 1 and 255)
);

-- Covers the composite FK as a **leading prefix** -- `(board_id, task_id)`, in that order -- which
-- is what PostgreSQL needs to avoid scanning this table on every task delete. A per-column index
-- on `task_id` alone would not cover it, and a coverage check that compares each FK column against
-- an index's first column reports a false positive here; compare against the leading prefix.
-- It doubles as the lookup index for "the attachments of this task", which is every read the UI does.
create index task_attachments_board_task_idx on public.task_attachments (board_id, task_id);

-- `uploaded_by` references `auth.users` with `on delete set null`, so without this every account
-- deletion scans this table -- the same finding #385 fixed on `tasks`. Added at birth rather than
-- discovered by an advisor later.
create index task_attachments_uploaded_by_idx on public.task_attachments (uploaded_by);

alter table public.task_attachments enable row level security;

-- Membership-scoped, mirroring `tasks` exactly: read for any current member, write for Owner or
-- Editor. INSERT's `with check` stops a member of Board A filing an attachment row into Board B,
-- and UPDATE carries both clauses so an editable row cannot be rewritten to carry another Board's
-- id. There is no separate DELETE-vs-cascade concern: the FK cascade runs as the deleting user,
-- and a user who may delete the task is by definition an Editor on that Board.
create policy task_attachments_select_member on public.task_attachments
  for select to authenticated
  using (
    board_id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid()) and m.ended_at is null
    )
  );

create policy task_attachments_insert_editor on public.task_attachments
  for insert to authenticated
  with check (
    board_id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid())
         and m.ended_at is null
         and m.role in ('owner', 'editor')
    )
  );

create policy task_attachments_update_editor on public.task_attachments
  for update to authenticated
  using (
    board_id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid())
         and m.ended_at is null
         and m.role in ('owner', 'editor')
    )
  )
  with check (
    board_id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid())
         and m.ended_at is null
         and m.role in ('owner', 'editor')
    )
  );

create policy task_attachments_delete_editor on public.task_attachments
  for delete to authenticated
  using (
    board_id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid())
         and m.ended_at is null
         and m.role in ('owner', 'editor')
    )
  );

-- Explicit table grants, per the Data API convention in `docs/agents/testing.md`: RLS filters rows,
-- grants decide whether the role may issue the statement at all, and this project states them
-- rather than inheriting whatever the platform default happens to be.
--
-- **`anon` gets SELECT, deliberately, even though no policy will ever admit it.** Withholding the
-- grant looks stronger and is worse: a missing grant makes a signed-out read fail with 42501
-- `permission denied for table`, while the grant plus a policy that never matches makes it return
-- zero rows. Every other table here takes the second shape (`labels`, `push_subscriptions`,
-- `reminder_deliveries`), and `useSettings` already branches on exactly that difference -- an error
-- means "fall back to the offline snapshot", zero rows means "there is nothing here". A table that
-- errors where its neighbours filter is a trap for the next client that reads it.
grant select on table public.task_attachments to anon, authenticated;

-- Writes are **column-level**, following `labels`. This is the tighter half of the design and it
-- makes two of the guarantees above unforgeable rather than merely enforced:
--
--   - `storage_path` is absent from the INSERT list, so a caller cannot even name it. The generated
--     column would reject it anyway; this refuses it one layer earlier.
--   - `id` and `created_at` are absent, so they are always the defaults.
--   - **UPDATE grants `filename` and nothing else.** A different file is a different attachment, so
--     `board_id`, `task_id`, `mime_type`, and `size_bytes` are immutable after insert -- a rename is
--     the only edit that makes sense. This also means the UPDATE policy's `with check` on
--     `board_id` can never fire through the Data API; it stays because the grant is a Data API
--     concern and the policy is the boundary, and a boundary should not depend on a grant to hold.
grant insert (board_id, task_id, filename, mime_type, size_bytes, uploaded_by)
  on table public.task_attachments to authenticated;
grant update (filename) on table public.task_attachments to authenticated;
grant delete on table public.task_attachments to authenticated;

-- Deliberately NOT added to the `supabase_realtime` publication. Two standing rules apply to a
-- published table (`AGENTS.md`): no secret or semantically meaningful primary key, and never
-- disable RLS. This table's primary key is a uuid and would satisfy the first, but there is no
-- client subscribing to attachments yet -- adding it now would fan DELETE events out to every
-- subscriber for a feature nothing consumes. Revisit with PR 2 if the UI needs live updates.
