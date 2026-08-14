import { afterAll, beforeAll, expect, test } from 'vitest'
import { anonClient, createTestUser, deleteTestUser, withPg, type TestUser } from './helpers'

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

test('a task inserted without board_id is routed to the account’s board', async () => {
  // The compatibility shim for the currently-deployed client, which has never heard of a Board.
  // This trigger is TEMPORARY: it is only correct while an account has exactly one board, and
  // dropping it is what makes a stale client fail closed once a second board can exist.
  const { data, error } = await alice.client
    .from('tasks')
    .insert({ user_id: alice.id, title: 'legacy-shaped insert' })
    .select('board_id, revision, author_kind')
    .single()
  expect(error).toBeNull()
  expect(data?.board_id).toBe(aliceBoardId)
  expect(data?.revision).toBe(1)
  expect(data?.author_kind).toBe('author')

  await alice.client.from('tasks').delete().eq('board_id', aliceBoardId)
})

test('board containment is NOT yet an authorization boundary', async () => {
  // Documents the current state rather than asserting a security property, because getting this
  // wrong in the other direction is the real risk: someone reads "boards exist" and assumes tasks
  // are scoped by them. They are not. `tasks` policies still compare `user_id` to `auth.uid()`, so
  // bob can attach a task to alice's board id — the FK permits it and nothing checks membership.
  //
  // Alice still cannot SEE it (her policy is `user_id`-scoped too), so nothing leaks; what is
  // missing is containment integrity, and closing it is exactly what the authorization cutover
  // does. When that lands, this test flips to expecting an error — a visible, deliberate change
  // rather than a silent one.
  const { data, error } = await bob.client
    .from('tasks')
    .insert({ user_id: bob.id, title: 'cross-board', board_id: aliceBoardId })
    .select('id')
    .single()
  expect(error).toBeNull()

  const { data: aliceSees } = await alice.client.from('tasks').select('id')
  expect(aliceSees).toEqual([])

  await bob.client.from('tasks').delete().eq('id', data!.id)
})
