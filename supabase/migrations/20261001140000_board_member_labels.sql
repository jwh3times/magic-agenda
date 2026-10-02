-- Board member labels (#489, part of #477): an Owner-private name for a member, on one Board.
--
-- The maintainer's decisions (recorded on #477, 2026-10-01):
--   * only current Owners set a label, and only current Owners see one;
--   * the labelled person never sees it, even when they are an Owner themselves;
--   * Board Activity Records keep the actor's own Display Name (no change there);
--   * a label is REMEMBERED: a member who leaves and is re-invited gets it back.
--
-- That last decision is why the label is keyed by (Board, Account) and lives in its own table
-- rather than on `board_memberships`: a re-invite creates a new Membership row, and a column on the
-- old one would be left behind on an ended row. It also keeps the label off `board_memberships`,
-- whose own-rows-only policy guards the calendar-feed token and must not be widened.
--
-- Not added to `supabase_realtime`: the label reaches Owners through `board_members()`, which is
-- read on load, so there is no DELETE fan-out to reason about.

create table public.board_member_labels (
  board_id uuid not null references public.boards (id) on delete cascade,
  account_id uuid not null references auth.users (id) on delete cascade,
  nickname text not null check (pg_catalog.char_length(nickname) between 1 and 80),
  updated_at timestamptz not null default pg_catalog.now(),
  -- Who last set it. Nulled, not cascaded, when that Owner's Account is deleted: the label is the
  -- Board's, not theirs.
  updated_by uuid references auth.users (id) on delete set null,
  primary key (board_id, account_id)
);

-- Covering indexes for the foreign keys the primary key does not lead with (#397).
create index board_member_labels_account_idx on public.board_member_labels (account_id);
create index board_member_labels_updated_by_idx on public.board_member_labels (updated_by);

alter table public.board_member_labels enable row level security;

-- Current Owners of the Board see its labels, EXCEPT any label about themselves: a co-Owner's label
-- for you is still never shown to you. The app reads labels through `board_members()`, not this
-- table; the policy exists so a direct read answers the same question the command does.
create policy board_member_labels_select_owner on public.board_member_labels
  for select to authenticated
  using (
    account_id <> (select auth.uid())
    and board_id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid()) and m.ended_at is null and m.role = 'owner'
    )
  );

-- SELECT for both Data API roles, as every public table has (tests/rls/structure.test.ts); RLS
-- is what answers `anon` with nothing. No INSERT, UPDATE, or DELETE for anyone: commands only.
grant select on public.board_member_labels to anon, authenticated;

-- Sets or clears the label on another member of the caller's Board.
--
-- Refusal tokens, in the vocabulary `src/board/memberAdmin.ts` already maps:
--   membership-ended  the target Membership does not exist, or the caller is no longer a member
--   not-owner         the caller is a current member but not an Owner
--   member-ended      the target has left or been removed
--   invalid-label     over 80 characters, or a label on your own Membership (falls to `unknown`
--                     in the client: the UI never offers either)
-- A blank or whitespace-only label deletes it.
create function public.set_member_label(p_membership_id uuid, p_nickname text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.board_memberships%rowtype;
  caller_role text;
  label text := pg_catalog.btrim(coalesce(p_nickname, ''));
begin
  select membership.* into target
    from public.board_memberships membership
   where membership.id = p_membership_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'membership-ended';
  end if;

  -- The same Board row lock as the other membership commands (#438), so a label cannot be written
  -- for someone whose removal is being committed concurrently.
  perform 1 from public.boards board where board.id = target.board_id for update;

  select membership.role into caller_role
    from public.board_memberships membership
   where membership.board_id = target.board_id
     and membership.account_id = (select auth.uid())
     and membership.ended_at is null;
  if caller_role is null then
    raise exception using errcode = 'P0001', message = 'membership-ended';
  end if;
  if caller_role <> 'owner' then
    raise exception using errcode = 'P0001', message = 'not-owner';
  end if;

  -- Re-read under the lock: the row read above may predate a concurrent command.
  select membership.* into target
    from public.board_memberships membership
   where membership.id = p_membership_id;
  if target.ended_at is not null then
    raise exception using errcode = 'P0001', message = 'member-ended';
  end if;
  if target.account_id = (select auth.uid()) then
    raise exception using errcode = 'P0001', message = 'invalid-label';
  end if;
  if pg_catalog.char_length(label) > 80 then
    raise exception using errcode = 'P0001', message = 'invalid-label';
  end if;

  if label = '' then
    delete from public.board_member_labels l
     where l.board_id = target.board_id and l.account_id = target.account_id;
    return;
  end if;

  insert into public.board_member_labels as l (board_id, account_id, nickname, updated_by)
  values (target.board_id, target.account_id, label, (select auth.uid()))
  on conflict (board_id, account_id) do update
     set nickname = excluded.nickname,
         updated_at = pg_catalog.now(),
         updated_by = excluded.updated_by;
end;
$$;

-- #384: revoke from every API role explicitly, not only PUBLIC.
revoke all on function public.set_member_label(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.set_member_label(uuid, text) to authenticated;

-- `board_members()` gains a seventh column, `nickname`: the label, returned only to a current Owner
-- and never on the caller's own row — the same shape as `email`, which is Owner-only. Its return
-- type changes, so it is dropped and recreated with the same grants and ordering.
drop function public.board_members(uuid);

create function public.board_members(p_board_id uuid)
returns table (
  membership_id uuid,
  account_id uuid,
  role text,
  display_name text,
  joined_at timestamptz,
  email text,
  nickname text
)
language sql
stable
security definer
set search_path = ''
as $$
  with caller as (
    select membership.role
      from public.board_memberships membership
     where membership.board_id = p_board_id
       and membership.account_id = (select auth.uid())
       and membership.ended_at is null
  )
  select membership.id,
         membership.account_id,
         membership.role,
         coalesce(profile.display_name, ''),
         membership.joined_at,
         case when caller.role = 'owner' then account.email::text end,
         case
           when caller.role = 'owner' and membership.account_id <> (select auth.uid())
           then label.nickname
         end
    from caller
    join public.board_memberships membership
      on membership.board_id = p_board_id
     and membership.ended_at is null
    left join public.account_profiles profile on profile.account_id = membership.account_id
    left join auth.users account on account.id = membership.account_id
    left join public.board_member_labels label
      on label.board_id = membership.board_id and label.account_id = membership.account_id
   order by case membership.role when 'owner' then 0 when 'editor' then 1 else 2 end,
            membership.joined_at,
            membership.id;
$$;

-- Explicitly from anon and service_role, not only public (#384).
revoke all on function public.board_members(uuid) from public, anon, authenticated, service_role;
grant execute on function public.board_members(uuid) to authenticated;
