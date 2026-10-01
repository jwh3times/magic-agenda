-- Search and sort the admin account list (#471).
--
-- `admin_users(page_limit, page_offset)` fixed its order in SQL (newest first), so the dashboard
-- could neither find one account by email nor order by sign-in or Task count without loading every
-- page. This replaces it with a version taking three optional parameters:
--
-- * `search`    — a case-insensitive substring of the email. LIKE's own wildcards (`%`, `_`) and
--                 the escape character are escaped, so the input is always matched literally.
-- * `sort_key`  — one of a fixed allow-list: joined, last_sign_in, boards, tasks. Anything else is
--                 refused. The order is chosen by `case` expressions, never by building SQL from
--                 the input.
-- * `sort_desc` — the direction.
--
-- The defaults reproduce the old behaviour exactly (newest first, no filter), so a client still
-- calling with only the two paging arguments — a tab or service-worker cache of the previous
-- release — keeps working. Nothing else changes: the same admin-on-aal2 gate runs first, the same
-- columns come back (counts only, never Task content), the paging bounds are the same, and
-- `total_count` is the size of the FILTERED set, so paging a search works.
--
-- `id` stays the final tie-breaker, so pages are stable for every sort key.

drop function public.admin_users(integer, integer);

create function public.admin_users(
  page_limit integer,
  page_offset integer,
  search text default null,
  sort_key text default 'joined',
  sort_desc boolean default true
)
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
declare
  needle text := pg_catalog.btrim(coalesce(search, ''));
  pattern text;
begin
  perform app_private.require_admin_session();

  if page_limit is null or page_limit < 1 or page_limit > 100 then
    raise exception 'page_limit must be between 1 and 100' using errcode = '22023';
  end if;
  if page_offset is null or page_offset < 0 then
    raise exception 'page_offset must not be negative' using errcode = '22023';
  end if;
  if sort_key is null or sort_key not in ('joined', 'last_sign_in', 'boards', 'tasks') then
    raise exception 'sort_key must be one of joined, last_sign_in, boards, tasks'
      using errcode = '22023';
  end if;
  if sort_desc is null then
    raise exception 'sort_desc must not be null' using errcode = '22023';
  end if;
  -- An email address is at most 320 characters; a longer search cannot match anything.
  if pg_catalog.char_length(needle) > 320 then
    raise exception 'search must be at most 320 characters' using errcode = '22023';
  end if;

  if needle <> '' then
    pattern := '%' || pg_catalog.replace(
      pg_catalog.replace(pg_catalog.replace(needle, '\', '\\'), '%', '\%'),
      '_',
      '\_'
    ) || '%';
  end if;

  return query
  with listed as (
    select u.id as account_id,
           u.email::text as account_email,
           u.created_at as joined_at,
           u.last_sign_in_at as signed_in_at,
           exists (
             select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'
           ) as mfa,
           exists (
             select 1 from public.user_roles r where r.user_id = u.id and r.role = 'admin'
           ) as admin_role,
           (
             select pg_catalog.count(*)::int from public.board_memberships m
              where m.account_id = u.id and m.role = 'owner' and m.ended_at is null
           ) as boards_owned,
           (
             select pg_catalog.count(*)::int
               from public.board_memberships m
               join public.tasks t on t.board_id = m.board_id
              where m.account_id = u.id and m.role = 'owner' and m.ended_at is null
                and not (t.recur_freq <> 'none' and t.recur_parent_id is null)
           ) as tasks_owned
      from auth.users u
     where pattern is null or u.email ilike pattern escape '\'
  )
  select l.account_id,
         l.account_email,
         l.joined_at,
         l.signed_in_at,
         l.mfa,
         l.admin_role,
         l.boards_owned,
         l.tasks_owned,
         (pg_catalog.count(*) over ())::int
    from listed l
   order by
     case when sort_key = 'joined' and not sort_desc then l.joined_at end asc,
     case when sort_key = 'joined' and sort_desc then l.joined_at end desc,
     -- Never signed in sorts last in both directions: it is "no data", not "earliest".
     case when sort_key = 'last_sign_in' and not sort_desc then l.signed_in_at end asc nulls last,
     case when sort_key = 'last_sign_in' and sort_desc then l.signed_in_at end desc nulls last,
     case when sort_key = 'boards' and not sort_desc then l.boards_owned end asc,
     case when sort_key = 'boards' and sort_desc then l.boards_owned end desc,
     case when sort_key = 'tasks' and not sort_desc then l.tasks_owned end asc,
     case when sort_key = 'tasks' and sort_desc then l.tasks_owned end desc,
     l.joined_at desc,
     l.account_id
   limit page_limit offset page_offset;
end;
$$;

-- #384: revoke from every API role explicitly, not only PUBLIC — production's legacy default ACLs
-- would otherwise hand EXECUTE straight back to anon and service_role.
revoke all on function public.admin_users(integer, integer, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_users(integer, integer, text, text, boolean) to authenticated;
