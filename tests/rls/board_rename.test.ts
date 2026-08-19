import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  createTestUser,
  currentBoardId,
  deleteTestUser,
  stack,
  withPg,
  type TestUser,
} from './helpers'

let owner: TestUser

async function nameOf(boardId: string): Promise<string | undefined> {
  return withPg(async (pg) => {
    const result = await pg.query<{ name: string }>(
      `select name from public.boards where id = $1`,
      [boardId],
    )
    return result.rows[0]?.name
  })
}

async function newBoard(user: TestUser, name: string): Promise<string> {
  const { data, error } = await user.client.rpc('create_board', { board_name: name })
  if (error || !data) throw new Error(`create_board failed: ${error?.message}`)
  return data
}

/** A raw PATCH, so a body can carry columns the typed client would never send. */
async function patchBoard(
  user: TestUser,
  boardId: string,
  body: Record<string, unknown>,
): Promise<number> {
  const local = stack()
  const { data } = await user.client.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('test user has no session')

  const response = await fetch(`${local.apiUrl}/rest/v1/boards?id=eq.${boardId}`, {
    method: 'PATCH',
    headers: {
      apikey: local.anonKey,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return response.status
}

beforeAll(async () => {
  owner = await createTestUser()
})

afterAll(async () => {
  if (owner) await deleteTestUser(owner)
})

test('an Owner can rename their Board', async () => {
  const boardId = await currentBoardId(owner.id)

  const { error } = await owner.client.from('boards').update({ name: 'Renamed' }).eq('id', boardId)
  expect(error).toBeNull()
  expect(await nameOf(boardId)).toBe('Renamed')
})

test('the name must be trimmed and within the length bound', async () => {
  const boardId = await newBoard(owner, 'Constraint subject')

  expect(await patchBoard(owner, boardId, { name: '  padded  ' })).toBe(400)
  expect(await patchBoard(owner, boardId, { name: '' })).toBe(400)
  expect(await patchBoard(owner, boardId, { name: 'x'.repeat(121) })).toBe(400)
  expect(await patchBoard(owner, boardId, { name: 'x'.repeat(120) })).toBe(204)

  expect(await nameOf(boardId)).toBe('x'.repeat(120))
})

test('the column grant refuses every column except the name', async () => {
  const boardId = await newBoard(owner, 'Column scoped')
  const other = await newBoard(owner, 'Elsewhere')

  // `grant update (name)` is what stops these, before any policy is consulted — RLS cannot express
  // "only this column changed" because a policy cannot see the old row.
  expect(await patchBoard(owner, boardId, { id: other })).toBe(403)
  expect(await patchBoard(owner, boardId, { created_at: '2000-01-01T00:00:00Z' })).toBe(403)
  expect(await patchBoard(owner, boardId, { updated_at: '2000-01-01T00:00:00Z' })).toBe(403)

  // ...including alongside a name the caller is otherwise allowed to write.
  expect(await patchBoard(owner, boardId, { name: 'Sneaky', id: other })).toBe(403)
  expect(await nameOf(boardId)).toBe('Column scoped')
})

test('renaming refreshes the modification timestamp through the trigger', async () => {
  const boardId = await newBoard(owner, 'Timestamped')
  const before = await withPg(async (pg) => {
    const r = await pg.query<{ updated_at: Date }>(
      `update public.boards set updated_at = '2000-01-01T00:00:00Z' where id = $1
       returning updated_at`,
      [boardId],
    )
    return r.rows[0].updated_at
  })

  await owner.client.from('boards').update({ name: 'Touched' }).eq('id', boardId)

  const after = await withPg(async (pg) => {
    const r = await pg.query<{ updated_at: Date }>(
      `select updated_at from public.boards where id = $1`,
      [boardId],
    )
    return r.rows[0].updated_at
  })
  expect(after.getTime()).toBeGreaterThan(before.getTime())
})

/**
 * As with deletion: an UPDATE that RLS refuses matches zero rows and returns success, so these
 * assert the name is unchanged rather than asserting on `error`.
 */
test('an Editor and a Viewer cannot rename the Board', async () => {
  for (const role of ['editor', 'viewer'] as const) {
    const member = await createTestUser()
    try {
      const boardId = await newBoard(owner, `Guarded from ${role}`)
      await withPg(async (pg) => {
        await pg.query(
          `insert into public.board_memberships (board_id, account_id, role) values ($1, $2, $3)`,
          [boardId, member.id, role],
        )
      })

      // Positive control: they really are a current member and can see the Board.
      const { data: visible } = await member.client.from('boards').select('name').eq('id', boardId)
      expect(visible).toEqual([{ name: `Guarded from ${role}` }])

      await member.client.from('boards').update({ name: 'Renamed by a member' }).eq('id', boardId)
      expect(await nameOf(boardId)).toBe(`Guarded from ${role}`)
    } finally {
      await deleteTestUser(member)
    }
  }
})

test('a non-member cannot rename a Board they can name', async () => {
  const stranger = await createTestUser()
  try {
    const boardId = await newBoard(owner, 'Not theirs')
    await stranger.client.from('boards').update({ name: 'Trespass' }).eq('id', boardId)
    expect(await nameOf(boardId)).toBe('Not theirs')
  } finally {
    await deleteTestUser(stranger)
  }
})

test('an ended Membership cannot rename, even for a former Owner', async () => {
  const formerOwner = await createTestUser()
  try {
    const boardId = await newBoard(owner, 'Former ownership')
    await withPg(async (pg) => {
      await pg.query(
        `insert into public.board_memberships (board_id, account_id, role, ended_at, end_reason)
         values ($1, $2, 'owner', now(), 'removed')`,
        [boardId, formerOwner.id],
      )
    })

    await formerOwner.client.from('boards').update({ name: 'Ghost rename' }).eq('id', boardId)
    expect(await nameOf(boardId)).toBe('Former ownership')
  } finally {
    await deleteTestUser(formerOwner)
  }
})
