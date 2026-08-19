import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  boardTaskInsert,
  createTestUser,
  currentBoardId,
  deleteTestUser,
  withPg,
  type TestUser,
} from './helpers'

let owner: TestUser

/** Rows remaining anywhere in the schema that belong to `boardId`, counted past RLS. */
async function contentsOf(boardId: string) {
  return withPg(async (pg) => {
    const result = await pg.query<{
      boards: string
      memberships: string
      labels: string
      tasks: string
    }>(
      `select
         (select count(*) from public.boards where id = $1) as boards,
         (select count(*) from public.board_memberships where board_id = $1) as memberships,
         (select count(*) from public.labels where board_id = $1) as labels,
         (select count(*) from public.tasks where board_id = $1) as tasks`,
      [boardId],
    )
    const r = result.rows[0]
    return {
      boards: Number(r.boards),
      memberships: Number(r.memberships),
      labels: Number(r.labels),
      tasks: Number(r.tasks),
    }
  })
}

async function seedBoard(user: TestUser, name: string): Promise<string> {
  const { data, error } = await user.client.rpc('create_board', { board_name: name })
  if (error || !data) throw new Error(`create_board failed: ${error?.message}`)
  await user.client.from('tasks').insert(boardTaskInsert(data, { title: `task in ${name}` }))
  return data
}

beforeAll(async () => {
  owner = await createTestUser()
})

afterAll(async () => {
  if (owner) await deleteTestUser(owner)
})

test('deleting a Board destroys its tasks, labels, and membership through the cascade', async () => {
  const boardId = await seedBoard(owner, 'Doomed')

  const before = await contentsOf(boardId)
  expect(before).toEqual({ boards: 1, memberships: 1, labels: 5, tasks: 1 })

  const { error } = await owner.client.from('boards').delete().eq('id', boardId)
  expect(error).toBeNull()

  // Referential actions are not subject to RLS — they run as the referencing table's owner — so
  // the caller's policies on `tasks` and `labels` neither permit nor prevent this. Asserted rather
  // than assumed: a cascade that silently failed would leave rows pointing at a Board that is gone.
  expect(await contentsOf(boardId)).toEqual({ boards: 0, memberships: 0, labels: 0, tasks: 0 })
})

test('deletion is confined to the Board deleted', async () => {
  const keep = await seedBoard(owner, 'Kept')
  const drop = await seedBoard(owner, 'Dropped')

  await owner.client.from('boards').delete().eq('id', drop)

  expect(await contentsOf(drop)).toEqual({ boards: 0, memberships: 0, labels: 0, tasks: 0 })
  expect(await contentsOf(keep)).toEqual({ boards: 1, memberships: 1, labels: 5, tasks: 1 })
})

/**
 * Note what these refusal tests assert, and what they deliberately do not.
 *
 * A DELETE that RLS refuses is not an error: it matches zero rows and returns success. Asserting
 * `error` here would pass for the wrong reason on a policy that permitted everything, so every case
 * below asserts the Board is *still there* instead.
 */
test('an Editor and a Viewer cannot delete the Board', async () => {
  for (const role of ['editor', 'viewer'] as const) {
    const member = await createTestUser()
    try {
      const boardId = await seedBoard(owner, `Guarded from ${role}`)
      await withPg(async (pg) => {
        await pg.query(
          `insert into public.board_memberships (board_id, account_id, role) values ($1, $2, $3)`,
          [boardId, member.id, role],
        )
      })

      // Positive control: without it, a membership seed that quietly failed would make the
      // refusal below pass for the wrong reason.
      const { data: visible } = await member.client.from('boards').select('id').eq('id', boardId)
      expect(visible).toEqual([{ id: boardId }])

      await member.client.from('boards').delete().eq('id', boardId)
      expect((await contentsOf(boardId)).boards).toBe(1)
    } finally {
      await deleteTestUser(member)
    }
  }
})

test('a non-member cannot delete a Board they can name', async () => {
  const stranger = await createTestUser()
  try {
    const boardId = await seedBoard(owner, 'Not theirs')

    await stranger.client.from('boards').delete().eq('id', boardId)
    expect((await contentsOf(boardId)).boards).toBe(1)
  } finally {
    await deleteTestUser(stranger)
  }
})

test('an ended Membership cannot delete, even for a former Owner', async () => {
  const formerOwner = await createTestUser()
  try {
    const boardId = await seedBoard(owner, 'Former ownership')
    await withPg(async (pg) => {
      await pg.query(
        `insert into public.board_memberships (board_id, account_id, role, ended_at, end_reason)
         values ($1, $2, 'owner', now(), 'removed')`,
        [boardId, formerOwner.id],
      )
    })

    await formerOwner.client.from('boards').delete().eq('id', boardId)
    expect((await contentsOf(boardId)).boards).toBe(1)
  } finally {
    await deleteTestUser(formerOwner)
  }
})

test('an Owner may delete their last Board, leaving the Account with none', async () => {
  // Zero Boards is a legitimate domain state, not an error to be prevented at the boundary.
  const soloUser = await createTestUser()
  try {
    const only = await currentBoardId(soloUser.id)
    const { error } = await soloUser.client.from('boards').delete().eq('id', only)
    expect(error).toBeNull()

    const remaining = await withPg(async (pg) => {
      const result = await pg.query<{ n: string }>(
        `select count(*) as n from public.board_memberships
          where account_id = $1 and ended_at is null`,
        [soloUser.id],
      )
      return Number(result.rows[0].n)
    })
    expect(remaining).toBe(0)

    // And the Account can recover without support: creation still works from zero.
    const { data: replacement, error: createError } = await soloUser.client.rpc('create_board', {
      board_name: 'Starting over',
    })
    expect(createError).toBeNull()
    expect(replacement).toEqual(expect.any(String))
  } finally {
    await deleteTestUser(soloUser)
  }
})

test('deleting a Board cannot reach another Account content', async () => {
  const other = await createTestUser()
  try {
    const mine = await seedBoard(owner, 'Mine')
    const theirs = await currentBoardId(other.id)
    await other.client.from('tasks').insert(boardTaskInsert(theirs, { title: 'theirs' }))

    await owner.client.from('boards').delete().eq('id', mine)

    expect(await contentsOf(mine)).toEqual({ boards: 0, memberships: 0, labels: 0, tasks: 0 })
    expect(await contentsOf(theirs)).toEqual({ boards: 1, memberships: 1, labels: 5, tasks: 1 })
  } finally {
    await deleteTestUser(other)
  }
})
