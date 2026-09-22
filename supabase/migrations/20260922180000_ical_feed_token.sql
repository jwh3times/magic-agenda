-- The calendar feed's capability token, and the two commands that use it (#277).
--
-- **The token is a capability, and this is the whole of its authorization.** Whoever holds the URL
-- reads that Board's schedule: there is no second factor, calendar clients store the URL in
-- plaintext, and rotation is the only revocation. Everything below exists to keep that statement
-- true and no larger.
--
-- **Why it lives on `board_memberships`, not `user_settings` or `boards`** (decided on #277,
-- 2026-09-22). A feed of one Board is Board-scoped data, so an Account-scoped token is the trap
-- `docs/agents/boards.md` names. On `boards`, removing one member would leave their calendar
-- polling a URL that still works, and rotating to fix one leak would cut off every member at once.
-- On the Membership, **ending the Membership revokes the feed for free**: `ical_feed` resolves only
-- a Membership with `ended_at is null`, exactly as every Board policy does.
--
-- **The default gives every existing Membership its own token.** `gen_random_uuid()` is volatile,
-- so `add column ... default` evaluates it per row during the rewrite rather than once, and the
-- unique index below would refuse the migration outright if that were ever not so.
alter table public.board_memberships
  add column ical_token uuid not null default pg_catalog.gen_random_uuid();

-- Unique, because a token must name exactly one Membership: the lookup is the authorization, and
-- a collision would silently hand one member another's Board. It is also the index the lookup
-- needs, since `ical_feed` is reached by calendar clients polling every few minutes.
create unique index board_memberships_ical_token_key
  on public.board_memberships (ical_token);

-- ---------------------------------------------------------------------------
-- ical_feed: the only reader of a Board through its token
-- ---------------------------------------------------------------------------
-- Called by the `ical` Edge Function with the service-role key, and by nothing else. It is a
-- definer rather than a table grant for the same reason as `reminder_candidate_rows`: `service_role`
-- deliberately holds no grant on the Board tables, and widening them for one reader would undo
-- that boundary. What crosses the boundary is exactly what the serializer needs, and no more — no
-- account id, no membership id, no checklist, no labels.
--
-- Returns NULL for an unknown token and for an ended Membership alike, so the handler cannot tell
-- them apart and neither can a caller probing it.
--
-- The Tasks are the Board's **scheduled, unarchived Occurrences and standalone Tasks**. Inbox Tasks
-- have no Due Moment, so they have no place on a calendar. Series definitions are hidden rows —
-- their Occurrences are already materialized (ADR-0001), so emitting the definition as well would
-- duplicate the first one. Completed Tasks stay, matching what the calendar view shows; archived
-- ones go (maintainer decision on #277, 2026-09-22).
create function public.ical_feed(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'board_name', board.name,
    'timezone', settings.timezone,
    'tasks', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', task.id,
            'title', task.title,
            'description', task.description,
            'day', task.day::text,
            'at_time', case
              when task.at_time is null then null
              else pg_catalog.to_char(task.at_time, 'HH24:MI')
            end
          )
          order by task.day, task.at_time nulls first, task.id
        )
        from public.tasks task
        where task.board_id = membership.board_id
          and task.day is not null
          and task.archived_at is null
          and not (task.recur_freq <> 'none' and task.recur_parent_id is null)
      ),
      '[]'::jsonb
    )
  )
  from public.board_memberships membership
  join public.boards board on board.id = membership.board_id
  left join public.user_settings settings on settings.user_id = membership.account_id
  where membership.ical_token = p_token
    and membership.ended_at is null;
$$;

-- Explicitly from all three API roles, never only from `public` (#384): production's legacy
-- `pg_default_acl` would otherwise leave `anon` able to call a function that reads any Board.
revoke all on function public.ical_feed(uuid) from public, anon, authenticated, service_role;
grant execute on function public.ical_feed(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- rotate_ical_token: the only revocation a holder of the URL cannot outlive
-- ---------------------------------------------------------------------------
-- A command rather than `grant update (ical_token)`: with a column grant the client would choose
-- the new value, and a capability is only as strong as its least careful author. The server draws
-- it, and the caller only learns the result.
--
-- No account parameter, for the reason `create_board` has none: a parameter that could name
-- another account is the escalation. The row is the caller's own current Membership of the named
-- Board, or nothing — NULL means "not yours", and the caller learns nothing more.
create function public.rotate_ical_token(p_board_id uuid)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  update public.board_memberships membership
     set ical_token = pg_catalog.gen_random_uuid()
   where membership.board_id = p_board_id
     and membership.account_id = (select auth.uid())
     and membership.ended_at is null
  returning membership.ical_token;
$$;

revoke all on function public.rotate_ical_token(uuid) from public, anon, authenticated, service_role;
grant execute on function public.rotate_ical_token(uuid) to authenticated;
