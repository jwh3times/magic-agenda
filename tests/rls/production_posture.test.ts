import { expect, test } from 'vitest'
import { withPg } from './helpers'
import {
  checkForeignKeyIndexes,
  checkPolicyTargeting,
  checkRlsEnabled,
  FK_INDEX_QUERY,
  POLICY_QUERY,
  RLS_QUERY,
  type ForeignKeyRow,
  type PolicyRow,
  type RlsRow,
} from '../../scripts/verify-schema-posture.mjs'

/**
 * The production posture check (#397), run here against the local stack.
 *
 * **These import the same query text and the same comparison functions that `Deploy Migrations`
 * runs against production.** That sharing is the substance of this file, not an optimization.
 * #384's lesson is usually stated as "local proves nothing about production" — true, and the
 * Management API step is the answer to it. But there is a second, quieter failure available:
 * writing a production check whose query asks a subtly different question from the local one, so
 * the two disagree and nobody can tell which is right. Importing removes that by construction.
 *
 * What each layer proves is different, and neither is redundant:
 *
 *   - **Here:** the SQL parses and returns the shape the comparisons expect, and this repository's
 *     own migrations produce a clean posture. This runs on every PR, in the required `RLS` check.
 *   - **`Deploy Migrations`:** that *production* matches. Only that run can see legacy grants,
 *     dashboard edits, and platform defaults a fresh stack does not have.
 *
 * A failure here is a problem with the migrations in this branch. A failure there is drift.
 */

test('the local stack has RLS on every table, and a policy behind it', async () => {
  const rows = await withPg(async (pg) => (await pg.query<RlsRow>(RLS_QUERY)).rows)
  expect(rows.length).toBeGreaterThan(0)
  expect(checkRlsEnabled(rows)).toEqual([])
})

test('no local policy targets PUBLIC or calls auth.uid() per row', async () => {
  const rows = await withPg(async (pg) => (await pg.query<PolicyRow>(POLICY_QUERY)).rows)
  expect(rows.length).toBeGreaterThan(0)
  expect(checkPolicyTargeting(rows)).toEqual([])
})

test('every local foreign key has a covering index', async () => {
  const rows = await withPg(async (pg) => (await pg.query<ForeignKeyRow>(FK_INDEX_QUERY)).rows)
  // Not merely "no problems": an empty result would satisfy that while proving nothing, and this
  // schema has had foreign keys since before the Board model.
  expect(rows.length).toBeGreaterThan(0)
  expect(checkForeignKeyIndexes(rows)).toEqual([])
})

test('the foreign-key query returns column names, not attnums', async () => {
  // The comparison is written against names and would silently never match numbers — a check that
  // passes on everything. `node-postgres` and the Management API also differ in how they decode a
  // Postgres array, which is exactly why the query casts to `jsonb` rather than returning `text[]`.
  const rows = await withPg(async (pg) => (await pg.query<ForeignKeyRow>(FK_INDEX_QUERY)).rows)
  const [first] = rows
  expect(Array.isArray(first.fk_columns)).toBe(true)
  expect(Array.isArray(first.index_columns)).toBe(true)
  for (const column of first.fk_columns ?? []) expect(typeof column).toBe('string')
})
