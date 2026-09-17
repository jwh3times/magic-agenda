-- Admin dashboard (#274): aggregate statistics and an account list, never Task content.
--
-- An admin dashboard on a personal task board is the easiest place in this codebase to quietly
-- build a surveillance surface, so the privacy stance lives here rather than in the UI:
--
--   * Every value returned is a count, a date, or account identity (email, MFA enrolment, admin
--     role). No function below selects a title, description, checklist, label, or day. Keep it
--     that way: a "just show the latest task" column is exactly the change this file refuses.
--   * The `/admin` route gate is cosmetic. These functions are the boundary, and they refuse
--     unless the caller holds a LIVE admin role (`app_private.is_admin()`, never JWT claims) on a
--     two-factor (`aal2`) session. A stolen password-only session cannot enumerate accounts.
--   * Administration still grants no Board access: the definer privilege is spent only on the
--     aggregates below, and every Board/Task policy is unchanged.
--
-- The functions are client-invoked RPCs, so they live in `public` (PostgREST refuses
-- `app_private` with PGRST106) and take no account parameter. The shared session check is a
-- private helper with no grants: it is only ever called from inside these definer functions,
-- where the executing role is the owner.

create function app_private.require_admin_session() returns void
language plpgsql stable set search_path = ''
as $$
begin
  if not coalesce((select app_private.is_admin()), false)
     or coalesce((select auth.jwt() ->> 'aal'), '') <> 'aal2' then
    raise exception 'administration requires an admin role and a two-factor session'
      using errcode = '42501';
  end if;
end;
$$;
revoke all on function app_private.require_admin_session() from public, anon, authenticated, service_role;

-- A Series definition is hidden bookkeeping, not a Task a person sees, so Task counts exclude it
-- (the same predicate as 20260820120000_clear_series_definition_pins.sql) and report it apart.
-- Days are UTC calendar days: an operational series needs no Account Timezone.
create function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
begin
  perform app_private.require_admin_session();

  return jsonb_build_object(
    'accounts', (select count(*)::int from auth.users),
    'accounts_with_mfa', (
      select count(distinct f.user_id)::int from auth.mfa_factors f where f.status = 'verified'
    ),
    'active_accounts_30d', (
      select count(*)::int from auth.users u where u.last_sign_in_at >= now() - interval '30 days'
    ),
    'boards', (select count(*)::int from public.boards),
    'tasks', (
      select count(*)::int from public.tasks t
       where not (t.recur_freq <> 'none' and t.recur_parent_id is null)
    ),
    'completed_tasks', (
      select count(*)::int from public.tasks t
       where t.status = 'done' and not (t.recur_freq <> 'none' and t.recur_parent_id is null)
    ),
    'series', (
      select count(*)::int from public.tasks t
       where t.recur_freq <> 'none' and t.recur_parent_id is null
    ),
    'daily', (
      select jsonb_agg(
               jsonb_build_object(
                 'day', to_char(d.day, 'YYYY-MM-DD'),
                 'new_accounts', (
                   select count(*)::int from auth.users u
                    where (u.created_at at time zone 'utc')::date = d.day
                 ),
                 'new_tasks', (
                   select count(*)::int from public.tasks t
                    where (t.created_at at time zone 'utc')::date = d.day
                      and not (t.recur_freq <> 'none' and t.recur_parent_id is null)
                 )
               )
               order by d.day
             )
        from (
          select g::date as day from generate_series(today - 29, today, interval '1 day') as g
        ) as d
    )
  );
end;
$$;
revoke all on function public.admin_stats() from public, anon, authenticated, service_role;
grant execute on function public.admin_stats() to authenticated;

-- Newest accounts first. `total_count` repeats on every row so one call can drive paging.
-- "Owned" means an active Owner Membership; Tasks exclude Series definitions as above.
create function public.admin_users(page_limit integer, page_offset integer)
returns table (
  id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  has_mfa boolean,
  is_admin boolean,
  owned_boards integer,
  owned_tasks integer,
  total_count integer
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform app_private.require_admin_session();

  if page_limit is null or page_limit < 1 or page_limit > 100 then
    raise exception 'page_limit must be between 1 and 100' using errcode = '22023';
  end if;
  if page_offset is null or page_offset < 0 then
    raise exception 'page_offset must not be negative' using errcode = '22023';
  end if;

  return query
  select u.id,
         u.email::text,
         u.created_at,
         u.last_sign_in_at,
         exists (
           select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'
         ),
         exists (
           select 1 from public.user_roles r where r.user_id = u.id and r.role = 'admin'
         ),
         (
           select count(*)::int from public.board_memberships m
            where m.account_id = u.id and m.role = 'owner' and m.ended_at is null
         ),
         (
           select count(*)::int
             from public.board_memberships m
             join public.tasks t on t.board_id = m.board_id
            where m.account_id = u.id and m.role = 'owner' and m.ended_at is null
              and not (t.recur_freq <> 'none' and t.recur_parent_id is null)
         ),
         (count(*) over ())::int
    from auth.users u
   order by u.created_at desc, u.id
   limit page_limit offset page_offset;
end;
$$;
revoke all on function public.admin_users(integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_users(integer, integer) to authenticated;
