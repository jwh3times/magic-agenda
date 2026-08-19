-- Retire the Category compatibility bridge and free the client from the legacy ownership column.
--
-- This is **Release A of two**, and the split is not fastidiousness. Dropping a column that any live
-- client still SENDS is a hard failure: PostgREST answers `400 PGRST204 — Could not find the 'x'
-- column of 'tasks' in the schema cache` (measured against a local stack, not inferred). Migrations
-- and the Cloudflare Pages build land at different moments, and a long-open tab runs the old client
-- indefinitely, so a single release that both stopped writing a column and dropped it would have a
-- window in which task creation is broken for anyone who had not reloaded.
--
-- Reads are unaffected — `select('*')` simply returns fewer columns, and `rowToTask` never read
-- `category`. The hazard is writes only.
--
-- So: this release makes the columns *unnecessary*; a later one removes them. Release B drops
-- `tasks.user_id`, `tasks.category`, `tasks.label_assignment_explicit`, and
-- `user_settings.default_view`, once no deployed client sends them.

-- ---------------------------------------------------------------------------
-- 1. The Category bridge, and why it must die in the same release the client stops flagging
-- ---------------------------------------------------------------------------
-- `tasks_sync_legacy_category_label` maps `category` -> `label_id` whenever
-- `label_assignment_explicit` is false, which is how a pre-#177 client's writes were understood.
--
-- The client half of this release stops sending that flag, so it falls to its `false` default —
-- which is precisely the signal the bridge reads as "a stale client omitted `label_id`". With the
-- trigger still in place, every new Unlabeled Task would be silently assigned the Work Label,
-- because `category` also defaults to `'work'`. **These two changes are safe together and
-- destructive apart.** Do not split them across releases in either order.
--
-- What is genuinely lost: a pre-#177 client updating `category` on an existing Task no longer has
-- that reinterpreted as a Label change. That is the compatibility window closing, declared on
-- 2026-08-19. Such a client could not create a Task at all since v1.6.0 dropped
-- `tasks_infer_board_id`, so this is the last reachable path, not the first.
drop trigger if exists tasks_sync_legacy_category_label_before_write on public.tasks;
drop function if exists public.tasks_sync_legacy_category_label();

-- `handle_new_user` seeds the five starter Labels WITH their `legacy_category` alias, so it has to
-- be rewritten before that column can go. This is not a tidy-up: that function runs inside the
-- signup transaction, and a failure in it fails registration outright — the local RLS suite caught
-- exactly that, as `Database error creating new user` on every test that creates an account.
--
-- Everything else about the function is unchanged, including the `security definer` /
-- `search_path = ''` hardening, which is why every reference below stays schema-qualified.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_board uuid;
begin
  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.account_profiles (account_id)
  values (new.id)
  on conflict (account_id) do nothing;

  if not exists (
    select 1 from public.board_memberships m
     where m.account_id = new.id and m.ended_at is null
  ) then
    insert into public.boards (name) values ('My Board')
      returning id into new_board;

    insert into public.board_memberships (board_id, account_id, role)
    values (new_board, new.id, 'owner');

    insert into public.labels (board_id, name, dot_color, position)
    values
      (new_board, 'Work', '#2563eb', 0),
      (new_board, 'Personal', '#db2777', 1),
      (new_board, 'Errands', '#d97706', 2),
      (new_board, 'Ideas', '#7c3aed', 3),
      (new_board, 'Health', '#059669', 4);
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

-- `create_board` seeds the same five and must lose the alias for the same reason. The two copies of
-- this list stay deliberately separate — a shared helper would have to take the account as a
-- parameter, which is the escalation surface `create_board`'s signature exists to avoid — and
-- `board_creation.test.ts` asserts the two produce identical vocabularies, which is what catches a
-- change made to one and not the other. It just caught this one.
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

  if char_length(clean_name) > 120 then
    raise exception 'board name is too long'
      using errcode = '22001';
  end if;

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

  insert into public.labels (board_id, name, dot_color, position)
  values
    (new_board, 'Work', '#2563eb', 0),
    (new_board, 'Personal', '#db2777', 1),
    (new_board, 'Errands', '#d97706', 2),
    (new_board, 'Ideas', '#7c3aed', 3),
    (new_board, 'Health', '#059669', 4);

  return new_board;
end;
$$;

revoke all on function public.create_board(text) from public;
grant execute on function public.create_board(text) to authenticated;

-- The alias existed only for the bridge trigger to read: it preserved a seeded Label's original
-- Category key across an Owner rename. No client can write it (the INSERT and UPDATE grants on
-- `labels` omit it), and nothing selects it by name, so it goes now rather than waiting for
-- Release B.
alter table public.labels drop column legacy_category;

-- ---------------------------------------------------------------------------
-- 2. Let the client stop sending `tasks.user_id`
-- ---------------------------------------------------------------------------
-- `user_id` is NOT NULL with **no default**, which is what makes it different from every other
-- column being retired here — `category`, `label_assignment_explicit`, and
-- `user_settings.default_view` all have defaults, so a client can simply stop sending those and the
-- default fills in. There is no equivalent state for `user_id`: it has to become nullable before
-- any client can omit it.
--
-- It has not been an authorization input since the v1.2.78 cutover — `board_id` and Membership are
-- the boundary, and the legacy `user_id`-scoped policies were dropped then. What remains is
-- attribution, which `author_id` and `last_editor_id` already carry properly.
--
-- Deliberately only relaxed, not dropped. Existing rows keep their values and the currently
-- deployed client keeps sending it happily; both states are valid for the whole of this release,
-- which is the entire point of doing it in two.
alter table public.tasks alter column user_id drop not null;
