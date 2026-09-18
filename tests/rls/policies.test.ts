import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  anonClient,
  createTestUser,
  deleteTestUser,
  boardTaskInsert,
  currentBoardId,
  withPg,
  type TestUser,
} from './helpers'

let alice: TestUser
let bob: TestUser
let aliceTaskId: string

beforeAll(async () => {
  alice = await createTestUser()
  bob = await createTestUser()

  const { data, error } = await alice.client
    .from('tasks')
    .insert(boardTaskInsert(await currentBoardId(alice.id), { title: "alice's task" }))
    .select('id')
    .single()
  if (error) throw new Error(`fixture insert failed: ${error.message}`)
  aliceTaskId = data.id
})

afterAll(async () => {
  // Guarded: if bob's creation throws, an unguarded delete throws a TypeError over the real
  // error AND leaks alice onto a stack that outlives the run.
  for (const user of [alice, bob]) {
    if (user) await deleteTestUser(user)
  }
})

test("bob cannot see alice's task", async () => {
  // RLS filters rather than errors: the row is invisible, not forbidden.
  const { data, error } = await bob.client.from('tasks').select('id')
  expect(error).toBeNull()
  expect(data).toEqual([])
})

test("bob cannot update alice's task", async () => {
  const { data, error } = await bob.client
    .from('tasks')
    .update({ title: 'hijacked' })
    .eq('id', aliceTaskId)
    .select('id')
  expect(error).toBeNull()
  expect(data).toEqual([]) // matched nothing

  const { data: after } = await alice.client
    .from('tasks')
    .select('title')
    .eq('id', aliceTaskId)
    .single()
  expect(after?.title).toBe("alice's task")
})

test("bob cannot delete alice's task", async () => {
  const { error } = await bob.client.from('tasks').delete().eq('id', aliceTaskId)
  expect(error).toBeNull()

  const { data: after } = await alice.client.from('tasks').select('id').eq('id', aliceTaskId)
  expect(after).toHaveLength(1)
})

test('bob cannot insert a task owned by alice', async () => {
  // The sharp one. A policy with USING but no WITH CHECK passes every test above and still
  // lets one user write rows owned by another.
  const { error } = await bob.client
    .from('tasks')
    .insert(boardTaskInsert(await currentBoardId(alice.id), { title: 'forged' }))
  expect(error).not.toBeNull()
  expect(error?.code).toBe('42501')
})

test('alice cannot move her task into another board', async () => {
  // The mirror of the above, on the UPDATE policy's WITH CHECK — but the thing being protected
  // changed at the authorization cutover. It used to be `user_id`; it is now `board_id`.
  //
  // Reassigning `user_id` no longer fails, and that is correct rather than a hole: `user_id` is no
  // longer an authorization input, the row stays in a board only alice can reach, and the column is
  // dropped once nothing reads it. What must not be possible is moving a task ACROSS a board
  // boundary with a plain update — content transfer is a deliberate command, not a field write.
  const { data: bobBoard } = await bob.client.from('board_memberships').select('board_id').single()

  const { error } = await alice.client
    .from('tasks')
    .update({ board_id: bobBoard!.board_id })
    .eq('id', aliceTaskId)
  expect(error).not.toBeNull()
  expect(error?.code).toBe('42501')

  // ...and the task is still where it was.
  const { data: after } = await alice.client.from('tasks').select('id').eq('id', aliceTaskId)
  expect(after).toHaveLength(1)
})

test("bob cannot read alice's settings row", async () => {
  const { data, error } = await bob.client.from('user_settings').select('user_id')
  expect(error).toBeNull()
  expect(data).toHaveLength(1)
  expect(data?.[0].user_id).toBe(bob.id)
})

test('nobody can delete a settings row -- there is no delete policy', async () => {
  const { error } = await alice.client.from('user_settings').delete().eq('user_id', alice.id)
  expect(error).toBeNull() // default-deny filters rather than errors

  const { data } = await alice.client.from('user_settings').select('user_id')
  expect(data).toHaveLength(1)
})

test('alice cannot insert a settings row owned by bob', async () => {
  // The mirror of the `tasks` forged-insert test above, on `user_settings_insert_own`'s WITH
  // CHECK. `user_id` is the primary key and the signup trigger already seeded bob a row, so this
  // insert collides with BOTH the policy and the primary key -- confirmed empirically (not just
  // reasoned about) that Postgres evaluates the INSERT policy's WITH CHECK before the row ever
  // reaches the unique index, so this still asserts 42501, the policy denial, not 23505.
  const { error } = await alice.client.from('user_settings').insert({ user_id: bob.id })
  expect(error).not.toBeNull()
  expect(error?.code).toBe('42501')
})

test('alice cannot transfer her settings row to bob', async () => {
  // The mirror of the `tasks` ownership-transfer test above, on `user_settings_update_own`'s
  // WITH CHECK.
  const { error } = await alice.client
    .from('user_settings')
    .update({ user_id: bob.id })
    .eq('user_id', alice.id)
  expect(error).not.toBeNull()
  expect(error?.code).toBe('42501')
})

test('an anonymous client reads zero rows WITHOUT an error', async () => {
  // Load-bearing, not pedantry. AGENTS.md documents this exact behaviour and `useSettings`
  // branches on it: an error means "fall back to the offline snapshot", zero rows means "this
  // user has no settings row yet, seed DEFAULTS". If a grants change turned this into a 42501,
  // a signed-out visitor would silently take the wrong branch.
  const anon = anonClient()

  const tasks = await anon.from('tasks').select('id')
  expect(tasks.error).toBeNull()
  expect(tasks.data).toEqual([])

  const settings = await anon.from('user_settings').select('user_id')
  expect(settings.error).toBeNull()
  expect(settings.data).toEqual([])
})

test('an anonymous client cannot write', async () => {
  const { error } = await anonClient()
    .from('tasks')
    .insert(boardTaskInsert(await currentBoardId(alice.id), { title: 'from nowhere' }))
  // Specifically the policy denial, not just any error -- a schema-level failure (a new NOT
  // NULL column, a check constraint) would satisfy `not.toBeNull()` just as well and mask a
  // missing or broken policy.
  expect(error?.code).toBe('42501')
})

/**
 * The structural half of #385, asserted separately from the behavioural tests above.
 *
 * Those tests prove *who can reach a row*, and they passed before this migration too — the three
 * `user_settings` policies were already safe, because `auth.uid()` is null for a signed-out caller
 * and a null comparison is not true. What they cannot see is *how* that safety is achieved, and
 * that is exactly what #385 changed:
 *
 *   - `to authenticated` means `anon` is excluded by role, one step earlier than the predicate.
 *     The anonymous test above still passing is the load-bearing part — excluding the role must not
 *     turn "zero rows" into a `42501`, because `useSettings` branches on that difference.
 *   - `(select auth.uid())` makes PostgreSQL evaluate the call once per statement (an InitPlan)
 *     rather than once per row, which is the advisor's `auth_rls_initplan` lint. `auth.uid()` is
 *     STABLE, so the result is identical; only the call count changes.
 *
 * Asserting on the policy definition rather than on a timing measurement is deliberate: a
 * per-row-vs-per-statement difference is invisible at test scale and a benchmark here would be
 * noise, so the durable property is the shape of the predicate.
 */
test('the user_settings policies name authenticated and hoist auth.uid() (#385)', async () => {
  const rows = await withPg(async (pg) => {
    const res = await pg.query<{
      polname: string
      roles: string
      qual: string | null
      withcheck: string | null
    }>(
      `select p.polname,
              coalesce(
                (select string_agg(r.rolname, ',' order by r.rolname)
                   from pg_roles r where r.oid = any(p.polroles)),
                'PUBLIC'
              ) as roles,
              pg_get_expr(p.polqual, p.polrelid) as qual,
              pg_get_expr(p.polwithcheck, p.polrelid) as withcheck
         from pg_policy p
         join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'user_settings'
        order by p.polname`,
    )
    return res.rows
  })

  expect(rows.map((r) => r.polname)).toEqual([
    'user_settings_insert_own',
    'user_settings_select_own',
    'user_settings_update_own',
  ])

  for (const row of rows) {
    // Not `PUBLIC`, and not some other role that happens to be non-public.
    expect(row.roles).toBe('authenticated')

    // `(select auth.uid())` renders with the subquery intact; a bare call does not.
    const expressions = [row.qual, row.withcheck].filter((e): e is string => e !== null)
    expect(expressions.length).toBeGreaterThan(0)
    for (const expression of expressions) {
      expect(expression).toContain('( SELECT auth.uid()')
    }
  }

  // There is still no DELETE policy: default-deny, and the `auth.users` cascade is the only remover.
  expect(rows).toHaveLength(3)
})
