-- ---------------------------------------------------------------------------
-- Board Invitations: schema and commands (#436, part of #279) — ships dark
-- ---------------------------------------------------------------------------
-- How a second person joins a Board. v1 delivery is an **Owner-delivered link**: the Owner creates
-- an Invitation for a target email and receives a one-time link to pass on through their own
-- channel. The app sends no email (app-sent email is #444, deferred); the row below is the same
-- whichever way it is delivered, so email can follow without a schema change.
--
-- The properties that matter, each enforced here rather than hoped for in the client:
--
-- - **The token is not a bearer credential.** Accepting requires a *verified* Account email equal to
--   the target, re-read from `auth.users` inside the command. A leaked link is useless to anyone
--   but the person it names.
-- - **The token is stored only as a SHA-256 hash, and returned exactly once.** 32 random bytes from
--   `pgcrypto`, base64url-encoded; `create_invitation` returns it and nothing can read it back. The
--   hash is visible to the Board's Owners through RLS, which costs nothing: it cannot be inverted.
-- - **Abuse limits exist before the first Invitation can be sent**, enforced in the issuing command
--   under the Board row lock: at most 20 pending Invitations per Board, and at most 50 created per
--   Account in any rolling 24 hours.
-- - **Retention.** A pending Invitation expires 14 days after it is created. Once terminal
--   (accepted, declined, revoked, expired), its `target_email` is removed after 30 days by a daily
--   job; the row stays as the activity record. (A CHECK cannot enforce a time-based rule — Postgres
--   evaluates it only when a row is written — so the job is the mechanism, and
--   `tests/rls/board_invitations.test.ts` runs it and asserts the outcome.)
--
-- Every write is a command; clients hold SELECT only, scoped to the Board's current Owners, since
-- the domain model shows pending invitation emails to Owners alone. Flags are UI-only: all of this
-- holds with the `board-sharing` flag off.
--
-- Refusals raise a stable token as the message (mapped by the client, #437):
--   membership-ended      the caller has no current Membership of that Board
--   not-owner             the caller is a member but not an Owner
--   invalid-email         the target is not a plausible email address
--   invalid-role          the offered role is not editor or viewer
--   already-member        the target already has a current Membership
--   already-invited       a pending, unexpired Invitation for that email already exists
--   too-many-pending      the Board already has 20 pending Invitations
--   rate-limited          the caller created 50 Invitations in the last 24 hours
--   invitation-unavailable  no Invitation for this token, or it was accepted, declined, or revoked
--   invitation-expired    the Invitation is past its expiry
--   email-unverified      the caller's Account email is not verified
--   email-mismatch        the caller's verified email is not the one invited

create table public.board_invitations (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  -- Attribution, not authorization; a deleted inviter leaves the record.
  invited_by uuid references auth.users (id) on delete set null,
  -- Lower-cased and trimmed by `create_invitation`. NULL only after retention removes it.
  target_email text check (target_email is null or char_length(target_email) between 3 and 320),
  -- Owner is deliberately not offered: an invitee becomes an Owner by promotion after joining,
  -- which keeps "who can hand out Ownership" to people already on the Board.
  role text not null check (role in ('editor', 'viewer')),
  token_hash bytea not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  responded_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  constraint board_invitations_terminal_has_time
    check ((status = 'pending') = (responded_at is null)),
  constraint board_invitations_pending_has_email
    check (status <> 'pending' or target_email is not null)
);

-- Covering indexes for the foreign keys (checked against production by verify-schema-posture),
-- plus the two lookups the caps and the duplicate check make under the Board lock.
create index board_invitations_board_pending_idx
  on public.board_invitations (board_id, target_email) where status = 'pending';
create index board_invitations_board_idx on public.board_invitations (board_id);
create index board_invitations_invited_by_idx
  on public.board_invitations (invited_by, created_at);
create index board_invitations_accepted_by_idx on public.board_invitations (accepted_by);

alter table public.board_invitations enable row level security;

-- Owners of the Board see its Invitations — pending emails included, which is exactly what the
-- domain model limits to Owners. Nobody else sees any row, including the invitee: they reach their
-- Invitation through `invitation_preview`, by token, after their email is verified.
create policy board_invitations_select_owner on public.board_invitations
  for select to authenticated
  using (
    board_id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid()) and m.ended_at is null and m.role = 'owner'
    )
  );

-- SELECT for both Data API roles, as every public table has (tests/rls/structure.test.ts); RLS
-- is what answers `anon` with nothing. No INSERT, UPDATE, or DELETE for anyone: commands only.
grant select on public.board_invitations to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (owner only)
-- ---------------------------------------------------------------------------

-- The token's stored form. Hashing the text rather than the decoded bytes keeps one encoding path.
create function public.invitation_token_hash(p_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'));
$$;

-- The caller's verified email, lower-cased, or NULL when unverified. Read from `auth.users` inside
-- the command so no client-supplied value is ever trusted for acceptance.
create function public.caller_verified_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.lower(account.email::text)
    from auth.users account
   where account.id = (select auth.uid())
     and account.email_confirmed_at is not null;
$$;

-- ---------------------------------------------------------------------------
-- create_invitation: an Owner invites an email to a role; returns the token once
-- ---------------------------------------------------------------------------
create function public.create_invitation(p_board_id uuid, p_email text, p_role text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_role text;
  target_address text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  token text;
begin
  perform 1 from public.boards board where board.id = p_board_id for update;

  select membership.role into caller_role
    from public.board_memberships membership
   where membership.board_id = p_board_id
     and membership.account_id = (select auth.uid())
     and membership.ended_at is null;
  if caller_role is null then
    raise exception using errcode = 'P0001', message = 'membership-ended';
  end if;
  if caller_role <> 'owner' then
    raise exception using errcode = 'P0001', message = 'not-owner';
  end if;

  -- Plausible, not validated: the only proof an address works is its owner verifying it, which
  -- acceptance requires anyway.
  if pg_catalog.char_length(target_address) not between 3 and 320 or target_address !~ '^[^@\s]+@[^@\s]+$' then
    raise exception using errcode = 'P0001', message = 'invalid-email';
  end if;
  if p_role is null or p_role not in ('editor', 'viewer') then
    raise exception using errcode = 'P0001', message = 'invalid-role';
  end if;

  if exists (
    select 1 from public.board_memberships membership
      join auth.users account on account.id = membership.account_id
     where membership.board_id = p_board_id
       and membership.ended_at is null
       and pg_catalog.lower(account.email::text) = target_address
  ) then
    raise exception using errcode = 'P0001', message = 'already-member';
  end if;

  if exists (
    select 1 from public.board_invitations invitation
     where invitation.board_id = p_board_id
       and invitation.status = 'pending'
       and invitation.expires_at > pg_catalog.now()
       and invitation.target_email = target_address
  ) then
    raise exception using errcode = 'P0001', message = 'already-invited';
  end if;

  if (
    select count(*) from public.board_invitations invitation
     where invitation.board_id = p_board_id
       and invitation.status = 'pending'
       and invitation.expires_at > pg_catalog.now()
  ) >= 20 then
    raise exception using errcode = 'P0001', message = 'too-many-pending';
  end if;

  -- Counted across every Board, and whatever the Invitations became since: the limit is on how
  -- fast one Account can mint links, not on how many are outstanding.
  if (
    select count(*) from public.board_invitations invitation
     where invitation.invited_by = (select auth.uid())
       and invitation.created_at > pg_catalog.now() - interval '24 hours'
  ) >= 50 then
    raise exception using errcode = 'P0001', message = 'rate-limited';
  end if;

  token := pg_catalog.rtrim(
    pg_catalog.translate(pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'),
    '='
  );

  insert into public.board_invitations (board_id, invited_by, target_email, role, token_hash)
  values (p_board_id, (select auth.uid()), target_address, p_role, public.invitation_token_hash(token));

  return token;
end;
$$;

-- ---------------------------------------------------------------------------
-- revoke_invitation: an Owner withdraws a pending Invitation
-- ---------------------------------------------------------------------------
create function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.board_invitations%rowtype;
  caller_role text;
begin
  select invitation.* into target
    from public.board_invitations invitation
   where invitation.id = p_invitation_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'membership-ended';
  end if;

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

  update public.board_invitations invitation
     set status = 'revoked',
         responded_at = pg_catalog.now()
   where invitation.id = p_invitation_id
     and invitation.status = 'pending';
  if not found then
    raise exception using errcode = 'P0001', message = 'invitation-unavailable';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The invitee's side: preview, accept, decline — all by token, all behind a verified email match
-- ---------------------------------------------------------------------------

-- Resolves a token to its Invitation for the caller, refusing in the same order acceptance does.
-- Row-locks the Invitation so acceptance and decline cannot race each other.
create function public.invitation_for_caller(p_token text, p_lock boolean)
returns public.board_invitations
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.board_invitations%rowtype;
  caller_email text;
begin
  if p_lock then
    select invitation.* into target
      from public.board_invitations invitation
     where invitation.token_hash = public.invitation_token_hash(coalesce(p_token, ''))
       for update;
  else
    select invitation.* into target
      from public.board_invitations invitation
     where invitation.token_hash = public.invitation_token_hash(coalesce(p_token, ''));
  end if;
  if not found or target.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'invitation-unavailable';
  end if;
  if target.expires_at <= pg_catalog.now() then
    raise exception using errcode = 'P0001', message = 'invitation-expired';
  end if;

  caller_email := public.caller_verified_email();
  if caller_email is null then
    raise exception using errcode = 'P0001', message = 'email-unverified';
  end if;
  if caller_email <> target.target_email then
    raise exception using errcode = 'P0001', message = 'email-mismatch';
  end if;
  return target;
end;
$$;

-- What the invitation screen shows before the invitee decides. Authenticated only, so a Board's
-- name never reaches a signed-out visitor holding a link (the page cannot enumerate Boards).
create function public.invitation_preview(p_token text)
returns table (board_name text, inviter_name text, role text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.board_invitations%rowtype;
begin
  target := public.invitation_for_caller(p_token, false);
  return query
    select board.name,
           coalesce(profile.display_name, ''),
           target.role,
           target.expires_at
      from public.boards board
      left join public.account_profiles profile on profile.account_id = target.invited_by
     where board.id = target.board_id;
end;
$$;

-- Always an explicit command, never automatic on page load. Returns the Board joined.
create function public.accept_invitation(p_token text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.board_invitations%rowtype;
begin
  target := public.invitation_for_caller(p_token, true);
  perform 1 from public.boards board where board.id = target.board_id for update;

  -- Joining a Board you are already on (a second Owner invited you, say) just settles the
  -- Invitation; the unique current-Membership index would refuse a second row anyway.
  if not exists (
    select 1 from public.board_memberships membership
     where membership.board_id = target.board_id
       and membership.account_id = (select auth.uid())
       and membership.ended_at is null
  ) then
    insert into public.board_memberships (board_id, account_id, role)
    values (target.board_id, (select auth.uid()), target.role);
  end if;

  update public.board_invitations invitation
     set status = 'accepted',
         responded_at = pg_catalog.now(),
         accepted_by = (select auth.uid())
   where invitation.id = target.id;

  return target.board_id;
end;
$$;

create function public.decline_invitation(p_token text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.board_invitations%rowtype;
begin
  target := public.invitation_for_caller(p_token, true);
  update public.board_invitations invitation
     set status = 'declined',
         responded_at = pg_catalog.now()
   where invitation.id = target.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention: expire and forget, daily
-- ---------------------------------------------------------------------------
create function public.expire_board_invitations()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.board_invitations invitation
     set status = 'expired',
         responded_at = invitation.expires_at
   where invitation.status = 'pending'
     and invitation.expires_at <= pg_catalog.now();

  update public.board_invitations invitation
     set target_email = null
   where invitation.status <> 'pending'
     and invitation.responded_at < pg_catalog.now() - interval '30 days'
     and invitation.target_email is not null;
$$;

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'expire-board-invitations';

select cron.schedule(
  'expire-board-invitations',
  '41 3 * * *',
  $$ select public.expire_board_invitations(); $$
);

-- ---------------------------------------------------------------------------
-- Grants — explicitly from anon and service_role, not only public (#384)
-- ---------------------------------------------------------------------------
revoke all on function public.invitation_token_hash(text) from public, anon, authenticated, service_role;
revoke all on function public.caller_verified_email() from public, anon, authenticated, service_role;
revoke all on function public.invitation_for_caller(text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.expire_board_invitations() from public, anon, authenticated, service_role;
revoke all on function public.create_invitation(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.revoke_invitation(uuid) from public, anon, authenticated, service_role;
revoke all on function public.invitation_preview(text) from public, anon, authenticated, service_role;
revoke all on function public.accept_invitation(text) from public, anon, authenticated, service_role;
revoke all on function public.decline_invitation(text) from public, anon, authenticated, service_role;

grant execute on function public.create_invitation(uuid, text, text) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.invitation_preview(text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.decline_invitation(text) to authenticated;
