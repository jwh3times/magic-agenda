/**
 * Types for `verify-schema-posture.mjs`, hand-written because that script is deliberately plain
 * JavaScript: `Deploy Migrations` runs it with `node` and no build step, exactly as it runs
 * `verify-function-grants.mjs`.
 *
 * The declarations exist so `tests/rls/production_posture.test.ts` can run the **same query text
 * and the same comparisons** against the local stack that `Deploy Migrations` runs against
 * production. Two hand-copied queries asking slightly different questions is the failure this
 * whole check is about.
 */

export const RLS_QUERY: string
export const POLICY_QUERY: string
export const FK_INDEX_QUERY: string

export const PLATFORM_OWNED_POLICIES: string[]
export const RLS_EXEMPT_TABLES: string[]

export interface RlsRow {
  table_name: string
  rls_enabled: boolean
  policy_count: number
}

export interface PolicyRow {
  qualified: string
  targets_public: boolean
  expression: string | null
}

export interface ForeignKeyRow {
  table_name: string
  constraint_name: string
  fk_columns: (string | null)[] | null
  index_columns: (string | null)[][] | null
}

export function checkRlsEnabled(rows: RlsRow[]): string[]
export function checkPolicyTargeting(rows: PolicyRow[]): string[]
export function checkForeignKeyIndexes(rows: ForeignKeyRow[]): string[]
export function coversForeignKey(
  fkColumns: (string | null)[],
  indexColumns: (string | null)[],
): boolean
