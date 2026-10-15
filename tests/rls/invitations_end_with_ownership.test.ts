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

  // Promoting an Editor and removing them are both Membership changes on this Board.
  expect(
    (
      await owner.client.rpc('change_member_role', {
        p_membership_id: editorMembership,
        p_role: 'viewer',
      })
    ).error,
  ).toBeNull()
  expect(
    (await owner.client.rpc('remove_member', { p_membership_id: editorMembership })).error,
  ).toBeNull()

  expect((await statusOf(theirs.token)).status).toBe('pending')
})
