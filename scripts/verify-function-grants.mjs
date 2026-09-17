#!/usr/bin/env node
// Verify PRODUCTION's function security posture against supabase/reviewed-functions.json (#384).
//
// `tests/rls/baseline.test.ts` asserts the same expectation against a freshly migrated LOCAL
// stack, which is the only database CI can reach — and that is precisely why production drifted
// without anything going red: production carries legacy `pg_default_acl` grants on functions that
// a fresh stack does not, so `revoke ... from public` left `anon`, `authenticated`, and
// `service_role` holding EXECUTE there and nowhere else.
//
// Runs in `Deploy Migrations` after `supabase db push`, using the Management API with the same
// secrets that workflow already holds. Read-only: it runs one SELECT and writes nothing.
//
// Failing here means production does not match the reviewed posture. Fix it with a migration (see
// 20260917140000_revoke_function_execute_grants.sql), never by editing the expectation to match
// what production happens to have.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const GRANTS_QUERY = `
select p.oid::regprocedure::text as signature,
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
 order by 1
`

/**
 * Compare production rows with the reviewed expectation. Pure, so it is unit-tested without a
 * database. Returns human-readable problems; an empty array means production matches.
 *
 * Both directions matter. A function whose posture differs is the drift this exists to catch; a
 * reviewed function that is *missing* means the expectation is stale or a migration did not land;
 * and a function in production that nobody reviewed is the case where a new definer RPC quietly
 * inherits the platform's default grants.
 */
export function compareFunctionGrants(rows, reviewed) {
  const problems = []
  const expected = reviewed.functions
  const platformOwned = reviewed.platformOwned ?? {}
  const seen = new Set()

  for (const row of rows) {
    const signature = row.signature
    seen.add(signature)
    if (signature in platformOwned) continue
    const want = expected[signature]
    if (!want) {
      problems.push(
        `${signature}: in production but not reviewed. Add it to supabase/reviewed-functions.json ` +
          `(with its reasoning in baseline.test.ts), or drop the function.`,
      )
      continue
    }
    const actual = {
      secdef: row.secdef,
      config: row.config,
      explicitAcl: row.explicit_acl,
      executeGrantees: row.execute_grantees,
    }
    for (const key of ['secdef', 'config', 'explicitAcl', 'executeGrantees']) {
      if (actual[key] !== want[key]) {
        problems.push(
          `${signature}: ${key} is ${JSON.stringify(actual[key])}, reviewed as ${JSON.stringify(want[key])}`,
        )
      }
    }
  }

  for (const signature of Object.keys(expected)) {
    if (!seen.has(signature)) problems.push(`${signature}: reviewed but missing from production`)
  }
  return problems
}

async function queryProduction() {
  const { SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_ID } = process.env
  if (!SUPABASE_ACCESS_TOKEN || !SUPABASE_PROJECT_ID) {
    throw new Error('SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_ID are required.')
  }
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: GRANTS_QUERY, read_only: true }),
    },
  )
  if (!response.ok) {
    // Never echo the body: it is an API error, but this runs beside production credentials.
    throw new Error(`Management API query failed with ${response.status}`)
  }
  const rows = await response.json()
  if (!Array.isArray(rows)) throw new Error('Unexpected Management API response shape.')
  return rows
}

// Same entry-point guard as the other scripts here: vitest imports this module, and
// `import.meta.url` is not a file URL under its loader.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const reviewed = JSON.parse(
    readFileSync(new URL('../supabase/reviewed-functions.json', import.meta.url), 'utf8'),
  )
  const problems = compareFunctionGrants(await queryProduction(), reviewed)
  if (problems.length > 0) {
    console.error('Production function posture does not match supabase/reviewed-functions.json:')
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error('\nFix production with a migration; do not edit the expectation to match it.')
    process.exit(1)
  }
  console.log(
    `Production function posture matches the reviewed baseline (${Object.keys(reviewed.functions).length} functions).`,
  )
}
