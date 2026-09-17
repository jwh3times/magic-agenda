// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { compareFunctionGrants, GRANTS_QUERY } from './verify-function-grants.mjs'

const reviewed = JSON.parse(
  readFileSync(new URL('../supabase/reviewed-functions.json', import.meta.url), 'utf8'),
)

const row = (signature, over = {}) => ({
  signature,
  secdef: true,
  config: 'search_path=""',
  explicit_acl: true,
  execute_grantees: 'authenticated',
  ...over,
})

/** Production as it should look: every reviewed function, plus the platform's own. */
function healthyRows() {
  return [
    ...Object.entries(reviewed.functions).map(([signature, want]) =>
      row(signature, {
        secdef: want.secdef,
        config: want.config,
        explicit_acl: want.explicitAcl,
        execute_grantees: want.executeGrantees,
      }),
    ),
    row('rls_auto_enable()', {
      config: 'search_path=pg_catalog',
      execute_grantees: 'authenticated,anon,service_role,PUBLIC',
    }),
  ]
}

describe('compareFunctionGrants', () => {
  test('a matching production database reports no problems', () => {
    expect(compareFunctionGrants(healthyRows(), reviewed)).toEqual([])
  })

  test('catches the #384 drift: an API role holding EXECUTE that the baseline does not give it', () => {
    const rows = healthyRows().map((r) =>
      r.signature === 'create_board(text)'
        ? { ...r, execute_grantees: 'anon,authenticated,service_role' }
        : r,
    )
    expect(compareFunctionGrants(rows, reviewed)).toEqual([
      'create_board(text): executeGrantees is "anon,authenticated,service_role", reviewed as "authenticated"',
    ])
  })

  test('catches a definer flag or search_path that no longer matches', () => {
    const rows = healthyRows().map((r) =>
      r.signature === 'handle_new_user()' ? { ...r, secdef: false, config: '(none)' } : r,
    )
    expect(compareFunctionGrants(rows, reviewed)).toEqual([
      'handle_new_user(): secdef is false, reviewed as true',
      'handle_new_user(): config is "(none)", reviewed as "search_path=\\"\\""',
    ])
  })

  test('an unreviewed function in production is a problem, a platform-owned one is not', () => {
    const rows = [...healthyRows(), row('new_rpc(text)')]
    expect(compareFunctionGrants(rows, reviewed)).toEqual([
      expect.stringContaining('new_rpc(text): in production but not reviewed'),
    ])
  })

  test('a reviewed function missing from production is a problem', () => {
    const rows = healthyRows().filter((r) => r.signature !== 'admin_stats()')
    expect(compareFunctionGrants(rows, reviewed)).toEqual([
      'admin_stats(): reviewed but missing from production',
    ])
  })
})

test('the query reads only the two application schemas and writes nothing', () => {
  expect(GRANTS_QUERY).toMatch(/nspname in \('public', 'app_private'\)/)
  expect(GRANTS_QUERY).not.toMatch(/\b(insert|update|delete|drop|grant|revoke)\b/i)
})
