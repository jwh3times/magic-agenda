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
      attachments: string
    }>(
      `select
         (select count(*) from public.boards where id = $1) as boards,
         (select count(*) from public.board_memberships where board_id = $1) as memberships,
         (select count(*) from public.labels where board_id = $1) as labels,
         (select count(*) from public.tasks where board_id = $1) as tasks,
         (select count(*) from public.task_attachments where board_id = $1) as attachments`,
      [boardId],
    )
    const r = result.rows[0]
    return {
      boards: Number(r.boards),
      memberships: Number(r.memberships),
      labels: Number(r.labels),
      tasks: Number(r.tasks),
      attachments: Number(r.attachments),
    }
  })
}

/**
 * Delete a Board the way `delete-board` does: past RLS, as the table owner.
 *
 * Since #399 no API role holds `DELETE` on `boards` -- deletion is a command, because the Board's
 * attachment objects must go first and a client-driven sequence cannot guarantee that. So these
 * cascade tests can no longer drive the delete through the Data API, and driving it as `postgres`
 * is the honest stand-in for the endpoint's service-role client. What is being asserted here is the
 * **cascade**, which is a property of the foreign keys and runs as the referencing table's owner
 * regardless of who issued the statement.
 */
async function deleteBoardAsCommand(boardId: string) {
  await withPg((pg) => pg.query(`delete from public.boards where id = $1`, [boardId]))
}

async function seedBoard(user: TestUser, name: string): Promise<string> {
  const { data, error } = await user.client.rpc('create_board', { board_name: name })
  if (error || !data) throw new Error(`create_board failed: ${error?.message}`)
  const { data: task } = await user.client
    .from('tasks')
    .insert(boardTaskInsert(data, { title: `task in ${name}` }))
    .select('id')
    .single()

  // `task_attachments` reaches the Board only through `tasks`, so its cascade is two hops rather
  // than one: deleting the Board cascades to the Task, which cascades to this row. A child table
  // that is merely *transitively* reachable is the kind that gets forgotten, which is exactly why
  // `contentsOf` counts it and asserts with a strict `toEqual`.
  // This test is about the FK cascade, not the upload command. Seed past the restore-only INSERT
  // policy so no Storage object is needed merely to prove the transitive database relationship.
  await withPg((pg) =>
    pg.query(
      `insert into public.task_attachments
         (board_id, task_id, filename, mime_type, size_bytes, uploaded_by)
       values ($1, $2, $3, 'image/png', 1024, $4)`,
      [data, task!.id, `attached to ${name}.png`, user.id],
    ),
  )
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
  expect(before).toEqual({ boards: 1, memberships: 1, labels: 5, tasks: 1, attachments: 1 })

  await deleteBoardAsCommand(boardId)

  // Referential actions are not subject to RLS — they run as the referencing table's owner — so
  // the caller's policies on `tasks` and `labels` neither permit nor prevent this. Asserted rather
  // than assumed: a cascade that silently failed would leave rows pointing at a Board that is gone.
  expect(await contentsOf(boardId)).toEqual({
    boards: 0,
    memberships: 0,
    labels: 0,
    tasks: 0,
    attachments: 0,
  })
})

test('deletion is confined to the Board deleted', async () => {
  const keep = await seedBoard(owner, 'Kept')
  const drop = await seedBoard(owner, 'Dropped')

  await deleteBoardAsCommand(drop)

  expect(await contentsOf(drop)).toEqual({
    boards: 0,
    memberships: 0,
    labels: 0,
    tasks: 0,
    attachments: 0,
  })
  expect(await contentsOf(keep)).toEqual({
    boards: 1,
    memberships: 1,
    labels: 5,
    tasks: 1,
    attachments: 1,
  })
})

/**
 * Note what these refusal tests assert, and what they deliberately do not.
 *
 * A DELETE that RLS refuses is not an error: it matches zero rows and returns success. Asserting
 * `error` here would pass for the wrong reason on a policy that permitted everything, so every case
 * below asserts the Board is *still there* instead.
 */
/**
 * **What refuses a Data API delete changed with #399, and these tests must say so.**
 *
 * The three tests below assert that an Editor, a Viewer, a stranger, and a former Owner cannot
 * delete a Board through the Data API. They passed before because `boards_delete_owner` filtered
 * the row; they pass now because **no API role holds `DELETE` on `boards` at all**, which refuses
 * the statement before any policy is consulted.
 *
 * That means each of them would stay green with `boards_delete_owner` deleted entirely -- the
 * "passes for the wrong reason" shape. They are kept because the property they name is still the
 * one users care about, and the two tests immediately below pin the mechanisms separately: the
 * grant, which is what actually refuses today, and the policy, which is the defence in depth that
 * would refuse if the grant ever came back.
 */
test('no API role can delete a Board through the Data API (#399)', async () => {
  // The Owner included -- that is the point. Deletion is a command now, so even the person
  // entitled to delete cannot do it by this route, and the attachment sweep cannot be skipped.
  const boardId = await seedBoard(owner, 'Command only')

  const { error } = await owner.client.from('boards').delete().eq('id', boardId)
  expect(error).not.toBeNull()
  expect(error?.code).toBe('42501')
  expect((await contentsOf(boardId)).boards).toBe(1)

  const grants = await withPg(async (pg) => {
    const result = await pg.query<{ role: string; can: boolean }>(
      `select r as role, has_table_privilege(r, 'public.boards', 'DELETE') as can
         from unnest(array['anon', 'authenticated', 'service_role']) r`,
    )
    return result.rows
  })
  expect(grants.every((g) => !g.can)).toBe(true)

  await deleteBoardAsCommand(boardId)
})

test('boards_delete_owner survives as defence in depth', async () => {
  // Unreachable through the Data API now that the grant is gone, and kept deliberately: a boundary
  // should not depend on a grant to hold. Asserted structurally, because no role that could
  // exercise it can still reach the table.
  const policy = await withPg(async (pg) => {
    const result = await pg.query<{ polname: string; cmd: string; qual: string | null }>(
      `select p.polname, p.polcmd::text as cmd, pg_get_expr(p.polqual, p.polrelid) as qual
         from pg_policy p
         join pg_class c on c.oid = p.polrelid
        where c.relname = 'boards' and p.polname = 'boards_delete_owner'`,
    )
    return result.rows
  })

  expect(policy).toHaveLength(1)
  expect(policy[0].cmd).toBe('d')
  expect(policy[0].qual).toContain('board_memberships')
  expect(policy[0].qual).toContain('owner')
})

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
    await deleteBoardAsCommand(only)

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
    const { data: theirTask } = await other.client
      .from('tasks')
      .insert(boardTaskInsert(theirs, { title: 'theirs' }))
      .select('id')
      .single()
    // Seeded here too, so the blast-radius assertion below covers attachments rather than merely
    // counting zero of them on both sides.
    await withPg((pg) =>
      pg.query(
        `insert into public.task_attachments
           (board_id, task_id, filename, mime_type, size_bytes, uploaded_by)
         values ($1, $2, 'theirs.png', 'image/png', 1024, $3)`,
        [theirs, theirTask!.id, other.id],
      ),
    )

    await deleteBoardAsCommand(mine)

    expect(await contentsOf(mine)).toEqual({
      boards: 0,
      memberships: 0,
      labels: 0,
      tasks: 0,
      attachments: 0,
    })
    expect(await contentsOf(theirs)).toEqual({
      boards: 1,
      memberships: 1,
      labels: 5,
      tasks: 1,
      attachments: 1,
    })
  } finally {
    await deleteTestUser(other)
  }
})
