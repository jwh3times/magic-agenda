import { expect, test } from 'vitest'
import { withPg } from './helpers'
import { isSecurityInvoker } from './reloptions'

// RLS is this project's ONLY authorization boundary and the anon key is public by design, so a
// table that reaches the Data API without RLS is a data leak, not a bug. These four tests need
// no knowledge of what any table is for -- they keep holding as the schema grows.

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
  // This does NOT duplicate the ALTER DEFAULT PRIVILEGES in that migration: default privileges
  // only apply to objects created by the role that ran it, so a table created any other way
  // still lands ungranted and only this assertion catches it.
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
