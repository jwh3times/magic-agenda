import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  createTestUser,
  deleteTestUser,
  legacyTaskInsert,
  stack,
  withPg,
  type TestUser,
} from './helpers'

let owner: TestUser

async function ownerBoardId(): Promise<string> {
  return withPg(async (pg) => {
    const result = await pg.query<{ board_id: string }>(
      `select board_id from public.board_memberships
        where account_id = $1 and ended_at is null`,
      [owner.id],
    )
    return result.rows[0].board_id
  })
}

async function rawLabelInsertError(
  boardId: string,
  name: string,
  dotColor = '#000000',
  position = 99,
): Promise<string> {
  return withPg(async (pg) => {
    await pg.query('begin')
    try {
      await pg.query(
        `insert into public.labels (board_id, name, dot_color, position)
         values ($1, $2, $3, $4)`,
        [boardId, name, dotColor, position],
      )
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    } finally {
      await pg.query('rollback')
    }
  })
}

beforeAll(async () => {
  owner = await createTestUser()
})

afterAll(async () => {
  if (owner) await deleteTestUser(owner)
})

test('signup gives the new Board its five ordinary seeded Labels', async () => {
  const labels = await withPg(async (pg) => {
    const result = await pg.query<{ name: string; dot_color: string; position: number }>(
      `select l.name, l.dot_color, l.position
         from public.labels l
         join public.board_memberships m on m.board_id = l.board_id
        where m.account_id = $1
          and m.ended_at is null
        order by l.position`,
      [owner.id],
    )
    return result.rows
  })

  expect(labels).toEqual([
    { name: 'Work', dot_color: '#2563eb', position: 0 },
    { name: 'Personal', dot_color: '#db2777', position: 1 },
    { name: 'Errands', dot_color: '#d97706', position: 2 },
    { name: 'Ideas', dot_color: '#7c3aed', position: 3 },
    { name: 'Health', dot_color: '#059669', position: 4 },
  ])
})

test('a current member can read their Board Labels through the Data API', async () => {
  const { data } = await owner.client.auth.getSession()
  const session = data.session
  if (!session) throw new Error('test owner has no session')

  const local = stack()
  const response = await fetch(
    `${local.apiUrl}/rest/v1/labels?select=name,dot_color,position&order=position`,
    {
      headers: {
        apikey: local.anonKey,
        authorization: `Bearer ${session.access_token}`,
      },
    },
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual([
    { name: 'Work', dot_color: '#2563eb', position: 0 },
    { name: 'Personal', dot_color: '#db2777', position: 1 },
    { name: 'Errands', dot_color: '#d97706', position: 2 },
    { name: 'Ideas', dot_color: '#7c3aed', position: 3 },
    { name: 'Health', dot_color: '#059669', position: 4 },
  ])
})

test('an anonymous Label read is allowed but returns no rows', async () => {
  const local = stack()
  const response = await fetch(`${local.apiUrl}/rest/v1/labels?select=id`, {
    headers: { apikey: local.anonKey },
  })

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual([])
})

test('Label names are trimmed and case-insensitively unique within a Board', async () => {
  const boardId = await ownerBoardId()

  expect(await rawLabelInsertError(boardId, 'work')).toMatch(/unique|duplicate/i)
  expect(await rawLabelInsertError(boardId, '  Focus  ')).toMatch(/trim|check constraint/i)
})

test('Label Color is a hex accent and Label position cannot be negative', async () => {
  const boardId = await ownerBoardId()

  expect(await rawLabelInsertError(boardId, 'Bad color', 'blue')).toMatch(
    /dot_color|check constraint/i,
  )
  expect(await rawLabelInsertError(boardId, 'Bad position', '#123456', -1)).toMatch(
    /position|check constraint/i,
  )
})

test('updating a Label refreshes its modification timestamp', async () => {
  const boardId = await ownerBoardId()
  const updatedAt = await withPg(async (pg) => {
    await pg.query('begin')
    try {
      const label = await pg.query<{ id: string }>(
        `insert into public.labels
           (board_id, name, dot_color, position, updated_at)
         values ($1, 'Timestamped', '#123456', 98, '2000-01-01T00:00:00Z')
         returning id`,
        [boardId],
      )
      const updated = await pg.query<{ updated_at: Date }>(
        `update public.labels set name = 'Timestamp changed' where id = $1
         returning updated_at`,
        [label.rows[0].id],
      )
      return updated.rows[0].updated_at
    } finally {
      await pg.query('rollback')
    }
  })

  expect(updatedAt.getUTCFullYear()).toBeGreaterThan(2000)
})

test('a stale Category-shaped insert receives its matching seeded Label', async () => {
  const { data: task, error } = await owner.client
    .from('tasks')
    .insert(
      legacyTaskInsert({
        user_id: owner.id,
        title: 'legacy personal task',
        category: 'personal',
      }),
    )
    .select('id')
    .single()
  expect(error).toBeNull()

  const assigned = await withPg(async (pg) => {
    const result = await pg.query<{ name: string }>(
      `select l.name
         from public.tasks t
         join public.labels l on l.id = t.label_id
        where t.id = $1`,
      [task!.id],
    )
    return result.rows[0]?.name
  })

  expect(assigned).toBe('Personal')
})

test('a new client can explicitly create an Unlabeled Task during the compatibility window', async () => {
  const { data } = await owner.client.auth.getSession()
  const session = data.session
  if (!session) throw new Error('test owner has no session')

  const local = stack()
  const response = await fetch(
    `${local.apiUrl}/rest/v1/tasks?select=id,label_id,label_assignment_explicit`,
    {
      method: 'POST',
      headers: {
        apikey: local.anonKey,
        authorization: `Bearer ${session.access_token}`,
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({
        user_id: owner.id,
        board_id: await ownerBoardId(),
        title: 'explicitly unlabeled',
        category: 'work',
        label_id: null,
        label_assignment_explicit: true,
      }),
    },
  )

  expect(response.status).toBe(201)
  expect(await response.json()).toEqual([
    expect.objectContaining({ label_id: null, label_assignment_explicit: true }),
  ])
})

test('a stale Category change remaps the Task to the matching seeded Label', async () => {
  const { data: task, error: insertError } = await owner.client
    .from('tasks')
    .insert(
      legacyTaskInsert({
        user_id: owner.id,
        title: 'legacy recategorization',
        category: 'work',
      }),
    )
    .select('id')
    .single()
  expect(insertError).toBeNull()

  const { error: updateError } = await owner.client
    .from('tasks')
    .update({ category: 'health' })
    .eq('id', task!.id)
  expect(updateError).toBeNull()

  const assigned = await withPg(async (pg) => {
    const result = await pg.query<{ name: string }>(
      `select l.name
         from public.tasks t
         join public.labels l on l.id = t.label_id
        where t.id = $1`,
      [task!.id],
    )
    return result.rows[0]?.name
  })

  expect(assigned).toBe('Health')
})

test("a Task cannot reference another Board's Label", async () => {
  const otherOwner = await createTestUser()
  try {
    const ownerBoard = await ownerBoardId()
    const otherLabel = await withPg(async (pg) => {
      const result = await pg.query<{ id: string }>(
        `select l.id
           from public.labels l
           join public.board_memberships m on m.board_id = l.board_id
          where m.account_id = $1 and m.ended_at is null
          order by l.position
          limit 1`,
        [otherOwner.id],
      )
      return result.rows[0].id
    })

    const message = await withPg(async (pg) => {
      await pg.query('begin')
      try {
        await pg.query(
          `insert into public.tasks
             (user_id, board_id, title, label_id, label_assignment_explicit)
           values ($1, $2, 'cross-board label', $3, true)`,
          [owner.id, ownerBoard, otherLabel],
        )
        return ''
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      } finally {
        await pg.query('rollback')
      }
    })

    expect(message).toMatch(/tasks_label_same_board|foreign key/i)
  } finally {
    await deleteTestUser(otherOwner)
  }
})

test('deleting a Label leaves its Task Unlabeled on the same Board', async () => {
  const boardId = await ownerBoardId()

  const result = await withPg(async (pg) => {
    await pg.query('begin')
    try {
      const label = await pg.query<{ id: string }>(
        `select id from public.labels where board_id = $1 and name = 'Work'`,
        [boardId],
      )
      const task = await pg.query<{ id: string }>(
        `insert into public.tasks
           (user_id, board_id, title, label_id, label_assignment_explicit)
         values ($1, $2, 'survives label deletion', $3, true)
         returning id`,
        [owner.id, boardId, label.rows[0].id],
      )

      await pg.query(`delete from public.labels where id = $1`, [label.rows[0].id])
      const surviving = await pg.query<{ board_id: string; label_id: string | null }>(
        `select board_id, label_id from public.tasks where id = $1`,
        [task.rows[0].id],
      )
      return surviving.rows[0]
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    } finally {
      await pg.query('rollback')
    }
  })

  expect(result).toEqual({ board_id: boardId, label_id: null })
})

test('a Board Owner can create a Label through the Data API', async () => {
  const { data } = await owner.client.auth.getSession()
  const session = data.session
  if (!session) throw new Error('test owner has no session')

  const local = stack()
  const response = await fetch(`${local.apiUrl}/rest/v1/labels?select=name,dot_color,position`, {
    method: 'POST',
    headers: {
      apikey: local.anonKey,
      authorization: `Bearer ${session.access_token}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify({
      board_id: await ownerBoardId(),
      name: 'Focus',
      dot_color: '#123456',
      position: 5,
    }),
  })

  expect(response.status).toBe(201)
  expect(await response.json()).toEqual([{ name: 'Focus', dot_color: '#123456', position: 5 }])
})

test('a Board Owner can rename, recolor, and reorder a Label through the Data API', async () => {
  const boardId = await ownerBoardId()
  const labelId = await withPg(async (pg) => {
    const result = await pg.query<{ id: string }>(
      `insert into public.labels (board_id, name, dot_color, position)
       values ($1, 'Mutable', '#111111', 20)
       returning id`,
      [boardId],
    )
    return result.rows[0].id
  })
  const { data } = await owner.client.auth.getSession()
  const session = data.session
  if (!session) throw new Error('test owner has no session')

  const local = stack()
  const response = await fetch(
    `${local.apiUrl}/rest/v1/labels?id=eq.${labelId}&select=name,dot_color,position`,
    {
      method: 'PATCH',
      headers: {
        apikey: local.anonKey,
        authorization: `Bearer ${session.access_token}`,
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({ name: 'Changed', dot_color: '#654321', position: 6 }),
    },
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual([{ name: 'Changed', dot_color: '#654321', position: 6 }])
})

test('a Board Owner can delete a Label through the Data API', async () => {
  const boardId = await ownerBoardId()
  const labelId = await withPg(async (pg) => {
    const result = await pg.query<{ id: string }>(
      `insert into public.labels (board_id, name, dot_color, position)
       values ($1, 'Temporary', '#222222', 21)
       returning id`,
      [boardId],
    )
    return result.rows[0].id
  })
  const { data } = await owner.client.auth.getSession()
  const session = data.session
  if (!session) throw new Error('test owner has no session')

  const local = stack()
  const response = await fetch(`${local.apiUrl}/rest/v1/labels?id=eq.${labelId}&select=id`, {
    method: 'DELETE',
    headers: {
      apikey: local.anonKey,
      authorization: `Bearer ${session.access_token}`,
      prefer: 'return=representation',
    },
  })

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual([{ id: labelId }])
})

test('an Editor may read Labels but cannot create Label definitions', async () => {
  const editor = await createTestUser()
  const boardId = await ownerBoardId()
  try {
    await withPg((pg) =>
      pg.query(
        `insert into public.board_memberships (board_id, account_id, role)
         values ($1, $2, 'editor')`,
        [boardId, editor.id],
      ),
    )
    const { data } = await editor.client.auth.getSession()
    const session = data.session
    if (!session) throw new Error('test editor has no session')

    const local = stack()
    const read = await fetch(`${local.apiUrl}/rest/v1/labels?board_id=eq.${boardId}&select=id`, {
      headers: {
        apikey: local.anonKey,
        authorization: `Bearer ${session.access_token}`,
      },
    })
    expect(read.status).toBe(200)
    expect((await read.json()) as unknown[]).not.toHaveLength(0)

    const create = await fetch(`${local.apiUrl}/rest/v1/labels`, {
      method: 'POST',
      headers: {
        apikey: local.anonKey,
        authorization: `Bearer ${session.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        board_id: boardId,
        name: 'Editor smuggled',
        dot_color: '#333333',
        position: 30,
      }),
    })
    expect(create.status).toBe(403)
  } finally {
    await withPg((pg) =>
      pg.query(`delete from public.board_memberships where board_id = $1 and account_id = $2`, [
        boardId,
        editor.id,
      ]),
    )
    await deleteTestUser(editor)
  }
})

test('renaming a seeded Label does not break stale Category mapping', async () => {
  const boardId = await ownerBoardId()
  const workLabel = await withPg(async (pg) => {
    const result = await pg.query<{ id: string }>(
      `select id from public.labels where board_id = $1 and name = 'Work'`,
      [boardId],
    )
    return result.rows[0].id
  })
  const { data } = await owner.client.auth.getSession()
  const session = data.session
  if (!session) throw new Error('test owner has no session')

  const local = stack()
  const rename = await fetch(`${local.apiUrl}/rest/v1/labels?id=eq.${workLabel}`, {
    method: 'PATCH',
    headers: {
      apikey: local.anonKey,
      authorization: `Bearer ${session.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name: 'Professional' }),
  })
  expect(rename.status).toBe(204)

  const { data: task, error } = await owner.client
    .from('tasks')
    .insert(legacyTaskInsert({ user_id: owner.id, title: 'stale after rename', category: 'work' }))
    .select('id')
    .single()
  expect(error).toBeNull()

  const assigned = await withPg(async (pg) => {
    const result = await pg.query<{ name: string }>(
      `select l.name
         from public.tasks t
         join public.labels l on l.id = t.label_id
        where t.id = $1`,
      [task!.id],
    )
    return result.rows[0]?.name
  })
  expect(assigned).toBe('Professional')
})
