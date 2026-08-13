import { expect, test } from 'vitest'
import { withPg } from './helpers'
import { isSecurityInvoker } from './reloptions'

// RLS is this project's ONLY authorization boundary and the anon key is public by design, so a
// table that reaches the Data API without RLS is a data leak, not a bug. These tests need no
// knowledge of what any table is for -- they keep holding as the schema grows. (The count is
// deliberately not stated here; it said "four" while there were five.)
//
// Security properties that need a record of TODAY's state rather than a rule that holds forever
// live in baseline.test.ts -- definer functions, schema reachability, and policy role targeting.
//
// The catch-alls below are scoped to `n.nspname = 'public'` only, except the realtime one, which
// follows the publication wherever it points. If `[api] schemas` in config.toml ever grows beyond
// `public`, these queries will not follow it -- they would need a matching update.

test('every table in public has row-level security enabled', async () => {
  const rows = await withPg(async (pg) => {
    const res = await pg.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
        order by c.relname`,
    )
    return res.rows
  })

  expect(rows.length).toBeGreaterThan(0)
  const unprotected = rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)
  expect(unprotected).toEqual([])
})

test('every RLS-enabled table has at least one policy', async () => {
  // RLS on with zero policies is default-deny: safe, but it breaks the app silently, which is
  // its own kind of outage and much harder to diagnose than a loud permission error.
  //
  // This counts any `pg_policy` row at all, regardless of `polroles` -- it does not check that a
  // policy actually grants the Data API roles anything, only that the table is not silently
  // policy-less. So it is a "silent default-deny outage" detector, not a security assertion; the
  // behavioural tests in policies.test.ts are what pin the actual security property.
  const rows = await withPg(async (pg) => {
    const res = await pg.query<{ relname: string; policy_count: string }>(
      `select c.relname, count(p.polname) as policy_count
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         left join pg_policy p on p.polrelid = c.oid
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
          and c.relrowsecurity
        group by c.relname
        order by c.relname`,
    )
    return res.rows
  })

  const policyless = rows.filter((r) => Number(r.policy_count) === 0).map((r) => r.relname)
  expect(policyless).toEqual([])
})

test('no security-definer views are exposed in public', async () => {
  // A view runs with its DEFINER's rights unless it is security_invoker, so it walks straight
  // past the relrowsecurity check above and is still reachable through PostgREST. There are no
  // views today; this test exists so that adding one is a deliberate act.
  const rows = await withPg(async (pg) => {
    const res = await pg.query<{ relname: string; options: string[] | null }>(
      `select c.relname, c.reloptions as options
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('v', 'm')
        order by c.relname`,
    )
    return res.rows
  })

  // The spelling normalisation lives in reloptions.ts and is tested directly in
  // reloptions.test.ts -- there are no views in `public` today, so this assertion runs over an
  // empty set and cannot exercise that parsing on its own.
  //
  // `c.relkind in ('v', 'm')` sweeps materialized views in too, and a matview can never carry
  // `security_invoker` (Postgres has no such option for them) -- so any future matview fails this
  // test unconditionally. That is the correct outcome, not a bug to fix: a matview in `public` is
  // reachable through PostgREST with the definer's rights and RLS cannot be applied to it, so it
  // should always be flagged for a human to look at rather than silently trusted.
  const definerViews = rows.filter((r) => !isSecurityInvoker(r.options)).map((r) => r.relname)
  expect(definerViews).toEqual([])
})

test('every table in public is reachable by the Data API roles', async () => {
  // The companion to the RLS test above, and the only thing here that guards the 2026-10-30
  // cliff. `auto_expose_new_tables` is unset, so a new table with flawless RLS and no GRANT is
  // simply invisible to the app -- a 42501 that looks nothing like a missing grant. Without this
  // test, "the catch-alls keep working as the schema grows" would be true for RLS and false for
  // grants, which is the exact failure the grants migration was written to prevent.
  //
  // The migration grants explicitly per table -- there is no ALTER DEFAULT PRIVILEGES to fall
  // back on (deliberately: see the header comment on that migration). This test is what catches
  // a table that was added without its grant.
  // Both roles, not just `authenticated`. The migration grants them together, so a table that
  // reached only one of them is a mistake -- and checking a single role would let a table that
  // is invisible to signed-out visitors pass a test whose name promises "the Data API roles".
  const rows = await withPg(async (pg) => {
    const res = await pg.query<{ relname: string; anon: boolean; authenticated: boolean }>(
      `select c.relname,
              has_table_privilege('anon', c.oid, 'select') as anon,
              has_table_privilege('authenticated', c.oid, 'select') as authenticated
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
        order by c.relname`,
    )
    return res.rows
  })

  expect(rows.length).toBeGreaterThan(0)
  expect(rows.filter((r) => !r.anon).map((r) => r.relname)).toEqual([])
  expect(rows.filter((r) => !r.authenticated).map((r) => r.relname)).toEqual([])
})

test('a newly created table is NOT reachable by the Data API roles by default', async () => {
  // The mirror of the test above, and the reason 20260729190000 exists. That one asserts today's
  // tables ARE reachable; this asserts tomorrow's are NOT reachable by accident.
  //
  // Production carried `pg_default_acl` entries granting anon/authenticated full DML on every
  // future table in `public`, so a table shipped without `enable row level security` would have
  // been world-readable AND writable through the public anon key, with nothing but memory
  // preventing it. Confirmed by querying production directly on 2026-07-29, then revoked.
  //
  // This creates a real table and reads the privileges it actually landed with, rather than
  // inspecting `pg_default_acl` -- the template is one step removed from the thing that matters,
  // and a test that reads it would pass on any fresh stack whether or not the migration ran. The
  // CREATE is rolled back, so nothing survives the test.
  //
  // Scope, stated honestly: this connects as `postgres`, the role migrations and the Studio table
  // editor (pg-meta, PG_META_DB_USER=postgres) both create through, so it covers every table this
  // project will realistically add. `supabase_admin` still carries permissive defaults and
  // 20260729190000 cannot revoke them -- `postgres` is not a member of that role, so the
  // statement raises insufficient_privilege and is skipped by design, with a notice. Tables the
  // Supabase platform itself creates in `public` as `supabase_admin` therefore remain
  // auto-granted. That gap is real, narrow, documented in the migration and ROADMAP.md, and not
  // closeable from a migration.
  const { anon, authenticated } = await withPg(async (pg) => {
    await pg.query('begin')
    try {
      await pg.query('create table public.default_privs_probe (id int)')
      const res = await pg.query<{ anon: boolean; authenticated: boolean }>(
        `select has_table_privilege('anon', 'public.default_privs_probe', 'select') as anon,
                has_table_privilege('authenticated', 'public.default_privs_probe', 'select')
                  as authenticated`,
      )
      return res.rows[0]
    } finally {
      await pg.query('rollback')
    }
  })

  expect(anon).toBe(false)
  expect(authenticated).toBe(false)
})

test('every realtime-published table has an all-uuid primary key', async () => {
  // The machine-checkable half of the standing rule on 20260704090000_realtime_tasks.sql: never
  // put a secret or semantically meaningful value in the primary key of a published table.
  //
  // Why the primary key specifically -- DELETE events cannot be RLS-filtered (Postgres cannot
  // check access to an already-deleted row), so every delete on a published table is fanned out to
  // ALL subscribers. Replica identity DEFAULT caps that payload at the primary key, which makes
  // the PK the entire content of a cross-tenant broadcast.
  //
  // Stated honestly, this proves less than the rule says: a uuid can still be *correlated*, and no
  // query can prove a value is semantically meaningless. What it does prove is that the type
  // admits no meaning -- which rules out the realistic mistake, a natural key such as an email, a
  // slug, or a board name used as a primary key. A future published table keyed on `text` fails
  // here and gets a human's attention, which is the point.
  //
  // Unlike the tests above this one follows the publication rather than assuming `public`: a
  // published table in another schema is exactly as exposed and exactly as worth catching.
  const rows = await withPg(async (pg) => {
    const res = await pg.query<{
      qualified: string
      attname: string | null
      typname: string | null
    }>(
      `select pt.schemaname || '.' || pt.tablename as qualified, a.attname, t.typname
         from pg_publication_tables pt
         join pg_namespace n on n.nspname = pt.schemaname
         join pg_class c on c.relname = pt.tablename and c.relnamespace = n.oid
         left join pg_index i on i.indrelid = c.oid and i.indisprimary
         left join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
         left join pg_type t on t.oid = a.atttypid
        where pt.pubname = 'supabase_realtime'
        order by 1, 2`,
    )
    return res.rows
  })

  // A published table with no primary key at all is the worse version of this problem, not an
  // exemption from it: under replica identity DEFAULT it publishes no old record, so deletes stop
  // reaching subscribers entirely and the client's reducer silently diverges from the database.
  // The left joins above are what let that case reach this assertion instead of vanishing.
  const noPrimaryKey = rows.filter((r) => r.attname === null).map((r) => r.qualified)
  expect(noPrimaryKey).toEqual([])

  const nonUuid = rows
    .filter((r) => r.typname !== 'uuid')
    .map((r) => `${r.qualified}.${r.attname} is ${r.typname}`)
  expect(nonUuid).toEqual([])
})
