import { expect, test } from 'vitest'
import { withPg } from './helpers'
import reviewed from '../../supabase/reviewed-functions.json'

/**
 * Security baselines: the schema's current security posture, asserted by strict equality.
 *
 * These are a different kind of test from `structure.test.ts`. Those are catch-alls that need no
 * knowledge of any particular table and hold forever. **These record what is true today**, so that
 * changing it is a deliberate act with a diff attached.
 *
 * The baselines exist because the board-collaboration work introduces the first
 * `security definer` functions, the first non-exposed schema, and the first policies that must
 * name their roles — and every one of those is a property nothing currently checks. Written after
 * the schema grows, a baseline just ratifies whatever shipped. Written before, it is a tripwire.
 *
 * **Both directions are failures.** An entry that appeared is a new security surface to review. An
 * entry that vanished means the baseline is stale and the smaller set must be committed —
 * tolerating that is what lets a ratchet's ceiling drift above reality.
 *
 * Three of these baselines record known weaknesses rather than a clean bill of health. That is
 * intentional: recording them is what turns "we should fix that someday" into a line someone has
 * to delete.
 */

/**
 * Every function in `public`, with the three properties that decide whether it is a hole.
 *
 * `explicitAcl: false` means `proacl is null` — the function carries **no** grants of its own, so
 * PostgreSQL's default applies and `PUBLIC` may execute it. `explicitAcl: true` means someone
 * revoked and granted deliberately. `executeGrantees` expands that ACL and lists every non-owner
 * grantee holding `EXECUTE`. Both are pinned because an explicit ACL alone cannot tell a reviewed
 * grant from an inherited `anon` or `service_role` grant.
 *
 * The two `security definer` functions are both triggers on `auth.users`, and both are hardened:
 * empty `search_path` (so no unqualified name in their bodies can be shadowed by whoever can create
 * objects in a schema on the path) and an explicit ACL. `security definer` is required for both —
 * they must write past RLS on four tables during a transaction where `auth.uid()` is not the
 * account in question — so the hardening is the mitigation, not the removal.
 *
 * `tasks_infer_board_id` is **gone**, dropped in the same release that enabled Board creation. That
 * removal was the stale-client fail-closed mechanism, not a cleanup chore: with it in place a
 * second Board would have meant a pre-cutover insert landing in an arbitrary one.
 *
 * `set_updated_at` used to be the one function still carrying PostgreSQL's default `PUBLIC`
 * EXECUTE, tolerated because an invoker trigger function borrows no privilege and a direct call
 * fails for want of a trigger context. #384 retired that exception: it is owner-only now, like the
 * four other invoker trigger functions here, which is possible because EXECUTE on a trigger
 * function is checked when the trigger is created rather than each time it fires. #390 retired the
 * second half of it, so **every** function below now carries `search_path=""`. That is why the
 * `config` column is worth reading as a rule rather than per-entry: a new entry without it is the
 * anomaly, and the Supabase security advisor reports the same thing independently.
 *
 * `create_board(text)` is `security definer` in `public`, and that is deliberate rather than a
 * lapse. It must insert a `boards` row and its Owner `board_memberships` row together — a Board
 * with no Membership is unreachable by every policy here — and there is no non-escalating way to
 * express that as client INSERTs, so `board_memberships` still has no INSERT policy at all. It
 * takes no account parameter, precisely so no caller can name an account other than its own.
 *
 * The rule for anything added here, in two cases rather than one:
 *
 *   - A **policy helper** — something a policy calls, which clients must never invoke — belongs in
 *     `app_private` with `set search_path = ''` and an explicit grant. A new `public` entry of that
 *     kind should be read as a mistake before it is read as a baseline update.
 *   - A **client-invoked RPC** has no such option: `[api] schemas` lists only `public` and
 *     `graphql_public`, and PostgREST refuses an unlisted schema with `PGRST106` even for
 *     `service_role`, so an `app_private` RPC is uncallable by construction. It lives in `public`
 *     and is hardened instead — empty `search_path`, explicit ACL, no account parameter.
 *
 * This distinction was added with `create_board`; the single-case version of the rule above it
 * would have flagged a correct function as an error.
 *
 * **A new function migration must revoke from `anon` and `service_role` explicitly, never only
 * from `public` (#384).** `revoke ... from public` removes PostgreSQL's built-in PUBLIC EXECUTE
 * and nothing else, which is enough on a fresh stack and not enough in production: production
 * carries legacy `pg_default_acl` entries granting the three API roles EXECUTE on every function
 * created in `public`, so six functions here drifted while this test stayed green. The expectation
 * now lives in `supabase/reviewed-functions.json` and is shared with
 * `scripts/verify-function-grants.mjs`, which asserts it against **production** after every
 * `Deploy Migrations` run — because this test structurally cannot.
 *
 * `admin_stats()` and `admin_users(integer, integer)` (#274) are client-invoked definer RPCs of the
 * second kind, returning aggregate counts and account identity but never Task content. Their shared
 * check, `app_private.require_admin_session()`, carries **no** grant at all: it is called only from
 * inside those definer bodies, where the executing role is the owner, so no API role needs it.
 */
type ReviewedFunction = {
  secdef: boolean
  config: string
  explicitAcl: boolean
  executeGrantees: string
}
const REVIEWED_FUNCTIONS = reviewed.functions as Record<string, ReviewedFunction>

test('the security posture of every application function is the reviewed one', async () => {
  const rows = await withPg(async (pg) => {
    const res = await pg.query<{
      signature: string
      secdef: boolean
      config: string
      explicit_acl: boolean
      execute_grantees: string
    }>(
      `select p.oid::regprocedure::text as signature,
              p.prosecdef as secdef,
              coalesce(array_to_string(p.proconfig, ','), '(none)') as config,
              (p.proacl is not null) as explicit_acl,
              coalesce(
                (
                  select string_agg(
                    case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end,
                    ',' order by case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end
                  )
                    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
                    left join pg_roles grantee on grantee.oid = acl.grantee
                   where acl.privilege_type = 'EXECUTE'
                     and acl.grantee <> p.proowner
                ),
                '(owner only)'
              ) as execute_grantees
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'app_private')
        order by 1`,
    )
    return res.rows
  })

  const actual = Object.fromEntries(
    rows.map((r) => [
      r.signature,
      {
        secdef: r.secdef,
        config: r.config,
        explicitAcl: r.explicit_acl,
        executeGrantees: r.execute_grantees,
      },
    ]),
  )
  expect(actual).toEqual(REVIEWED_FUNCTIONS)
})

/**
 * Every schema the Data API roles can reach, and the guard that `app_private` never joins them.
 *
 * **This comment previously said `USAGE` is what keeps a private schema off the Data API, and that
 * its whole value is that neither `anon` nor `authenticated` can reach it. Both halves are wrong**,
 * measured on a local stack rather than reasoned about:
 *
 *   - A policy calling a function in a private schema requires the CALLING role to hold `USAGE` on
 *     the schema and `EXECUTE` on the function. Without them the query fails outright with
 *     `permission denied for function` — an app outage, not a silent deny. So `authenticated` will
 *     have to hold `USAGE` on `app_private` the day a co-member predicate needs a definer helper.
 *   - Granting that does **not** expose the schema. PostgREST refuses a request for an unlisted
 *     schema with `PGRST106 Invalid schema: app_private`, even for `service_role`, even with
 *     `USAGE` granted. The real gate is `[api] schemas` in `config.toml`.
 *
 * So what this baseline actually guards is narrower and still worth having: **`anon` must never
 * reach a schema it does not reach today**, and any new schema — including one added by a platform
 * upgrade — should be looked at by a human rather than absorbed silently.
 *
 * `app_private` holds the account-role helper used by feature-flag write policies. Only
 * `authenticated` gains USAGE, and PostgREST still refuses this unlisted schema.
 *
 * `net` left this list with Supabase CLI 2.115 because a fresh local stack no longer enabled the
 * opt-in `pg_net` extension. It returned deliberately for #267: the postgres-owned Reminder Cron
 * job needs `net.http_post`. The extension is owned by Supabase's platform administrator and
 * restores its own `USAGE`/`EXECUTE` grants; the migration's `postgres` role cannot revoke them.
 * This does not make `net` callable through the Data API because `[api] schemas` still exposes only
 * `public` and `graphql_public`. Keep `net` here only while an owned Cron integration uses it.
 *
 * All nine below are Supabase-managed.
 */
const REACHABLE_SCHEMAS = [
  'auth',
  'extensions',
  'graphql',
  'graphql_public',
  'net',
  'public',
  'realtime',
  'storage',
  'supabase_functions',
]

test('only the reviewed schemas are reachable by the Data API roles', async () => {
  const rows = await withPg(async (pg) => {
    const res = await pg.query<{ nspname: string; anon: boolean; authenticated: boolean }>(
      `select n.nspname,
              has_schema_privilege('anon', n.oid, 'usage') as anon,
              has_schema_privilege('authenticated', n.oid, 'usage') as authenticated
         from pg_namespace n
        where n.nspname not like 'pg\\_%'
          and n.nspname <> 'information_schema'
          and (has_schema_privilege('anon', n.oid, 'usage')
            or has_schema_privilege('authenticated', n.oid, 'usage'))
        order by 1`,
    )
    return res.rows
  })

  expect(rows.filter((r) => r.anon).map((r) => r.nspname)).toEqual(REACHABLE_SCHEMAS)
  expect(rows.filter((r) => r.authenticated).map((r) => r.nspname)).toEqual([
    'app_private',
    ...REACHABLE_SCHEMAS,
  ])
})

/**
 * Policies that do not name their roles, and therefore apply to `PUBLIC`.
 *
 * **This list is now empty, and that is the whole point of it.** A policy with no `to` clause
 * targets `PUBLIC`, which includes `anon`. Such a policy can still be behaviourally safe — each of
 * the ones that used to be listed here compared `auth.uid()` to a column, and `auth.uid()` is null
 * for a signed-out caller, so anon reads returned zero rows. But "safe by virtue of what the
 * predicate happens to be" is a much weaker property than "never evaluated for anon at all", and
 * the difference stops being academic once a predicate grows past one equality.
 *
 * **It was seven, then three, now none.** The authorization cutover replaced the four `tasks`
 * policies with board-membership ones naming `authenticated`; #385 retargeted the last three
 * (`user_settings`, the oldest policies in the schema) in the same migration that gave them
 * `(select auth.uid())` for the advisor's `auth_rls_initplan` lint. Neither change altered who can
 * read or write a row.
 *
 * So the assertion below is now the strong form: **no policy in `public` applies to `PUBLIC` at
 * all.** Keep it that way — an entry appearing here is a new policy that forgot its `to` clause,
 * and the empty list is what turns that from a judgement call into a failing test.
 */
const POLICIES_TARGETING_PUBLIC: string[] = []

test('no policy applies to PUBLIC', async () => {
  const rows = await withPg(async (pg) => {
    const res = await pg.query<{ qualified: string }>(
      `select c.relname || '.' || p.polname as qualified
         from pg_policy p
         join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and 0 = any(p.polroles)
        order by 1`,
    )
    return res.rows
  })

  expect(rows.map((r) => r.qualified)).toEqual(POLICIES_TARGETING_PUBLIC)
})

/**
 * `pg_default_acl` in `public`: the template consulted every time an object is created there.
 *
 * This is the assumption the whole grants design rests on, and until #283 it was believed to be the
 * one part of the boundary nothing in this repository could see. That turned out to be wrong, which
 * is why this baseline exists.
 *
 * **Correction, measured 2026-09-10.** `AGENTS.md` and
 * `20260729190000_revoke_permissive_default_privileges.sql` both say CI is safe here because a
 * fresh stack's defaults are "already restrictive". They are not. A freshly reset local stack
 * carries the same permissive Supabase defaults production does. The `postgres` table row below
 * proves it from the inside: `anon` holds exactly `MAINTAIN,REFERENCES,TRIGGER,TRUNCATE`, which is
 * the full set minus precisely the `select, insert, update, delete` that migration revokes -- an
 * entry exists only because something altered it, and nothing else grants those four to `anon`. So
 * that migration is load-bearing in CI too, and `structure.test.ts`'s "a newly created table is NOT
 * reachable" test passes *because of it*, not because a fresh database is benign.
 *
 * **The `supabase_admin` rows are the open finding, and they are why this is a baseline rather than
 * a catch-all.** `postgres` is not a superuser and not a member of `supabase_admin`, so
 * `alter default privileges for role supabase_admin ...` fails with `42501` -- for us, everywhere,
 * not just in one environment. Nothing this repository can run will change those lines. What this
 * test buys is that they are now *watched*: it fails the day Supabase changes them, which is
 * realistically the only way we would find out.
 *
 * Two residuals here are wider than #283's own summary, which talks only about tables:
 *
 * - **Sequences and functions are permissive for `supabase_admin` too.** A function the platform
 *   creates in `public` is `EXECUTE`-able by `anon` by default.
 * - **`postgres` sequences grant `UPDATE` to `anon`**, and `UPDATE` on a sequence is enough for
 *   `nextval()`. The 20260729190000 migration revoked table DML only. Inert today -- `public` holds
 *   no sequences at all, every key being a uuid -- but this is a template, so it applies to the
 *   first one anybody adds.
 *
 * Both directions are failures, as everywhere else in this file. A line that vanished means
 * Supabase tightened something and the smaller set must be committed.
 */
const DEFAULT_ACL = [
  'postgres | S | anon | UPDATE',
  'postgres | S | authenticated | UPDATE',
  'postgres | S | postgres | SELECT,UPDATE,USAGE',
  'postgres | S | service_role | UPDATE',
  'postgres | f | postgres | EXECUTE',
  'postgres | r | anon | MAINTAIN,REFERENCES,TRIGGER,TRUNCATE',
  'postgres | r | authenticated | MAINTAIN,REFERENCES,TRIGGER,TRUNCATE',
  'postgres | r | postgres | DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE',
  'postgres | r | service_role | MAINTAIN,REFERENCES,TRIGGER,TRUNCATE',
  'supabase_admin | S | anon | SELECT,UPDATE,USAGE',
  'supabase_admin | S | authenticated | SELECT,UPDATE,USAGE',
  'supabase_admin | S | postgres | SELECT,UPDATE,USAGE',
  'supabase_admin | S | service_role | SELECT,UPDATE,USAGE',
  'supabase_admin | f | anon | EXECUTE',
  'supabase_admin | f | authenticated | EXECUTE',
  'supabase_admin | f | postgres | EXECUTE',
  'supabase_admin | f | service_role | EXECUTE',
  'supabase_admin | r | anon | DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE',
  'supabase_admin | r | authenticated | DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE',
  'supabase_admin | r | postgres | DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE',
  'supabase_admin | r | service_role | DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE',
]

test('the default privileges future objects in public inherit are the reviewed ones', async () => {
  const rows = await withPg(async (pg) => {
    // aclexplode rather than casting the aclitem[] to text: the text form is positional and
    // abbreviated (`anon=arwdDxtm/postgres`), so a diff on it reads as noise. One row per
    // (creator, object type, grantee) with privileges named is a diff someone can review.
    const res = await pg.query<{ line: string }>(
      `select r.rolname || ' | ' || d.defaclobjtype::text || ' | ' || a.grantee_role
                || ' | ' || a.privs as line
         from pg_default_acl d
         join pg_roles r on r.oid = d.defaclrole
         join pg_namespace n on n.oid = d.defaclnamespace
         cross join lateral (
           select coalesce(g.grantee::regrole::text, 'PUBLIC') as grantee_role,
                  string_agg(g.privilege_type, ',' order by g.privilege_type) as privs
             from aclexplode(d.defaclacl) g
            group by g.grantee
         ) a
        where n.nspname = 'public'
        order by r.rolname, d.defaclobjtype, a.grantee_role`,
    )
    return res.rows
  })

  expect(rows.map((r) => r.line)).toEqual(DEFAULT_ACL)
})

test('postgres cannot alter supabase_admin default privileges, which is why #283 stays open', async () => {
  // The refusal itself is the assertion. If this ever stops throwing, `postgres` has gained
  // membership or superuser and the migration's skipped second statement becomes runnable --
  // at which point #283 is closable and this test is the thing that says so.
  const outcome = await withPg(async (pg) => {
    await pg.query('begin')
    try {
      await pg.query(
        `alter default privileges for role supabase_admin in schema public
           revoke select on tables from anon`,
      )
      return 'allowed'
    } catch (error) {
      return (error as { code?: string }).code ?? 'unknown'
    } finally {
      await pg.query('rollback')
    }
  })

  expect(outcome).toBe('42501')
})
