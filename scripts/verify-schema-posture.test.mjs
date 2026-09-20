// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
  checkForeignKeyIndexes,
  checkPolicyTargeting,
  checkRlsEnabled,
  coversForeignKey,
  FK_INDEX_QUERY,
  POLICY_QUERY,
  RLS_QUERY,
} from './verify-schema-posture.mjs'

/**
 * The comparison half of the production posture check (#397), tested without a database.
 *
 * The script itself cannot be exercised here — it reads production through the Management API, and
 * the only run that ever does is the one in `Deploy Migrations`. So the comparisons are pure and
 * the rows are fixtures, the same split `verify-function-grants.test.mjs` uses. What these assert
 * is that each check actually *fires* on the drift it exists to catch: a check that silently
 * passes on everything is worse than no check, because it reads as a guarantee.
 */

describe('checkRlsEnabled', () => {
  const healthy = [
    { table_name: 'tasks', rls_enabled: true, policy_count: 4 },
    { table_name: 'boards', rls_enabled: true, policy_count: 2 },
  ]

  test('a healthy production database reports no problems', () => {
    expect(checkRlsEnabled(healthy)).toEqual([])
  })

  test('catches a table reaching the Data API with RLS off', () => {
    // The single worst outcome in this schema: RLS is the only authorization boundary and the anon
    // key is public by design, so this is a data leak rather than a misconfiguration.
    const rows = [...healthy, { table_name: 'leaky', rls_enabled: false, policy_count: 0 }]
    expect(checkRlsEnabled(rows)).toEqual([
      'leaky: row-level security is DISABLED in production',
    ])
  })

  test('catches RLS on with no policy, which denies silently rather than loudly', () => {
    const rows = [...healthy, { table_name: 'orphan', rls_enabled: true, policy_count: 0 }]
    expect(checkRlsEnabled(rows)).toEqual([
      'orphan: RLS is on but it has no policy, so every request is denied',
    ])
  })

  test('treats an empty result as a failure, not a clean bill of health', () => {
    // A query that returns nothing proves nothing. Without this, a broken query or the wrong
    // database would report success — which is the exact failure mode this file warns about.
    expect(checkRlsEnabled([])).toEqual([
      'no tables found in `public` — the posture query proved nothing',
    ])
  })
})

describe('checkPolicyTargeting', () => {
  const hoisted = 'user_id = ( SELECT auth.uid() AS uid) '
  const healthy = [
    { qualified: 'public.user_settings.user_settings_select_own', targets_public: false, expression: hoisted },
  ]

  test('a healthy production database reports no problems', () => {
    expect(checkPolicyTargeting(healthy)).toEqual([])
  })

  test('catches a policy that forgot its `to` clause', () => {
    const rows = [
      ...healthy,
      { qualified: 'public.tasks.tasks_select_open', targets_public: true, expression: hoisted },
    ]
    expect(checkPolicyTargeting(rows)).toEqual([
      'public.tasks.tasks_select_open: applies to PUBLIC, which includes anon. Give it a `to` clause.',
    ])
  })

  test('catches a bare auth.uid() evaluated once per row', () => {
    const rows = [
      { qualified: 'public.tasks.tasks_select_own', targets_public: false, expression: 'user_id = auth.uid() ' },
    ]
    expect(checkPolicyTargeting(rows)).toEqual([
      'public.tasks.tasks_select_own: calls auth.uid() per row. ' +
        'Wrap it as `(select auth.uid())` so it is evaluated once per statement.',
    ])
  })

  test('does not mistake a hoisted call for a bare one, in either rendering', () => {
    // `pg_get_expr` renders the subquery form as `( SELECT auth.uid() AS uid)`. A regex that
    // matched `auth.uid()` anywhere would flag every correctly written policy in the schema, and
    // the check would be reverted within a day rather than fixed.
    const rows = [
      { qualified: 'a.b.c', targets_public: false, expression: '( SELECT auth.uid() AS uid) = user_id' },
      { qualified: 'a.b.d', targets_public: false, expression: '(select auth.uid()) = user_id' },
    ]
    expect(checkPolicyTargeting(rows)).toEqual([])
  })

  test('covers auth.jwt() and auth.role(), not only auth.uid()', () => {
    const rows = [
      { qualified: 'a.b.c', targets_public: false, expression: "auth.role() = 'admin'" },
    ]
    expect(checkPolicyTargeting(rows)).toEqual([
      "a.b.c: calls auth.role() per row. Wrap it as `(select auth.uid())` so it is evaluated once per statement.",
    ])
  })

  test('reports both problems when one policy has both', () => {
    const rows = [
      { qualified: 'a.b.c', targets_public: true, expression: 'user_id = auth.uid()' },
    ]
    expect(checkPolicyTargeting(rows)).toHaveLength(2)
  })

  test('treats an empty result as a failure', () => {
    expect(checkPolicyTargeting([])).toEqual([
      'no policies found — the posture query proved nothing',
    ])
  })
})

describe('coversForeignKey', () => {
  test('an exact single-column index covers a single-column key', () => {
    expect(coversForeignKey(['uploaded_by'], ['uploaded_by'])).toBe(true)
  })

  test('a composite key is covered by an index that LEADS with its columns', () => {
    // The 2026-09-18 false positive, pinned. `tasks.label_id` belongs to the composite FK
    // `(board_id, label_id)`, and `tasks_board_label_idx` is `(board_id, label_id)` plus more —
    // a per-column comparison calls this uncovered and sends someone chasing a fix that is
    // already in place.
    expect(coversForeignKey(['board_id', 'label_id'], ['board_id', 'label_id', 'day'])).toBe(true)
  })

  test('order within the leading prefix does not matter', () => {
    // The FK lookup constrains every column with equality, which a btree serves whichever way its
    // leading columns are arranged. Comparing sequences would invent a second false positive.
    expect(coversForeignKey(['board_id', 'task_id'], ['task_id', 'board_id'])).toBe(true)
  })

  test('the FK columns must be a PREFIX, not merely present', () => {
    // An index on (day, board_id, task_id) does not serve a lookup by (board_id, task_id): the
    // leading column is unconstrained, so the scan cannot start anywhere useful.
    expect(coversForeignKey(['board_id', 'task_id'], ['day', 'board_id', 'task_id'])).toBe(false)
  })

  test('a shorter index cannot cover a longer key', () => {
    expect(coversForeignKey(['board_id', 'task_id'], ['board_id'])).toBe(false)
  })

  test('an expression index covers nothing, because its prefix has no column name', () => {
    expect(coversForeignKey(['uploaded_by'], [null])).toBe(false)
  })
})

describe('checkForeignKeyIndexes', () => {
  test('a covered foreign key reports no problem', () => {
    const rows = [
      {
        table_name: 'task_attachments',
        constraint_name: 'task_attachments_task_same_board',
        fk_columns: ['board_id', 'task_id'],
        index_columns: [['id'], ['board_id', 'task_id']],
      },
    ]
    expect(checkForeignKeyIndexes(rows)).toEqual([])
  })

  test('catches the uncovered key #385 was about', () => {
    const rows = [
      {
        table_name: 'tasks',
        constraint_name: 'tasks_author_id_fkey',
        fk_columns: ['author_id'],
        index_columns: [['id'], ['board_id', 'day']],
      },
    ]
    expect(checkForeignKeyIndexes(rows)).toEqual([
      'tasks.tasks_author_id_fkey: no index covers (author_id), ' +
        'so every delete of a referenced row scans tasks',
    ])
  })

  test('a table with no indexes at all is reported rather than skipped', () => {
    const rows = [
      {
        table_name: 'orphan',
        constraint_name: 'orphan_ref_fkey',
        fk_columns: ['ref_id'],
        index_columns: [],
      },
    ]
    expect(checkForeignKeyIndexes(rows)).toHaveLength(1)
  })
})

describe('the queries themselves', () => {
  test('read only, and only from the schemas this repository owns', () => {
    for (const query of [RLS_QUERY, POLICY_QUERY, FK_INDEX_QUERY]) {
      expect(query.trim().toLowerCase().startsWith('select')).toBe(true)
      expect(query).not.toMatch(/\b(insert|update|delete|drop|alter|create|grant|revoke)\b/i)
    }
    // `storage` is included for policies alone, matching `baseline.test.ts`'s scope exactly —
    // attachments put this project's first policies outside `public` (#278).
    expect(POLICY_QUERY).toContain("n.nspname in ('public', 'storage')")
    expect(RLS_QUERY).toContain("n.nspname = 'public'")
    expect(FK_INDEX_QUERY).toContain("n.nspname = 'public'")
  })
})
