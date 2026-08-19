import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  anonClient,
  boardTaskInsert,
  createTestUser,
  currentBoardId,
  deleteTestUser,
  withPg,
  type TestUser,
} from './helpers'

let owner: TestUser

interface LabelRow {
  name: string
  dot_color: string
  position: number
}

async function vocabularyOf(boardId: string): Promise<LabelRow[]> {
  return withPg(async (pg) => {
    const result = await pg.query<LabelRow>(
      `select name, dot_color, position
         from public.labels where board_id = $1 order by position`,
      [boardId],
    )
    return result.rows
  })
}

async function membershipOf(boardId: string, accountId: string) {
  return withPg(async (pg) => {
    const result = await pg.query<{ role: string; ended: boolean }>(
      `select role, ended_at is not null as ended
         from public.board_memberships where board_id = $1 and account_id = $2`,
      [boardId, accountId],
    )
    return result.rows[0] ?? null
  })
}

beforeAll(async () => {
  owner = await createTestUser()
})

afterAll(async () => {
  if (owner) await deleteTestUser(owner)
})

test('creating a Board yields the Board, an Owner Membership, and the seeded vocabulary together', async () => {
  const { data: boardId, error } = await owner.client.rpc('create_board', {
    board_name: 'Side project',
  })
  expect(error).toBeNull()
  expect(boardId).toEqual(expect.any(String))

  const board = await withPg(async (pg) => {
    const result = await pg.query<{ name: string }>(
      `select name from public.boards where id = $1`,
      [boardId],
    )
    return result.rows[0]
  })
  expect(board).toEqual({ name: 'Side project' })

  // A Board with no Membership is unreachable by every policy in the schema, so "created" has to
  // mean both rows or neither.
  expect(await membershipOf(boardId!, owner.id)).toEqual({ role: 'owner', ended: false })
  expect(await vocabularyOf(boardId!)).toHaveLength(5)
})

test('a created Board and a signup Board have identical vocabularies', async () => {
  // The anti-drift test. `create_board` and `handle_new_user` each carry their own copy of the seed
  // list — a shared helper would have to take the account as a parameter, which is exactly the
  // escalation surface `create_board`'s signature avoids — so this is what keeps them equal.
  const signupBoard = await currentBoardId(owner.id)
  const { data: createdBoard, error } = await owner.client.rpc('create_board', {
    board_name: 'Vocabulary comparison',
  })
  expect(error).toBeNull()

  expect(await vocabularyOf(createdBoard!)).toEqual(await vocabularyOf(signupBoard))
})

test('the creator can immediately use the new Board, and it is separate from their others', async () => {
  const first = await currentBoardId(owner.id)
  const { data: second } = await owner.client.rpc('create_board', { board_name: 'Second' })

  const { error: writeError } = await owner.client
    .from('tasks')
    .insert(boardTaskInsert(second!, { user_id: owner.id, title: 'in the second board' }))
  expect(writeError).toBeNull()

  // Containment, not merely filtering: the task must not be reachable through the other Board.
  const { data: inFirst } = await owner.client.from('tasks').select('title').eq('board_id', first)
  expect(inFirst).toEqual([])

  const { data: inSecond } = await owner.client
    .from('tasks')
    .select('title')
    .eq('board_id', second!)
  expect(inSecond).toEqual([{ title: 'in the second board' }])

  await owner.client.from('tasks').delete().eq('board_id', second!)
})

test('a Board created by one Account is invisible and unwritable to another', async () => {
  const stranger = await createTestUser()
  try {
    const { data: boardId } = await owner.client.rpc('create_board', { board_name: 'Private' })

    const { data: visible } = await stranger.client.from('boards').select('id').eq('id', boardId!)
    expect(visible).toEqual([])

    const { data: labels } = await stranger.client
      .from('labels')
      .select('id')
      .eq('board_id', boardId!)
    expect(labels).toEqual([])

    const { error: writeError } = await stranger.client
      .from('tasks')
      .insert(boardTaskInsert(boardId!, { user_id: stranger.id, title: 'trespass' }))
    expect(writeError).not.toBeNull()
  } finally {
    await deleteTestUser(stranger)
  }
})

test('an Account cannot forge a Membership into a Board it does not belong to', async () => {
  // The reason creation is an RPC rather than two client INSERTs. `board_memberships` has no INSERT
  // policy at all, so this is refused by the absence of a policy rather than by a predicate — which
  // is the strongest form of "no".
  const stranger = await createTestUser()
  try {
    const { data: boardId } = await owner.client.rpc('create_board', { board_name: 'Not yours' })

    const { error } = await stranger.client
      .from('board_memberships')
      .insert({ board_id: boardId!, account_id: stranger.id, role: 'owner' })
    expect(error).not.toBeNull()

    expect(await membershipOf(boardId!, stranger.id)).toBeNull()
  } finally {
    await deleteTestUser(stranger)
  }
})

test('an anonymous caller cannot create a Board', async () => {
  const { error } = await anonClient().rpc('create_board', { board_name: 'From nowhere' })
  expect(error).not.toBeNull()
})

test('the Board name is trimmed, defaulted when blank, and length-capped', async () => {
  const { data: trimmed } = await owner.client.rpc('create_board', { board_name: '  Spaced  ' })
  const { data: blank } = await owner.client.rpc('create_board', { board_name: '   ' })

  const names = await withPg(async (pg) => {
    const result = await pg.query<{ id: string; name: string }>(
      `select id, name from public.boards where id = any($1::uuid[])`,
      [[trimmed, blank]],
    )
    return new Map(result.rows.map((r) => [r.id, r.name]))
  })
  expect(names.get(trimmed!)).toBe('Spaced')
  expect(names.get(blank!)).toBe('My Board')

  const { error: tooLong } = await owner.client.rpc('create_board', {
    board_name: 'x'.repeat(121),
  })
  expect(tooLong).not.toBeNull()
})

test('a failed creation leaves no orphan Board behind', async () => {
  const before = await withPg(async (pg) => {
    const result = await pg.query<{ n: string }>(`select count(*) as n from public.boards`)
    return Number(result.rows[0].n)
  })

  await owner.client.rpc('create_board', { board_name: 'y'.repeat(200) })

  const after = await withPg(async (pg) => {
    const result = await pg.query<{ n: string }>(`select count(*) as n from public.boards`)
    return Number(result.rows[0].n)
  })
  // The length check runs before the insert, but the assertion is about the property rather than
  // the ordering: a refused creation must not leave a Board that no Membership can reach.
  expect(after).toBe(before)
})

test('every Board in the schema has at least one Membership', async () => {
  // The invariant the RPC exists to protect, asserted over whatever this suite has created rather
  // than over one call. A Board with no Membership is invisible to every policy and unreachable
  // forever — there is no UI or query that could recover it.
  const orphans = await withPg(async (pg) => {
    const result = await pg.query<{ n: string }>(
      `select count(*) as n from public.boards b
        where not exists (select 1 from public.board_memberships m where m.board_id = b.id)`,
    )
    return Number(result.rows[0].n)
  })
  expect(orphans).toBe(0)
})
