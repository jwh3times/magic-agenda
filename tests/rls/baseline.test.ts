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
 * `handle_new_user` is the project's only `security definer` function and it carries
 * `search_path=public`, not the empty search path that a definer should have — with a non-empty
 * path, whoever can create objects in a schema on that path can shadow an unqualified name the
 * function body resolves. It is not currently exploitable (only `postgres` can create in `public`
 * here), which is why this is recorded rather than treated as an incident.
 *
 * `explicitAcl: false` means `proacl is null` — the function carries **no** grants of its own, so
 * PostgreSQL's default applies and `PUBLIC` may execute it. Both functions are triggers, so a
 * direct call fails for want of a trigger context; that is why this is tolerable today and why it
 * stops being tolerable the moment a callable RPC lands.
 *
 * The rule for anything added here: a new `security definer` function belongs in `app_private`
 * with `set search_path = ''` and an explicit grant — so it should never appear in this map at
 * all, and a new entry with `secdef: true` should be read as a mistake before it is read as a
 * baseline update.
 */
const PUBLIC_FUNCTIONS: Record<string, { secdef: boolean; config: string; explicitAcl: boolean }> =
  {
    'handle_new_user()': { secdef: true, config: 'search_path=public', explicitAcl: false },
    'set_updated_at()': { secdef: false, config: '(none)', explicitAcl: false },
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
 * The plan puts authorization predicates in an unexposed `app_private` schema, whose entire value
 * is that `anon` and `authenticated` cannot reach it. `USAGE` on the schema is the gate: without
 * it, a definer function there is uncallable no matter what EXECUTE says. This baseline is what
 * notices the day someone grants it — including via a well-meaning `grant usage on all schemas`.
 *
 * All nine below are Supabase-managed. A platform upgrade can legitimately add a tenth, and the
 * correct response is to look at what it is and then add it here — not to loosen the assertion.
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
 * A policy with no `to` clause targets `PUBLIC`, which includes `anon`. The seven below are
 * behaviourally safe because each compares `auth.uid()` to a column and `auth.uid()` is null for a
 * signed-out caller — null comparisons are not true, so anon reads return zero rows. They are
 * listed anyway because "safe by virtue of what the predicate happens to be" is a much weaker
 * property than "never evaluated for anon at all", and the difference stops being academic once
 * policies get predicates more complicated than one equality.
 *
 * Every policy the board work adds must name `authenticated` explicitly, so this list must not
 * grow. It shrinks to empty when the legacy policies are retargeted at the authorization cutover.
 */
const POLICIES_TARGETING_PUBLIC = [
  'tasks.tasks_delete_own',
  'tasks.tasks_insert_own',
  'tasks.tasks_select_own',
  'tasks.tasks_update_own',
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
