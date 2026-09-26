-- ---------------------------------------------------------------------------
-- board_members: the co-member read path (#435, part of #279)
-- ---------------------------------------------------------------------------
-- Every sharing surface — the member list, role administration, the Assignee picker — needs to
-- see the *other* current members of a Board. The base tables cannot provide that safely:
--
-- - `board_memberships` carries each member's calendar-feed capability (`ical_token`, #277). The
--   obvious co-member clause on `board_memberships_select_own` would hand every member every other
--   member's feed URL, which outlives the reader's own Membership. `tests/rls/ical_feed.test.ts`
--   pins that policy's shape as a tripwire, and this migration leaves it untouched.
-- - The domain model shows email addresses to Owners only, and email lives in `auth.users`, which
--   no policy on a `public` table can reach.
--
-- So the list is a definer that names exactly the columns it returns: membership id, account id,
-- role, Display Name, joined time, and email — the last NULL unless the caller is an Owner. It
-- never returns `ical_token`, `default_view`, or an ended Membership.
--
-- No account parameter, for the reason `create_board` and `rotate_ical_token` have none. The
-- caller is `auth.uid()`; a caller with no current Membership of the named Board — ended,
-- never joined, or the Board does not exist — gets an empty set and learns nothing more, because
-- the server does not distinguish those states for the caller either.
create function public.board_members(p_board_id uuid)
returns table (
  membership_id uuid,
  account_id uuid,
  role text,
  display_name text,
  joined_at timestamptz,
  email text
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
         case when caller.role = 'owner' then account.email::text end
    from caller
    join public.board_memberships membership
      on membership.board_id = p_board_id
     and membership.ended_at is null
    left join public.account_profiles profile on profile.account_id = membership.account_id
    left join auth.users account on account.id = membership.account_id
   order by case membership.role when 'owner' then 0 when 'editor' then 1 else 2 end,
            membership.joined_at,
            membership.id;
$$;

-- Explicitly from anon and service_role, not only public (#384): production carries legacy
-- default privileges that grant every API role EXECUTE on new functions in `public`.
revoke all on function public.board_members(uuid) from public, anon, authenticated, service_role;
grant execute on function public.board_members(uuid) to authenticated;
