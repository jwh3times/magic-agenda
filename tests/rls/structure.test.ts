import { expect, test } from 'vitest'
import { withPg } from './helpers'

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

  // reloptions stores the spelling used at DDL time, so `security_invoker = on` is exactly as
  // safe as `security_invoker=true` and must not read as a definer view. Normalising here is
  // what stops the first false positive from tempting someone to weaken the test in a hurry.
  const TRUTHY = new Set(['true', 'on', 'yes', '1'])
  const isInvoker = (options: string[] | null) =>
    (options ?? []).some((o) => {
      const [key, value] = o.split('=')
      return key.trim() === 'security_invoker' && TRUTHY.has((value ?? '').trim().toLowerCase())
    })

  const definerViews = rows.filter((r) => !isInvoker(r.options)).map((r) => r.relname)
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
  const rows = await withPg(async (pg) => {
    const res = await pg.query<{ relname: string; granted: boolean }>(
      `select c.relname,
              has_table_privilege('authenticated', c.oid, 'select') as granted
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
        order by c.relname`,
    )
    return res.rows
  })

  const ungranted = rows.filter((r) => !r.granted).map((r) => r.relname)
  expect(ungranted).toEqual([])
})
