import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  anonClient,
  boardTaskInsert,
  createTestUser,
  currentBoardId,
  deleteTestUser,
  legacyTaskInsert,
  withPg,
  type TestUser,
} from './helpers'

/**
 * Behavioural tests for the Board foundation.
 *
 * The structural tests prove the new tables have RLS, a policy, and grants. None of that says the
 * isolation actually holds — a table can satisfy every structural check and still return another
 * account's rows. These drive the real Data API as two real signed-in users.
 */

let alice: TestUser
let bob: TestUser
let aliceBoardId: string
let aliceMembershipId: string

/**
 * Runs an INSERT as `postgres` and returns the error message, or '' on success.
 *
 * Issued outside RLS on purpose: it is how a constraint gets tested independently of any policy.
 * A test that went through the Data API could not tell "the constraint refused this" apart from
 * "the policy refused this", and the constraint is the one that has to hold for callers who
 * legitimately can edit both boards.
 */
async function rawInsertError(sql: string, params: unknown[]): Promise<string> {
  return withPg(async (pg) => {
    try {
      await pg.query(sql, params)
      return ''
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  })
}

beforeAll(async () => {
  alice = await createTestUser()
  bob = await createTestUser()

  const { data, error } = await alice.client
    .from('board_memberships')
    .select('id, board_id')
    .single()
  if (error) throw new Error(`fixture read failed: ${error.message}`)
  aliceBoardId = data.board_id
  aliceMembershipId = data.id
})

afterAll(async () => {
  for (const user of [alice, bob]) {
    if (user) await deleteTestUser(user)
  }
})

test('signup seeds exactly one board, one owner membership, and one profile', async () => {
  // The signup trigger now writes four rows in one transaction instead of one. If any of them
  // failed, registration itself would fail — so this asserts the shape, and `createTestUser`
  // succeeding at all is the atomicity check.
  const { data: memberships } = await alice.client
    .from('board_memberships')
    .select('board_id, role, ended_at, default_view')
  expect(memberships).toHaveLength(1)
  expect(memberships?.[0].role).toBe('owner')
  expect(memberships?.[0].ended_at).toBeNull()
  expect(memberships?.[0].default_view).toBe('calendar')

  const { data: boards } = await alice.client.from('boards').select('id')
  expect(boards).toHaveLength(1)

  const { data: profiles } = await alice.client.from('account_profiles').select('account_id')
  expect(profiles).toHaveLength(1)
  expect(profiles?.[0].account_id).toBe(alice.id)
})

test('bob sees his own board and membership, never alice’s', async () => {
  // RLS filters rather than errors, so the failure this guards against looks like extra rows, not
  // an exception. Asserting "exactly one, and it is mine" catches a policy that is too broad in a
  // way that `expect(error).toBeNull()` never would.
  const { data: boards, error: boardsError } = await bob.client.from('boards').select('id')
  expect(boardsError).toBeNull()
  expect(boards).toHaveLength(1)
  expect(boards?.[0].id).not.toBe(aliceBoardId)

  const { data: memberships } = await bob.client.from('board_memberships').select('id, account_id')
  expect(memberships).toHaveLength(1)
  expect(memberships?.[0].account_id).toBe(bob.id)

  const { data: profiles } = await bob.client.from('account_profiles').select('account_id')
  expect(profiles).toHaveLength(1)
  expect(profiles?.[0].account_id).toBe(bob.id)
})

test('a member may change their own default_view but not their own role', async () => {
  // The column-level grant is the mechanism here, not the policy: RLS cannot express "only this
  // column changed" because a policy cannot see the old row. So the row-scoping is the policy's job
  // and the column-scoping is the grant's, and this asserts both halves at once.
  const { error: allowed } = await alice.client
    .from('board_memberships')
    .update({ default_view: 'kanban' })
    .eq('id', aliceMembershipId)
  expect(allowed).toBeNull()

  const { data: after } = await alice.client
    .from('board_memberships')
    .select('default_view, role')
    .single()
  expect(after?.default_view).toBe('kanban')

  // Self-promotion is the escalation this prevents. Without the column grant, the row policy alone
  // would happily allow it — the row is hers.
  //
  // Note the generated types do NOT prevent this: `role` is in the Update type like any other
  // column, because column-level grants are a runtime privilege and nothing in the schema JSON
  // expresses them. The type system offers no help here at all, which is precisely why the check
  // has to be a real round trip against the database rather than a compile-time assertion.
  const { error: denied } = await alice.client
    .from('board_memberships')
    .update({ role: 'viewer' })
    .eq('id', aliceMembershipId)
  expect(denied).not.toBeNull()

  const { data: unchanged } = await alice.client.from('board_memberships').select('role').single()
  expect(unchanged?.role).toBe('owner')
})

test('a member cannot create boards or memberships directly', async () => {
  // Board lifecycle and membership administration are command-owned. No INSERT grant exists for
  // either table, so these fail on privilege before any policy is consulted.
  const { error: boardError } = await alice.client.from('boards').insert({ name: 'smuggled' })
  expect(boardError).not.toBeNull()

  const { error: membershipError } = await alice.client
    .from('board_memberships')
    .insert({ board_id: aliceBoardId, account_id: alice.id, role: 'owner' })
  expect(membershipError).not.toBeNull()
})

test('an account can still read its own ENDED membership', async () => {
  // Deliberate, and it is not a convenience. When membership revocation has to reach a live client,
  // the UPDATE that sets `ended_at` must remain visible to the account it concerns — a
  // current-rows-only policy would filter out the very event that says "you were removed", and the
  // client would sit on a board it no longer has.
  // Seeded through direct SQL, not the service client, and that is deliberate: `service_role` has
  // no INSERT on these tables and should not be given one to make a test easier. Board lifecycle
  // and membership administration are command-owned, so no Data API role writes them directly —
  // widening a production grant for a fixture would quietly undo that.
  const boardId = await withPg(async (pg) => {
    const board = await pg.query<{ id: string }>(
      `insert into public.boards (name) values ('ended-membership fixture') returning id`,
    )
    await pg.query(
      `insert into public.board_memberships
         (board_id, account_id, role, ended_at, end_reason)
       values ($1, $2, 'viewer', now(), 'removed')`,
      [board.rows[0].id, bob.id],
    )
    return board.rows[0].id
  })

  const { data: rows } = await bob.client
    .from('board_memberships')
    .select('board_id, ended_at, end_reason')
    .not('ended_at', 'is', null)
  expect(rows).toHaveLength(1)
  expect(rows?.[0].end_reason).toBe('removed')

  // ...but the ended membership grants no access to the board itself.
  const { data: boards } = await bob.client.from('boards').select('id').eq('id', boardId)
  expect(boards).toEqual([])

  await withPg((pg) => pg.query(`delete from public.boards where id = $1`, [boardId]))
})

test('anonymous reads return zero rows rather than an error', async () => {
  // Load-bearing, not pedantry: `useSettings` runs an unauthenticated select during boot and treats
  // an error differently from an empty result. Every new table is granted SELECT to `anon` on
  // purpose — RLS, not the grant, is what denies it — so each must deny by filtering.
  const anon = anonClient()
  for (const table of ['boards', 'board_memberships', 'account_profiles'] as const) {
    const { data, error } = await anon.from(table).select('*')
    expect(error, `${table} should filter, not error`).toBeNull()
    expect(data, `${table} should be empty for anon`).toEqual([])
  }
})

test('a pre-cutover client that sends no board_id fails closed', async () => {
  // This test asserted the OPPOSITE until Board creation shipped, and the inversion is the entire
  // security content of that release. `tasks_infer_board_id` used to rescue this payload by routing
  // it to the account's only Board. That was correct only while there was exactly one; with a
  // second reachable it would file the task into whichever Board it picked, silently and wrongly.
  //
  // The refusal is an RLS violation rather than a null-violation, and the ordering is the reason:
  // Postgres evaluates `tasks_insert_editor`'s `with check` before the NOT NULL constraint, and
  // `NULL in (select ...)` is NULL, not true. Assert the refusal, not the wording.
  const { error } = await alice.client
    .from('tasks')
    .insert(legacyTaskInsert({ title: 'legacy-shaped insert' }))
  expect(error).not.toBeNull()

  // Nothing was written. A fail-closed test that only checks the error would still pass if the row
  // landed and the response merely errored.
  const leaked = await withPg(async (pg) => {
    const result = await pg.query<{ n: string }>(
      `select count(*) as n from public.tasks where title = 'legacy-shaped insert'`,
    )
    return Number(result.rows[0].n)
  })
  expect(leaked).toBe(0)
})

test('the same client succeeds the moment it names a Board', async () => {
  // The other half: the refusal above is about the missing Board, not about this client being
  // rejected generally. Without this, a policy that denied every insert would pass the test above.
  const { data, error } = await alice.client
    .from('tasks')
    .insert(boardTaskInsert(aliceBoardId, { title: 'board-scoped insert' }))
    .select('board_id, revision, author_kind')
    .single()
  expect(error).toBeNull()
  expect(data?.board_id).toBe(aliceBoardId)
  expect(data?.revision).toBe(1)
  expect(data?.author_kind).toBe('author')

  await alice.client.from('tasks').delete().eq('board_id', aliceBoardId)
})

test('board containment IS the authorization boundary', async () => {
  // This test used to assert the opposite, and the flip is the whole point of the cutover. Before
  // it, `tasks` policies compared `user_id` to `auth.uid()`, so bob could file a task into alice's
  // board: the foreign key permitted it and nothing checked membership. Nothing leaked — alice's
  // own policy was `user_id`-scoped too, so she could not see it — but containment was decorative.
  //
  // Now the INSERT policy's WITH CHECK requires the incoming `board_id` to be one the caller may
  // edit, so the row is refused outright.
  const { error } = await bob.client
    .from('tasks')
    .insert({ title: 'cross-board', board_id: aliceBoardId })
  expect(error).not.toBeNull()
  expect(error?.code).toBe('42501')

  const { data: aliceSees } = await alice.client.from('tasks').select('id')
  expect(aliceSees).toEqual([])
})

test('a non-member cannot read, update, or delete another board’s tasks', async () => {
  // The three read/write legs, asserted separately because they are three policies and a mistake in
  // any one of them is invisible from the others. SELECT filters (no error, no rows); UPDATE and
  // DELETE match nothing rather than erroring, because a row you cannot see is a row you cannot
  // target — which is why each assertion checks the row is still intact afterwards rather than
  // trusting an empty result.
  const { data: seeded, error: seedError } = await alice.client
    .from('tasks')
    .insert({ title: 'alice private', board_id: aliceBoardId })
    .select('id')
    .single()
  expect(seedError).toBeNull()

  const { data: bobSees, error: readError } = await bob.client
    .from('tasks')
    .select('id')
    .eq('id', seeded!.id)
  expect(readError).toBeNull()
  expect(bobSees).toEqual([])

  const { data: updated } = await bob.client
    .from('tasks')
    .update({ title: 'hijacked' })
    .eq('id', seeded!.id)
    .select('id')
  expect(updated).toEqual([])

  await bob.client.from('tasks').delete().eq('id', seeded!.id)

  const { data: survived } = await alice.client
    .from('tasks')
    .select('title')
    .eq('id', seeded!.id)
    .single()
  expect(survived?.title).toBe('alice private')

  await alice.client.from('tasks').delete().eq('id', seeded!.id)
})

test('an ended membership grants no task access at all', async () => {
  // Revocation, end to end at the database boundary. The membership row survives for history, so
  // the predicate that matters is `ended_at is null` — dropping that clause from any of the four
  // policies would let every former member keep full access, which no test above would catch.
  const { data: seeded } = await alice.client
    .from('tasks')
    .insert({ title: 'still alice', board_id: aliceBoardId })
    .select('id')
    .single()

  // Give bob a real, current membership on alice's board, then end it.
  await withPg((pg) =>
    pg.query(
      `insert into public.board_memberships (board_id, account_id, role)
       values ($1, $2, 'editor')`,
      [aliceBoardId, bob.id],
    ),
  )
  const { data: whileMember } = await bob.client.from('tasks').select('id').eq('id', seeded!.id)
  expect(whileMember).toHaveLength(1) // sanity: the fixture actually granted access

  await withPg((pg) =>
    pg.query(
      `update public.board_memberships set ended_at = now(), end_reason = 'removed'
        where board_id = $1 and account_id = $2 and ended_at is null`,
      [aliceBoardId, bob.id],
    ),
  )

  const { data: afterRemoval, error } = await bob.client
    .from('tasks')
    .select('id')
    .eq('id', seeded!.id)
  expect(error).toBeNull()
  expect(afterRemoval).toEqual([])

  const { error: writeError } = await bob.client
    .from('tasks')
    .insert({ title: 'after removal', board_id: aliceBoardId })
  expect(writeError).not.toBeNull()

  await alice.client.from('tasks').delete().eq('id', seeded!.id)
  await withPg((pg) =>
    pg.query(`delete from public.board_memberships where board_id = $1 and account_id = $2`, [
      aliceBoardId,
      bob.id,
    ]),
  )
})

test('a viewer may read a board but not write to it', async () => {
  // The role distinction, enforced where it actually matters. `src/board/role.ts` decides whether
  // to render a button; this decides whether the write lands. A viewer whose UI was bypassed — an
  // old client, a crafted request — must still be refused here.
  const { data: seeded } = await alice.client
    .from('tasks')
    .insert({ title: 'viewable', board_id: aliceBoardId })
    .select('id')
    .single()

  await withPg((pg) =>
    pg.query(
      `insert into public.board_memberships (board_id, account_id, role)
       values ($1, $2, 'viewer')`,
      [aliceBoardId, bob.id],
    ),
  )

  const { data: canRead } = await bob.client.from('tasks').select('id').eq('id', seeded!.id)
  expect(canRead).toHaveLength(1)

  const { error: insertError } = await bob.client
    .from('tasks')
    .insert({ title: 'viewer write', board_id: aliceBoardId })
  expect(insertError).not.toBeNull()
  expect(insertError?.code).toBe('42501')

  const { data: updated } = await bob.client
    .from('tasks')
    .update({ title: 'viewer edit' })
    .eq('id', seeded!.id)
    .select('id')
  expect(updated).toEqual([])

  await bob.client.from('tasks').delete().eq('id', seeded!.id)
  const { data: survived } = await alice.client
    .from('tasks')
    .select('title')
    .eq('id', seeded!.id)
    .single()
  expect(survived?.title).toBe('viewable')

  await alice.client.from('tasks').delete().eq('id', seeded!.id)
  await withPg((pg) =>
    pg.query(`delete from public.board_memberships where board_id = $1 and account_id = $2`, [
      aliceBoardId,
      bob.id,
    ]),
  )
})

test('a recurring series cannot span boards', async () => {
  // Enforced by the composite foreign key `(board_id, recur_parent_id) -> (board_id, id)`, not by a
  // policy — so it holds even for a caller who can legitimately edit both boards, which is exactly
  // the case a policy could not catch.
  const { data: template } = await alice.client
    .from('tasks')
    .insert({
      title: 'template',
      board_id: aliceBoardId,
      recur_freq: 'daily',
    })
    .select('id')
    .single()

  const { data: bobBoard } = await bob.client.from('board_memberships').select('board_id').single()

  const message = await rawInsertError(
    `insert into public.tasks (title, board_id, recur_parent_id, recur_origin_day)
     values ('orphan instance', $1, $2, current_date)`,
    [bobBoard!.board_id, template!.id],
  )
  // A foreign-key violation, not a permission error: this is issued as `postgres`, which bypasses
  // RLS entirely, so the only thing that can refuse it is the constraint itself.
  expect(message).toMatch(/tasks_recur_parent_same_board|foreign key/i)

  await alice.client.from('tasks').delete().eq('id', template!.id)
})

test('deleting an Account still destroys its Tasks, now through the Board rather than a foreign key', async () => {
  // This guarantee changed hands in #197 and was untested on both sides of the move. It used to be
  // `tasks_user_id_fkey ... ON DELETE CASCADE` — the Account's `auth.users` row went away and took
  // its Tasks with it. That column is gone, so it now rests on `handle_account_deletion` dropping
  // the Account's Private Boards and `tasks.board_id`'s own cascade doing the rest.
  //
  // Same outcome, entirely different mechanism, and nothing else would notice if the trigger
  // regressed: the Tasks would simply outlive the Account, invisible to every policy.
  const departing = await createTestUser()
  const boardId = await currentBoardId(departing.id)

  const { error: writeError } = await departing.client
    .from('tasks')
    .insert(boardTaskInsert(boardId, { title: 'should not outlive its account' }))
  expect(writeError).toBeNull()

  await deleteTestUser(departing)

  const remains = await withPg(async (pg) => {
    const result = await pg.query<{ tasks: string; boards: string; labels: string }>(
      `select
         (select count(*) from public.tasks where board_id = $1) as tasks,
         (select count(*) from public.boards where id = $1) as boards,
         (select count(*) from public.labels where board_id = $1) as labels`,
      [boardId],
    )
    const r = result.rows[0]
    return { tasks: Number(r.tasks), boards: Number(r.boards), labels: Number(r.labels) }
  })
  expect(remains).toEqual({ tasks: 0, boards: 0, labels: 0 })
})
