-- Supabase performance advisor: `user_settings` RLS initplan, and four unindexed foreign keys (#385).
--
-- Two independent findings from the 2026-09-17 advisor rerun, in one migration because both are
-- pure performance work on the same production database with no behavioural change between them.

-- ---------------------------------------------------------------------------
-- 1. `auth_rls_initplan` on the three legacy `user_settings` policies
-- ---------------------------------------------------------------------------
-- These three predate every other policy here: they still call `auth.uid()` bare and name no role,
-- so they are also the last entries in `baseline.test.ts`'s `POLICIES_TARGETING_PUBLIC`.
--
-- Two changes, and **neither alters who can read or write a row**:
--
--   * `(select auth.uid())` instead of `auth.uid()`. PostgreSQL treats the subquery as an
--     InitPlan -- evaluated once per statement rather than once per row. `auth.uid()` is STABLE, so
--     the result is identical either way; only the number of calls changes.
--   * `to authenticated` instead of the implicit `PUBLIC`. A policy targeting PUBLIC is also
--     evaluated for `anon`, which then fails the predicate because `auth.uid()` is NULL for a
--     signed-out caller -- so anonymous access was already denied, by predicate rather than by
--     role. Naming the role denies it one step earlier and matches every policy written since the
--     authorization cutover.
--
-- `user_settings` has no DELETE policy and this migration does not add one: default-deny stands,
-- and a settings row is removed only by the `auth.users` cascade.
--
-- `drop` then `create` rather than `alter policy`, because `alter` cannot change the role list and
-- a half-altered policy is worse than a recreated one. Both run inside the migration's transaction,
-- so there is no window where `user_settings` is readable without a policy.
drop policy user_settings_select_own on public.user_settings;
drop policy user_settings_insert_own on public.user_settings;
drop policy user_settings_update_own on public.user_settings;

create policy user_settings_select_own on public.user_settings
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy user_settings_insert_own on public.user_settings
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy user_settings_update_own on public.user_settings
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 2. `unindexed_foreign_keys`
-- ---------------------------------------------------------------------------
-- A foreign key with no index on the *referencing* side makes the referenced row's deletion scan
-- the whole child table to find rows to cascade or null out. All four below are on that side.
--
-- `create index` rather than `concurrently`: the Supabase CLI runs each migration in a transaction,
-- which `concurrently` cannot join. These four tables are small today, so the brief write lock on
-- deploy is the cheaper trade -- revisit if any of them grows large enough for the lock to matter.

-- Both reference `auth.users` with `on delete set null`, so **account deletion scans `tasks`
-- twice** -- the largest table here, and the one path where the scan is user-visible latency.
create index if not exists tasks_author_id_idx on public.tasks (author_id);
create index if not exists tasks_last_editor_id_idx on public.tasks (last_editor_id);

-- Scanned when a Task is deleted, which is an ordinary interactive action rather than a rare one.
create index if not exists reminder_deliveries_task_id_idx on public.reminder_deliveries (task_id);

-- Scanned when a push subscription is deleted (an unsubscribe, or an expired endpoint being
-- cleaned up).
create index if not exists reminder_delivery_targets_subscription_id_idx
  on public.reminder_delivery_targets (subscription_id);

-- Deliberately NOT touching the advisor's `unused_index` results (#385 "Not in scope"): production
-- has 7 accounts, which is far too little traffic to conclude an index is dead. Dropping one on
-- that evidence would be reading absence of load as absence of need.
