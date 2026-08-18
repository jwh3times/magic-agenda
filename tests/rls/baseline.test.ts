import { expect, test } from 'vitest'
import { withPg } from './helpers'

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
 * revoked and granted deliberately.
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
 * `set_updated_at` is the one function still carrying the default ACL. It stays that way knowingly:
 * it is an invoker trigger function, so `PUBLIC` executing it borrows no privilege, and a direct
 * call fails for want of a trigger context. It would matter the moment it became `security
 * definer`, which is exactly the change this baseline would catch.
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
 */
const PUBLIC_FUNCTIONS: Record<string, { secdef: boolean; config: string; explicitAcl: boolean }> =
  {
    'create_board(text)': { secdef: true, config: 'search_path=""', explicitAcl: true },
    'handle_account_deletion()': { secdef: true, config: 'search_path=""', explicitAcl: true },
    'handle_new_user()': { secdef: true, config: 'search_path=""', explicitAcl: true },
    'set_updated_at()': { secdef: false, config: '(none)', explicitAcl: false },
    'tasks_sync_legacy_category_label()': {
      secdef: false,
      config: 'search_path=""',
      explicitAcl: true,
    },
  }

test('the security posture of every function in public is the reviewed one', async () => {
  const rows = await withPg(async (pg) => {
    const res = await pg.query<{
      signature: string
      secdef: boolean
      config: string
      explicit_acl: boolean
    }>(
      `select p.oid::regprocedure::text as signature,
              p.prosecdef as secdef,
              coalesce(array_to_string(p.proconfig, ','), '(none)') as config,
              (p.proacl is not null) as explicit_acl
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
        order by 1`,
    )
    return res.rows
  })

  const actual = Object.fromEntries(
    rows.map((r) => [
      r.signature,
      { secdef: r.secdef, config: r.config, explicitAcl: r.explicit_acl },
    ]),
  )
  expect(actual).toEqual(PUBLIC_FUNCTIONS)
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
 * `app_private` does not exist yet, deliberately. The only predicate that needs a definer helper is
 * the co-member clause on `board_memberships`, which recurses (`infinite recursion detected in
 * policy for relation`) and is a sharing feature; every predicate shipped so far is self-scoped or
 * crosses to another relation. When it does arrive, expect this list to gain `app_private` for
 * `authenticated` — that is the correct update, not a regression.
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
    const res = await pg.query<{ nspname: string }>(
      `select n.nspname
         from pg_namespace n
        where n.nspname not like 'pg\\_%'
          and n.nspname <> 'information_schema'
          and (has_schema_privilege('anon', n.oid, 'usage')
            or has_schema_privilege('authenticated', n.oid, 'usage'))
        order by 1`,
    )
    return res.rows
  })

  expect(rows.map((r) => r.nspname)).toEqual(REACHABLE_SCHEMAS)
})

/**
 * Policies that do not name their roles, and therefore apply to `PUBLIC`.
 *
 * A policy with no `to` clause targets `PUBLIC`, which includes `anon`. The three below are
 * behaviourally safe because each compares `auth.uid()` to a column and `auth.uid()` is null for a
 * signed-out caller — null comparisons are not true, so anon reads return zero rows. They are
 * listed anyway because "safe by virtue of what the predicate happens to be" is a much weaker
 * property than "never evaluated for anon at all", and the difference stops being academic once
 * policies get predicates more complicated than one equality.
 *
 * **This list was seven until the authorization cutover.** The four `tasks` policies were replaced
 * by board-membership ones that name `authenticated` explicitly, so they left it — a baseline
 * shrinking is the intended direction here, and committing the smaller set is what keeps the
 * assertion honest rather than a ceiling drifting above reality.
 *
 * The three that remain are `user_settings`, which the board work does not touch. This list must
 * never grow; it reaches empty when those are retargeted.
 */
const POLICIES_TARGETING_PUBLIC = [
  'user_settings.user_settings_insert_own',
  'user_settings.user_settings_select_own',
  'user_settings.user_settings_update_own',
]

test('no policy outside the legacy set applies to PUBLIC', async () => {
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
