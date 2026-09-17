-- Make production's function EXECUTE grants match the reviewed baseline (#384).
--
-- Measured 2026-09-17, both sides:
--
--   production  pg_default_acl, creator postgres, schema public, objtype f:
--               {postgres=X, anon=X, authenticated=X, service_role=X}
--   fresh local pg_default_acl, same row:
--               {postgres=X}
--
-- Production carries legacy default privileges on FUNCTIONS from the auto-expose era, exactly as
-- it did on tables. `20260729190000_revoke_permissive_default_privileges.sql` closed the table
-- half and did not touch functions. Every function migration in this repo then revoked
-- `from public` only -- which removes PostgreSQL's own built-in PUBLIC EXECUTE and is therefore
-- sufficient on a fresh stack, and leaves the three role-specific grants standing in production.
--
-- That is why `tests/rls/baseline.test.ts` passed while production differed: it asserts the
-- posture of a freshly migrated local stack, and cannot see production at all. Nothing here was
-- exploitable -- `create_board` refuses a caller with no `auth.uid()`, and the trigger functions return
-- `trigger`, which PostgreSQL will not call outside a trigger -- but a future definer RPC would
-- inherit the same grant with a body that does something. `Deploy Migrations` now verifies the
-- production ACLs after every push (`scripts/verify-function-grants.mjs`), because a local test
-- structurally cannot.

-- ---------------------------------------------------------------------------
-- 1. Stop new functions inheriting the grant
-- ---------------------------------------------------------------------------
-- The same shape as the table revoke, and deliberately narrow: EXECUTE only. `service_role` IS
-- included here, unlike the table revoke -- it bypasses RLS on tables by design, but a definer
-- function is privileged code rather than data, and no Edge Function calls one. The two RPCs that
-- service_role does use (`reminder_candidate_rows`) carry their own explicit grant.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;

do $do$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke execute on functions from anon, authenticated, service_role';
  raise notice 'revoked supabase_admin default privileges on functions in public';
exception
  when insufficient_privilege then
    raise notice 'SKIPPED supabase_admin default privileges on functions: insufficient privilege. Expected where postgres is not a member of supabase_admin. Residual gap: platform-created functions in public remain auto-granted.';
end
$do$;

-- ---------------------------------------------------------------------------
-- 2. Bring the existing functions back to the reviewed posture
-- ---------------------------------------------------------------------------
-- Default privileges are a template consulted at CREATE time, never applied retroactively, so
-- step 1 changes nothing about the functions that already exist. These are the seven affected.
-- Each is a no-op on a stack that never had the grant, which is why this file is safe to run
-- locally and in CI as well as against production.
--
-- `rls_auto_enable()` is deliberately absent: it is a Supabase platform function behind the
-- `ensure_rls` event trigger, created by the platform rather than by this repo. It returns
-- `event_trigger` and cannot be invoked directly. Leave it alone.

-- The four trigger functions: owner only. They return `trigger`, so no API role has any business
-- holding EXECUTE, and PostgreSQL refuses a direct call regardless.
revoke execute on function public.handle_new_user() from anon, authenticated, service_role;
revoke execute on function public.handle_account_deletion() from anon, authenticated, service_role;
revoke execute on function public.stamp_task_attribution() from anon, authenticated, service_role;
revoke execute on function public.enforce_task_completion_lifecycle()
  from anon, authenticated, service_role;
revoke execute on function public.enforce_reminder_preferences()
  from anon, authenticated, service_role;

-- `set_updated_at` is the seventh, and the only one whose reviewed posture changes here rather
-- than being restored. It was the last function EXECUTE-able by `PUBLIC` (PostgreSQL's own default
-- for functions), tolerated because an invoker trigger function borrows no privilege and cannot be
-- called outside a trigger context. Production held the three role grants on top of that. Rather
-- than encode "PUBLIC, plus whatever production has" as the expectation, it joins the other four
-- invoker trigger functions at owner-only -- which is exactly what they already are, so this is a
-- posture those functions prove works: a trigger fires for an ordinary caller regardless, because
-- EXECUTE on a trigger function is checked when the trigger is created, not when it fires.
revoke execute on function public.set_updated_at() from public, anon, authenticated, service_role;

-- `create_board` is a client-invoked RPC: `authenticated` and nobody else. The revoke comes first
-- and the grant second, so the intended grantee survives the broader revoke.
revoke execute on function public.create_board(text) from anon, authenticated, service_role;
grant execute on function public.create_board(text) to authenticated;
