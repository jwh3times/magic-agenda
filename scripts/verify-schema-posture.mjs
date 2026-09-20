#!/usr/bin/env node
// Verify PRODUCTION's RLS and index posture (#397), the way verify-function-grants.mjs verifies
// its function posture (#384).
//
// **The gap is drift, not coverage.** Every property below is already asserted by the required
// `RLS` check — `structure.test.ts` for RLS being on, `baseline.test.ts` for policy role
// targeting, `policies.test.ts` for hoisted `auth.uid()`. But that check can only ever see a
// FRESHLY MIGRATED LOCAL STACK, and #384 is the standing proof that "true locally" and "true in
// production" are different claims: seven functions had drifted in production while the check
// stayed green, because production carries legacy `pg_default_acl` grants a fresh stack does not.
// A policy retargeted from the dashboard, a migration that half-applied, or a future platform
// default would diverge in exactly the same way, and nothing would notice.
//
// Runs in `Deploy Migrations` after `supabase db push`, using the Management API with the secrets
// that workflow already holds. Read-only: three SELECTs, no writes.
//
// **A failure here means production does not match the reviewed posture.** Fix it with a
// migration, never by widening an expectation to match what production happens to have. Note what
// the step's position means: it runs after the push, so the deploy has already happened. Failing
// is an alarm on a state that already exists, not a gate that prevents it.
//
// **Trigger caveat, worth knowing before trusting this.** The workflow fires on
// `supabase/migrations/**`, so this verifies production on every *migration* deploy. Drift
// introduced with no migration — a dashboard edit — is caught on the next migration, not when it
// happens. Closing that would mean a schedule, which is a larger decision than this script.

import { pathToFileURL } from 'node:url'

// ---------------------------------------------------------------------------
// 1. RLS is on, and each protected table has at least one policy
// ---------------------------------------------------------------------------
// RLS is this project's only authorization boundary and the anon key is public by design, so a
// table reaching the Data API without it is a data leak rather than a bug. The policy count is the
// other half: RLS on with zero policies is default-deny, which is safe but breaks the app
// silently — a harder outage to diagnose than a loud permission error.
export const RLS_QUERY = `
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policy_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind in ('r', 'p')
 order by 1
`

// ---------------------------------------------------------------------------
// 2. Policy role targeting and per-statement auth calls
// ---------------------------------------------------------------------------
// Covers `storage` as well as `public`, matching the local assertion's scope exactly — two checks
// that claim to assert the same property must not disagree about where. Attachments (#278) put
// this project's first policies outside `public`.
//
// The expression is returned rendered rather than analyzed in SQL: `pg_get_expr` is what makes a
// hoisted `(select auth.uid())` distinguishable from a bare `auth.uid()` at all, and doing the
// matching in JavaScript keeps it pure and unit-testable.
export const POLICY_QUERY = `
select n.nspname || '.' || c.relname || '.' || p.polname as qualified,
       (0 = any(p.polroles)) as targets_public,
       coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
         coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as expression
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'storage')
 order by 1
`

// ---------------------------------------------------------------------------
// 3. Every foreign key has a covering index
// ---------------------------------------------------------------------------
// An uncovered FK makes every delete of a referenced row scan the referencing table. #385 fixed
// four of these on `tasks`; `task_attachments` was born with its two.
//
// Column NAMES rather than attnums, because the only consumer of a failure here is a human reading
// the log. Expression indexes have attnum 0 and join to no `pg_attribute` row, so the left join
// leaves a null in their prefix — which can never equal a set of real column names, so such an
// index correctly fails to cover anything.
//
// **`jsonb_agg(to_jsonb(...))` rather than `to_jsonb(array_agg(...))`, and that is not a style
// choice.** A table's indexes have different widths, and `array_agg` over arrays of unequal length
// raises `cannot accumulate arrays of different dimensionality` — the whole query fails rather than
// returning a wrong answer. jsonb has no such rule. Measured against a real stack; the broken form
// looks equally correct in a diff.
export const FK_INDEX_QUERY = `
select c.relname as table_name,
       con.conname as constraint_name,
       (select to_jsonb(array_agg(a.attname order by u.ord))
          from unnest(con.conkey) with ordinality u(attnum, ord)
          left join pg_attribute a on a.attrelid = c.oid and a.attnum = u.attnum) as fk_columns,
       coalesce(
         (
           select jsonb_agg(to_jsonb(idx.cols))
             from (
               select (
                 select array_agg(a.attname order by k.ord)
                   from unnest(
                          (string_to_array(i.indkey::text, ' ')::int[])[1:i.indnkeyatts]
                        ) with ordinality k(attnum, ord)
                   left join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
               ) as cols
                 from pg_index i
                where i.indrelid = c.oid
                  and i.indisvalid
                  and i.indislive
             ) idx
            where idx.cols is not null
         ),
         '[]'::jsonb
       ) as index_columns
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
 where con.contype = 'f'
   and n.nspname = 'public'
 order by 1, 2
`

/**
 * Policies deliberately allowed to target `PUBLIC`.
 *
 * **Empty, and that is the point** — the same shape as `POLICIES_TARGETING_PUBLIC` in
 * `baseline.test.ts`, which documents why the strong form ("no policy applies to PUBLIC at all")
 * beats "safe by virtue of what the predicate happens to be".
 *
 * It exists only for the #384 case: a policy production carries that this repository does not
 * create and cannot drop, in a schema the platform manages. An entry here needs the reasoning
 * written beside it. **It is never the way to excuse one of ours** — that is a migration.
 */
export const PLATFORM_OWNED_POLICIES = []

/** Tables exempt from the RLS requirement. Empty for the same reason, and far harder to justify. */
export const RLS_EXEMPT_TABLES = []

export function checkRlsEnabled(rows) {
  const problems = []
  // An empty result is itself a failure: it means the query found no tables, which is a broken
  // query or the wrong database rather than a clean bill of health.
  if (rows.length === 0) return ['no tables found in `public` — the posture query proved nothing']
  for (const row of rows) {
    if (RLS_EXEMPT_TABLES.includes(row.table_name)) continue
    if (!row.rls_enabled) {
      problems.push(`${row.table_name}: row-level security is DISABLED in production`)
      continue
    }
    if (row.policy_count === 0) {
      problems.push(`${row.table_name}: RLS is on but it has no policy, so every request is denied`)
    }
  }
  return problems
}

/**
 * An `auth.*()` call PostgreSQL evaluates once per ROW rather than once per statement.
 *
 * Wrapping the call in a subquery makes it an InitPlan, which is the advisor's `auth_rls_initplan`
 * lint. `auth.uid()` is STABLE, so the result is identical and only the call count changes — which
 * is why this is asserted on the shape of the predicate rather than on a timing measurement, the
 * same call `policies.test.ts` makes. At test scale the difference is invisible; on a real table
 * it is the difference between one call and one per row.
 */
function unhoistedAuthCalls(expression) {
  // `pg_get_expr` renders a hoisted call as `( SELECT auth.uid() AS uid)`. Removing every
  // `select auth.x()` first means whatever still matches is a bare call.
  const withoutHoisted = expression.replace(/select\s+auth\.(uid|jwt|role)\(\)/gi, '')
  return [...withoutHoisted.matchAll(/auth\.(uid|jwt|role)\(\)/gi)].map((match) => match[0])
}

export function checkPolicyTargeting(rows) {
  const problems = []
  if (rows.length === 0) return ['no policies found — the posture query proved nothing']
  for (const row of rows) {
    if (row.targets_public && !PLATFORM_OWNED_POLICIES.includes(row.qualified)) {
      problems.push(
        `${row.qualified}: applies to PUBLIC, which includes anon. Give it a \`to\` clause.`,
      )
    }
    const bare = unhoistedAuthCalls(row.expression ?? '')
    if (bare.length > 0) {
      problems.push(
        `${row.qualified}: calls ${[...new Set(bare)].join(', ')} per row. ` +
          `Wrap it as \`(select auth.uid())\` so it is evaluated once per statement.`,
      )
    }
  }
  return problems
}

/**
 * Whether an index's leading key columns cover a foreign key's columns.
 *
 * **Compared as a leading prefix, and as a SET.** Per-column comparison is the mistake that cost
 * time on 2026-09-18: it reports `tasks.label_id` and `tasks.recur_parent_id` as uncovered, when
 * both belong to composite FKs led by `board_id` and are covered by `tasks_board_label_idx` and
 * `tasks_recur_instance_uniq`. Order within the prefix does not matter because the FK lookup
 * constrains every one of its columns with equality, which a btree serves whichever way the
 * leading columns are arranged — so comparing sequences would produce its own false positives.
 */
export function coversForeignKey(fkColumns, indexColumns) {
  if (indexColumns.length < fkColumns.length) return false
  const prefix = indexColumns.slice(0, fkColumns.length)
  if (prefix.some((column) => column === null)) return false
  const wanted = new Set(fkColumns)
  return wanted.size === fkColumns.length && prefix.every((column) => wanted.has(column))
}

export function checkForeignKeyIndexes(rows) {
  const problems = []
  for (const row of rows) {
    const fkColumns = row.fk_columns ?? []
    const candidates = row.index_columns ?? []
    if (candidates.some((index) => coversForeignKey(fkColumns, index))) continue
    problems.push(
      `${row.table_name}.${row.constraint_name}: no index covers (${fkColumns.join(', ')}), ` +
        `so every delete of a referenced row scans ${row.table_name}`,
    )
  }
  return problems
}

async function queryProduction(query) {
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
      body: JSON.stringify({ query, read_only: true }),
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
  const [rlsRows, policyRows, fkRows] = await Promise.all([
    queryProduction(RLS_QUERY),
    queryProduction(POLICY_QUERY),
    queryProduction(FK_INDEX_QUERY),
  ])
  const problems = [
    ...checkRlsEnabled(rlsRows),
    ...checkPolicyTargeting(policyRows),
    ...checkForeignKeyIndexes(fkRows),
  ]
  if (problems.length > 0) {
    console.error("Production RLS and index posture does not match this repository's:")
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error('\nFix production with a migration; do not widen an expectation to match it.')
    process.exit(1)
  }
  console.log(
    `Production posture matches: ${rlsRows.length} tables with RLS, ` +
      `${policyRows.length} policies, ${fkRows.length} foreign keys covered.`,
  )
}
