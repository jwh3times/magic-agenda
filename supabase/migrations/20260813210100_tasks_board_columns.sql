-- Board containment, attribution, and optimistic concurrency on tasks -- columns only.
--
-- All nullable or defaulted, all unread by the shipped app. `board_id` stays NULLABLE here and
-- becomes NOT NULL at the authorization cutover, once every writer sends it. Making it NOT NULL now
-- would break the currently-deployed client on its next insert.
--
-- `tasks` is in the `supabase_realtime` publication. None of these columns is part of the primary
-- key, so the standing "no meaningful value in a replicated PK" rule is unaffected.

alter table public.tasks
  -- Containment. `on delete cascade` matches the domain rule that Board Deletion removes all
  -- Board-scoped content; there is no orphan state for a task.
  add column if not exists board_id uuid references public.boards (id) on delete cascade,

  -- Attribution, never authority. Both are `on delete set null` so that deleting an Account leaves
  -- its content in place and turns the attribution into Former Member, rather than cascading away
  -- rows that belong to a Board other people may still be using.
  add column if not exists author_id uuid references auth.users (id) on delete set null,
  add column if not exists last_editor_id uuid references auth.users (id) on delete set null,

  -- Distinguishes ordinary authorship from Transferred Attribution, which is used when showing the
  -- original author would disclose an identity into a Board that person never joined. Nothing
  -- writes 'transferred' until cross-Board transfer exists; the column ships now because the
  -- alternative is a second ALTER on the largest table in the schema.
  add column if not exists author_kind text not null default 'author'
    check (author_kind in ('author', 'transferred')),

  -- Compare-and-swap token for editor saves. Monotonic per row, stamped server-side; a client that
  -- saves against a stale value is rejected rather than silently overwriting an accepted change.
  add column if not exists revision bigint not null default 1;

-- The Board-scoped twins of tasks_user_day_idx / tasks_user_status_idx. Added now so the cutover is
-- a policy change against warm indexes rather than a policy change and a sequential scan.
create index if not exists tasks_board_day_idx on public.tasks (board_id, day, order_index);
create index if not exists tasks_board_status_idx on public.tasks (board_id, status, korder);
