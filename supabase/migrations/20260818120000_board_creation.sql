-- Board creation, and the end of the stale-client inference trigger.
--
-- These two belong in ONE migration and must never be split. `tasks_infer_board_id` is only correct
-- while an Account has exactly one Board; the moment this migration's function can mint a second,
-- that trigger would file a pre-cutover client's task into whichever Board it happens to pick, with
-- no error. Dropping it here is what makes such a client fail closed on `tasks.board_id`'s NOT NULL
-- instead of writing into the wrong Board. See the header of
-- 20260813210300_board_signup_and_inference.sql, which specified this removal when it added it.

-- ---------------------------------------------------------------------------
-- 1. Creating a Board is an RPC, not a pair of client INSERTs
-- ---------------------------------------------------------------------------
-- A Board and its Owner Membership must appear together or not at all: a Board with no Membership
-- is unreachable by every policy in this schema, and a Membership is what Ownership *is*.
--
-- There is no non-escalating way to express that as client INSERTs. A self-serve INSERT policy on
-- `board_memberships` -- `with check (account_id = auth.uid() and role = 'owner')` -- would let any
-- account insert an Owner Membership against ANY board_id, including one it merely learned of.
-- Narrowing it to "only a Board with no Memberships yet" subqueries its own table and raises
-- `infinite recursion detected in policy for relation`, the same wall documented in the foundation
-- migration. So the write happens in a definer function and `board_memberships` keeps having no
-- INSERT policy at all.
--
-- This function lives in `public`, NOT `app_private`, and that is deliberate. `[api] schemas` in
-- config.toml lists only `public` and `graphql_public`, and PostgREST refuses an unlisted schema
-- with `PGRST106` even for `service_role` -- so a function in `app_private` cannot be called by the
-- app. `app_private` is for predicates that policies call and clients must not; this is its
-- opposite. `app_private` remains unnecessary, and the first co-member predicate is still what
-- introduces it.
--
-- It takes NO account parameter, by design. Any parameter that could name another account would be
-- an escalation surface even with a sensible default, so the caller is always `auth.uid()` and a
-- caller without one is refused.
create or replace function public.create_board(board_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  clean_name text := btrim(coalesce(board_name, ''));
  new_board uuid;
begin
  if caller is null then
    raise exception 'must be signed in to create a board'
      using errcode = '42501';
  end if;

  if clean_name = '' then
    clean_name := 'My Board';
  end if;

  -- The table's own check constrains this too; failing here gives the client a message it can
  -- render instead of a raw constraint violation.
  if char_length(clean_name) > 120 then
    raise exception 'board name is too long'
      using errcode = '22001';
  end if;

  -- An abuse ceiling, not a product limit: this function is the one place an authenticated caller
  -- can create rows in three tables at once, and it is reachable by anyone who can register. The
  -- number is far above any real use and exists so the surface is bounded rather than open. Raise
  -- it if a real user ever meets it.
  if (
    select count(*) from public.board_memberships m
     where m.account_id = caller and m.ended_at is null
  ) >= 100 then
    raise exception 'board limit reached'
      using errcode = '54000';
  end if;

  insert into public.boards (name) values (clean_name)
    returning id into new_board;

  insert into public.board_memberships (board_id, account_id, role)
  values (new_board, caller, 'owner');

  -- Deliberately the same five definitions `handle_new_user` seeds, so "a new Board" means one
  -- thing regardless of how it came to exist. The duplication is accepted rather than factored into
  -- a shared helper: a helper would have to take the account as a parameter to serve the signup
  -- trigger, and that is exactly the escalation surface this function's signature avoids.
  -- `board_creation.test.ts` asserts the two paths produce identical vocabularies, which is what
  -- keeps them from drifting.
  insert into public.labels (board_id, name, dot_color, position, legacy_category)
  values
    (new_board, 'Work', '#2563eb', 0, 'work'),
    (new_board, 'Personal', '#db2777', 1, 'personal'),
    (new_board, 'Errands', '#d97706', 2, 'errands'),
    (new_board, 'Ideas', '#7c3aed', 3, 'ideas'),
    (new_board, 'Health', '#059669', 4, 'health');

  return new_board;
end;
$$;

revoke all on function public.create_board(text) from public;
grant execute on function public.create_board(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Remove the stale-client inference. This is the security half of the release.
-- ---------------------------------------------------------------------------
-- From here, a client that inserts a task without `board_id` fails closed. That is the intended
-- outcome, not a regression: a pre-cutover client cannot be told to update (navigations are
-- network-first, so the service worker only updates on a navigation and a board tab left open for
-- weeks never navigates), so the enforcement has to be server-side.
--
-- Worth being precise about WHICH guard catches it, because it is not the obvious one. Postgres
-- evaluates a policy's `with check` before the NOT NULL constraint below it, and
-- `tasks_insert_editor` asks whether `board_id in (select ...)`. For a NULL board that is NULL, not
-- true, so the insert is refused as `new row violates row-level security policy for table "tasks"`
-- rather than as a null-violation. Both fail closed; only the first is what an implementer will
-- actually see, and a test asserting the NOT NULL message would never pass.
drop trigger if exists tasks_infer_board_id_before_insert on public.tasks;
drop function if exists public.tasks_infer_board_id();
