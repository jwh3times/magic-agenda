-- Board ownership foundation: Accounts participate in Boards through Board Memberships.
--
-- ADDITIVE ONLY. Nothing here changes how the shipped app reads or writes anything: `tasks.user_id`
-- remains both containment and authorization, no existing policy is touched, and a client that has
-- never heard of a Board keeps working unchanged. Board containment becomes authoritative at the
-- cutover, not here.
--
-- WHY THERE IS NO `app_private` SCHEMA IN THIS MIGRATION
--
-- The design puts authorization predicates in an unexposed schema. That is still the plan, but it
-- is NOT needed yet, and creating it early would add a permission surface with nothing behind it.
-- Measured on a local stack rather than assumed:
--
--   1. A co-member clause on `board_memberships` -- "rows of boards I am also in" -- subqueries its
--      own table and raises `infinite recursion detected in policy for relation`. That clause is
--      the ONLY thing here that needs a `security definer` helper, and it is a sharing feature.
--      Every Board has exactly one Membership until sharing ships, so the clause has no work to do.
--   2. Everything else is self-scoped or crosses tables: `boards` selects via a subquery on
--      `board_memberships` (different relation -- no recursion), and both `board_memberships` and
--      `account_profiles` scope to `auth.uid()` directly.
--   3. A policy calling a function in a private schema requires the CALLING role to hold USAGE on
--      the schema and EXECUTE on the function -- otherwise the query fails outright with
--      `permission denied for function`, which is an app outage, not a silent deny. So the eventual
--      helper cannot be hidden from `authenticated`; it can only be hidden from `anon`.
--   4. What actually keeps a private schema off the Data API is `[api] schemas` in config.toml, not
--      schema USAGE: PostgREST refuses a request for an unlisted schema with
--      `PGRST106 Invalid schema`, even for `service_role`, even with USAGE granted.
--
-- So: introduce `app_private` in the phase that adds the first co-member predicate, and grant it to
-- `authenticated` (never `anon`) at that point, with eyes open about what that does and does not
-- buy. Doing it here would mean claiming a protection this schema does not yet need.

-- ---------------------------------------------------------------------------
-- account_profiles
-- ---------------------------------------------------------------------------
-- One row per Account. Display Name is Account-wide, mutable, and NEVER an authorization input --
-- nothing may branch on it. Email deliberately does not live here: it is administration data, and
-- copying it into a table co-members can read is how it leaks to people who only need a name.
create table public.account_profiles (
  account_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger account_profiles_set_updated_at
  before update on public.account_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- boards
-- ---------------------------------------------------------------------------
-- Durable opaque identity, safe as a realtime DELETE key if this table is ever published.
--
-- Deliberately NO `owner_id`, `creator_id`, or `is_private` column. Ownership comes only from
-- current Memberships, and Private/Shared is derived from how many there are -- a denormalised
-- owner column is a second source of truth that RLS would then have to keep honest.
--
-- The length cap is not cosmetic: a Board Name is member-supplied text that a future invitation
-- email will render, so an unbounded one is an email-payload problem waiting to happen.
create table public.boards (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My Board' check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger boards_set_updated_at
  before update on public.boards
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- board_memberships
-- ---------------------------------------------------------------------------
-- `role` ships now even though only 'owner' ever occurs before sharing: it is the column you least
-- want to retrofit under live policies, and writing the predicates against it from the start makes
-- the sharing cutover a data change rather than a policy rewrite.
--
-- `account_id` is nullable ONLY so that Account deletion can leave history behind
-- (`on delete set null` turns surviving attribution into Former Member). The check constraint is
-- what stops that nullability from meaning anything else: a null `account_id` may appear only on an
-- ENDED row. Without it, a future code path could create a *current* Membership belonging to
-- nobody -- a row every `account_id = auth.uid()` predicate silently ignores, which is the kind of
-- bug that presents as "the board vanished" with no error anywhere.
create table public.board_memberships (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  account_id uuid references auth.users (id) on delete set null,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  default_view text not null default 'calendar'
    check (default_view in ('calendar', 'week', 'agenda', 'kanban')),
  joined_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason in ('left', 'removed', 'account-deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint board_memberships_account_or_ended
    check (account_id is not null or ended_at is not null),
  constraint board_memberships_end_reason_with_ended
    check ((ended_at is null) = (end_reason is null))
);

-- Current membership is a predicate, not a separate table. Both indexes are partial on
-- `ended_at is null` so history never competes with the lookups the app actually makes.
create unique index board_memberships_current_uniq
  on public.board_memberships (board_id, account_id) where ended_at is null;
create index board_memberships_account_idx
  on public.board_memberships (account_id, board_id) where ended_at is null;

create trigger board_memberships_set_updated_at
  before update on public.board_memberships
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Every policy names `authenticated` explicitly, unlike the seven legacy policies on tasks /
-- user_settings which target PUBLIC and are recorded as such in tests/rls/baseline.test.ts.
--
-- `anon` therefore matches NO policy on these tables and reads zero rows -- not an error. That
-- distinction is load-bearing: `useSettings` runs an unauthenticated select during boot and treats
-- an error differently from an empty result.
--
-- `(select auth.uid())` rather than a bare `auth.uid()` is deliberate: the scalar subquery is
-- hoisted to an InitPlan and evaluated once per statement instead of once per row.
alter table public.account_profiles enable row level security;
alter table public.boards enable row level security;
alter table public.board_memberships enable row level security;

-- Self only. Co-member visibility of Display Names is a sharing feature and arrives with sharing.
create policy account_profiles_select_self on public.account_profiles
  for select to authenticated
  using (account_id = (select auth.uid()));

create policy account_profiles_update_self on public.account_profiles
  for update to authenticated
  using (account_id = (select auth.uid()))
  with check (account_id = (select auth.uid()));

-- A Board is visible to its current members. The subquery crosses to another relation, so it does
-- not recurse; `board_memberships`' own policy still applies to it.
create policy boards_select_member on public.boards
  for select to authenticated
  using (
    id in (
      select m.board_id from public.board_memberships m
       where m.account_id = (select auth.uid()) and m.ended_at is null
    )
  );

-- Own rows, INCLUDING ended ones. That is not a convenience: when membership revocation has to
-- reach a live client, the UPDATE that sets `ended_at` must still be visible to the account it
-- concerns, or a current-rows-only policy filters out the very event that says "you were removed".
-- Establishing it now costs nothing and avoids changing a policy under live sharing later.
create policy board_memberships_select_own on public.board_memberships
  for select to authenticated
  using (account_id = (select auth.uid()));

-- Paired with the column-level grant below, this is the ONLY direct client write in this migration:
-- a member setting their own Default View. Everything else about a Membership is administration and
-- will go through commands that lock the Board row first.
--
-- RLS alone cannot express "only this column changed" -- a policy cannot see the old row -- so the
-- column grant is the mechanism and this policy only scopes the ROW.
create policy board_memberships_update_own on public.board_memberships
  for update to authenticated
  using (account_id = (select auth.uid()) and ended_at is null)
  with check (account_id = (select auth.uid()) and ended_at is null);

-- ---------------------------------------------------------------------------
-- Data API grants -- explicit, per table, no default privileges
-- ---------------------------------------------------------------------------
-- Both roles get SELECT. `anon` is granted deliberately: RLS, not the grant, is what denies it, and
-- tests/rls/structure.test.ts requires every table in `public` to be SELECT-reachable by both Data
-- API roles -- a table that reaches only one of them is a mistake, and one that reaches neither is
-- invisible to the app with a 42501 that looks nothing like a missing grant.
grant select on public.account_profiles to anon, authenticated;
grant select on public.boards to anon, authenticated;
grant select on public.board_memberships to anon, authenticated;

-- Column-level UPDATE: the two personal fields, and nothing else. Notably NOT `role` -- that is the
-- whole point of doing this with a column grant rather than a table grant plus a hopeful policy.
grant update (display_name) on public.account_profiles to authenticated;
grant update (default_view) on public.board_memberships to authenticated;

-- NO INSERT/DELETE for anyone, and no grants at all to `service_role` -- a deliberate departure
-- from how `tasks` and `user_settings` are granted, where all three Data API roles hold full DML.
--
-- Board lifecycle and membership administration are command-owned: they have invariants (a Board
-- always keeps an Owner; a Membership is created only by accepting an invitation) that a direct
-- table write cannot enforce, so there is no correct direct-write grant to hand out. Nothing needs
-- one today either -- `delete-account` reaches `auth.users` through GoTrue rather than PostgREST,
-- the signup and deletion triggers run as their definer, backups connect as `postgres`, and E2E
-- seeds through each account's own credentials.
--
-- Practical consequence worth knowing before it surprises someone: a test or script that reaches
-- for the service client to seed a Board gets a permission error. Seed through direct SQL instead.
-- Widening these grants to make a fixture convenient would quietly undo the invariant above.
