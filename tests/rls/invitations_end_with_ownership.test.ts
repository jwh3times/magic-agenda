import { afterAll, beforeAll, expect, test } from 'vitest'
import { createTestUser, currentBoardId, deleteTestUser, withPg, type TestUser } from './helpers'

/**
 * A pending Invitation lasts only as long as its issuer's Ownership. Accepting never asks who
 * issued it, so without this an Owner who is removed, demoted, or leaves — or whose account is
 * deleted — keeps a way back in for 14 days: an Invitation addressed to a second account of
 * their own. Ending the Ownership revokes what it issued, on that Board, in the same transaction.
 */

const everyone: TestUser[] = []
async function user(): Promise<TestUser> {
  const created = await createTestUser()
  everyone.push(created)
  return created
}

let owner: TestUser
let boardId: string

beforeAll(async () => {
  owner = await user()
  boardId = await currentBoardId(owner.id)
})

afterAll(async () => {
  await withPg((pg) =>
    pg.query(
      `update public.board_memberships set ended_at = now(), end_reason = 'removed'
        where board_id = $1 and account_id <> $2 and ended_at is null`,
      [boardId, owner.id],
    ),
  )
  for (const created of everyone) await deleteTestUser(created)
})

/** A second Owner of the Board, and that Membership's id. */
async function coOwner(): Promise<{ account: TestUser; membershipId: string }> {
  const account = await user()
  const membershipId = await withPg(async (pg) => {
    const { rows } = await pg.query<{ id: string }>(
      `insert into public.board_memberships (board_id, account_id, role)
       values ($1, $2, 'owner') returning id`,
      [boardId, account.id],
    )
    return rows[0].id
  })
  return { account, membershipId }
}

async function invite(as: TestUser): Promise<{ token: string; invitee: TestUser }> {
  const invitee = await user()
  const { data, error } = await as.client.rpc('create_invitation', {
    p_board_id: boardId,
    p_email: invitee.email,
    p_role: 'editor',
  })
  if (error) throw new Error(`create_invitation failed: ${error.message}`)
  return { token: data, invitee }
}

const statusOf = (token: string) =>
  withPg(async (pg) => {
    const { rows } = await pg.query<{ status: string; responded_at: string | null }>(
      `select status, responded_at from public.board_invitations
        where token_hash = sha256(convert_to($1, 'UTF8'))`,
      [token],
    )
    return rows[0]
  })

const accept = (invitee: TestUser, token: string) =>
  invitee.client.rpc('accept_invitation', { p_token: token })

async function expectRevoked(token: string, invitee: TestUser) {
  const row = await statusOf(token)
  expect(row.status).toBe('revoked')
  expect(row.responded_at).not.toBeNull()
  expect((await accept(invitee, token)).error?.message).toBe('invitation-unavailable')
}

/** Resolves once a backend running `fragment` is waiting on a lock. */
async function waitForLockWait(fragment: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const waiting = await withPg(async (pg) => {
      const { rows } = await pg.query<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity
          where wait_event_type = 'Lock' and query ilike $1`,
        [`%${fragment}%`],
      )
      return rows[0].n
    })
    if (waiting > 0) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`no backend running ${fragment} ever waited on a lock`)
}

test("removing an Owner revokes that Owner's pending invitations, and only theirs", async () => {
  const removed = await coOwner()
  const theirs = await invite(removed.account)
  const mine = await invite(owner)

  const { error } = await owner.client.rpc('remove_member', {
    p_membership_id: removed.membershipId,
  })
  expect(error).toBeNull()

  await expectRevoked(theirs.token, theirs.invitee)
  expect((await statusOf(mine.token)).status).toBe('pending')
  expect((await accept(mine.invitee, mine.token)).error).toBeNull()
})

test("demoting an Owner revokes that Owner's pending invitations", async () => {
  const demoted = await coOwner()
  const theirs = await invite(demoted.account)

  const { error } = await owner.client.rpc('change_member_role', {
    p_membership_id: demoted.membershipId,
    p_role: 'editor',
  })
  expect(error).toBeNull()

  await expectRevoked(theirs.token, theirs.invitee)
})

test('an Owner who leaves takes their pending invitations with them', async () => {
  const leaving = await coOwner()
  const theirs = await invite(leaving.account)

  const { error } = await leaving.account.client.rpc('leave_board', { p_board_id: boardId })
  expect(error).toBeNull()

  await expectRevoked(theirs.token, theirs.invitee)
})

test("deleting an Owner's account revokes their pending invitations", async () => {
  const deleted = await coOwner()
  const theirs = await invite(deleted.account)

  await deleteTestUser(deleted.account)
  everyone.splice(everyone.indexOf(deleted.account), 1)

  await expectRevoked(theirs.token, theirs.invitee)
})

test('a role change that keeps Ownership, or ends a non-Owner, revokes nothing', async () => {
  const staying = await coOwner()
  const theirs = await invite(staying.account)
  const editor = await user()
  const editorMembership = await withPg(async (pg) => {
    const { rows } = await pg.query<{ id: string }>(
      `insert into public.board_memberships (board_id, account_id, role)
       values ($1, $2, 'editor') returning id`,
      [boardId, editor.id],
    )
    return rows[0].id
  })
  const changeRole = (membershipId: string, role: string) =>
    owner.client.rpc('change_member_role', { p_membership_id: membershipId, p_role: role })

  // An Owner whose row is rewritten as Owner, an Editor promoted and demoted, and a non-Owner
  // removed: none of these ends an Ownership that issued anything.
  await withPg((pg) =>
    pg.query(`update public.board_memberships set role = 'owner' where id = $1`, [
      staying.membershipId,
    ]),
  )
  expect((await changeRole(editorMembership, 'owner')).error).toBeNull()
  expect((await changeRole(editorMembership, 'viewer')).error).toBeNull()
  expect(
    (await owner.client.rpc('remove_member', { p_membership_id: editorMembership })).error,
  ).toBeNull()

  expect((await statusOf(theirs.token)).status).toBe('pending')
})

test('an acceptance waiting on the Board lock does not deadlock the Ownership ending', async () => {
  // Every path that ends an Ownership locks the Board and then, through the trigger, the
  // Invitation rows. Acceptance must take them in the same order: holding the Invitation while
  // it waits for the Board is a deadlock, and on account deletion an aborted transaction leaves
  // an account whose files were already swept.
  const ending = await coOwner()
  const theirs = await invite(ending.account)
  const { id } = await withPg(async (pg) => {
    const { rows } = await pg.query<{ id: string }>(
      `select id from public.board_invitations where token_hash = sha256(convert_to($1, 'UTF8'))`,
      [theirs.token],
    )
    return rows[0]
  })

  await withPg(async (pg) => {
    await pg.query('begin')
    await pg.query('select 1 from public.boards where id = $1 for update', [boardId])
    // The query builder sends nothing until it is awaited; `.then` starts it now.
    const accepting = accept(theirs.invitee, theirs.token).then((result) => result)
    // Wait until the acceptance is blocked on a lock: before the fix it holds the Invitation and
    // waits for the Board; after it, it waits for the Board holding nothing.
    await waitForLockWait('accept_invitation')
    await pg.query(
      `update public.board_invitations set status = 'revoked', responded_at = now() where id = $1`,
      [id],
    )
    await pg.query('commit')
    expect((await accepting).error?.message).toBe('invitation-unavailable')
  })
})
