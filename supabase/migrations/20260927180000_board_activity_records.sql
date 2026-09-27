-- ---------------------------------------------------------------------------
-- Board Activity Records, starting with exports (#442, part of #279)
-- ---------------------------------------------------------------------------
-- Export used to be Owner-only, and the only argument for that was auditability: content
-- possession is trusted at Membership granularity (a Viewer can already read, screenshot, and
-- subscribe to everything an export contains), so restricting it protected nothing. #442 lets every
-- member export and makes the auditability real instead: each export writes a Board Activity
-- Record.
--
-- A Board Activity Record, per the domain model, is an **immutable, Owner-visible** account of a
-- governance-sensitive action affecting a Board — not a history of content edits. This table is
-- the general one; `kind` admits only exports today and grows as later slices record membership
-- and invitation events. It keeps the actor's Display Name **as it was** when the action happened,
-- because a later rename must not rewrite the record, and the actor id is nulled if the Account is
-- deleted (the record then reads as a former member).
--
-- Writes happen only through `record_board_export`, which stamps the caller from `auth.uid()` — a
-- client-supplied actor would let anyone forge who exported. There is no UPDATE or DELETE grant for
-- anyone: immutable means immutable. Records go with their Board if it is deleted.

create table public.board_activity_records (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  kind text not null check (kind in ('board-exported')),
  actor_account_id uuid references auth.users (id) on delete set null,
  actor_display_name text not null default '',
  created_at timestamptz not null default now()
);

create index board_activity_records_board_idx
  on public.board_activity_records (board_id, created_at);
create index board_activity_records_actor_idx on public.board_activity_records (actor_account_id);

alter table public.board_activity_records enable row level security;

-- Owner-visible, per the domain model: Editors and Viewers do not browse who exported what.
create policy board_activity_records_select_owner on public.board_activity_records
  for select to authenticated
  using (
    board_id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid()) and m.ended_at is null and m.role = 'owner'
    )
  );

grant select on public.board_activity_records to anon, authenticated;

-- Any current member may record their own export of a Board they are on. Refuses
-- `membership-ended` otherwise, so the client can decline to produce the file.
create function public.record_board_export(p_board_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.board_memberships membership
     where membership.board_id = p_board_id
       and membership.account_id = (select auth.uid())
       and membership.ended_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'membership-ended';
  end if;

  insert into public.board_activity_records (board_id, kind, actor_account_id, actor_display_name)
  select p_board_id,
         'board-exported',
         (select auth.uid()),
         coalesce(
           (select profile.display_name from public.account_profiles profile
             where profile.account_id = (select auth.uid())),
           ''
         );
end;
$$;

revoke all on function public.record_board_export(uuid) from public, anon, authenticated, service_role;
grant execute on function public.record_board_export(uuid) to authenticated;
