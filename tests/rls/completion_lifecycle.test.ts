import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import {
  boardTaskInsert,
  createTestUser,
  currentBoardId,
  deleteTestUser,
  withPg,
  type TestUser,
} from './helpers'
import { taskToRow } from '../../src/data/mappers'
import { makeMockTasks } from '../../src/data/mockTasks'
import type { Database } from '../../src/types/database.types'

type TaskInsert = Database['public']['Tables']['tasks']['Insert']
type TaskUpdate = Database['public']['Tables']['tasks']['Update']

/**
 * The lifecycle trigger, not the client, owns Completion and Archive values.
 *
 * Every assertion here writes through PostgREST as a real signed-in member, because that is the
 * only path a stale client or a hand-rolled Data API call can take. Each read comes back from the
 * write itself via `select()`: a compatible client renders the row the trigger produced, so
 * checking a value fetched in a second round trip would not be checking what the app receives.
 */

interface Lifecycle {
  status: string
  completed_at: string | null
  reopen_status: string | null
  archived_at: string | null
}

const LIFECYCLE = 'status, completed_at, reopen_status, archived_at'

async function seed(
  user: TestUser,
  boardId: string,
  values: Omit<TaskInsert, 'board_id' | 'label_id'> = {},
): Promise<{ id: string; row: Lifecycle }> {
  const id = randomUUID()
  const { data, error } = await user.client
    .from('tasks')
    .insert(boardTaskInsert(boardId, { id, title: 'lifecycle', ...values }))
    .select(LIFECYCLE)
  expect(error).toBeNull()
  return { id, row: (data as Lifecycle[])[0] }
}

async function write(user: TestUser, id: string, values: TaskUpdate): Promise<Lifecycle> {
  const { data, error } = await user.client
    .from('tasks')
    .update(values)
    .eq('id', id)
    .select(LIFECYCLE)
  expect(error).toBeNull()
  return (data as Lifecycle[])[0]
}

test.each(['todo', 'doing'] as const)(
  'Completing from %s remembers it and stamps an authoritative Completed At',
  async (from) => {
    const user = await createTestUser()
    try {
      const boardId = await currentBoardId(user.id)
      const { id } = await seed(user, boardId, { status: from })

      // A payload that knows only `status` -- every client from before v1.8.58 -- still produces a
      // coherent row, because the remembered status is read from the stored row, never sent.
      const completed = await write(user, id, { status: 'done' })
      expect(completed.status).toBe('done')
      expect(completed.reopen_status).toBe(from)
      expect(completed.completed_at).not.toBeNull()

      // An ordinary edit while Completed leaves the instant alone, even when the payload re-sends
      // `completed_at` -- which the canonical client payload does on every write.
      const edited = await write(user, id, { title: 'renamed', completed_at: null })
      expect(edited.completed_at).toBe(completed.completed_at)
      expect(edited.reopen_status).toBe(from)

      // Quick Reopen returns to the remembered status and clears Completion.
      const reopened = await write(user, id, { status: from })
      expect(reopened).toEqual({
        status: from,
        completed_at: null,
        reopen_status: from,
        archived_at: null,
      })
    } finally {
      await deleteTestUser(user)
    }
  },
)

test('an explicit move to the other active status becomes the remembered one', async () => {
  const user = await createTestUser()
  try {
    const boardId = await currentBoardId(user.id)
    const { id } = await seed(user, boardId, { status: 'todo' })

    await write(user, id, { status: 'done' })
    expect((await write(user, id, { status: 'doing' })).reopen_status).toBe('doing')
    expect((await write(user, id, { status: 'done' })).reopen_status).toBe('doing')
  } finally {
    await deleteTestUser(user)
  }
})

test('Archive is a transition of its own and never disturbs Completion', async () => {
  const user = await createTestUser()
  try {
    const boardId = await currentBoardId(user.id)
    const { id } = await seed(user, boardId, { status: 'doing' })
    const completedAt = (await write(user, id, { status: 'done' })).completed_at

    // The first Archive is stamped by the server, so a supplied instant cannot backdate it.
    const archived = await write(user, id, { archived_at: '2020-01-01T00:00:00.000Z' })
    expect(archived.archived_at).not.toBeNull()
    expect(archived.archived_at).not.toBe('2020-01-01T00:00:00+00:00')
    expect(archived.completed_at).toBe(completedAt)
    expect(archived.status).toBe('done')

    // Staying Archived preserves that instant through ordinary edits.
    expect((await write(user, id, { title: 'renamed' })).archived_at).toBe(archived.archived_at)

    expect(await write(user, id, { archived_at: null })).toMatchObject({
      status: 'done',
      completed_at: completedAt,
      archived_at: null,
    })

    // Reopening an Archived Task unarchives it as well as clearing Completion.
    await write(user, id, { archived_at: '2020-01-01T00:00:00.000Z' })
    expect(await write(user, id, { status: 'doing' })).toEqual({
      status: 'doing',
      completed_at: null,
      reopen_status: 'doing',
      archived_at: null,
    })
  } finally {
    await deleteTestUser(user)
  }
})

test('a contradictory write is normalized rather than stored', async () => {
  const user = await createTestUser()
  try {
    const boardId = await currentBoardId(user.id)

    // An active row cannot carry Completion or Archive state, on insert or on update.
    const { id, row } = await seed(user, boardId, {
      status: 'todo',
      completed_at: '2026-01-01T00:00:00.000Z',
      reopen_status: 'doing',
      archived_at: '2026-01-02T00:00:00.000Z',
    })
    expect(row).toEqual({
      status: 'todo',
      completed_at: null,
      reopen_status: 'todo',
      archived_at: null,
    })

    expect(
      await write(user, id, {
        status: 'doing',
        completed_at: '2026-01-01T00:00:00.000Z',
        archived_at: '2026-01-02T00:00:00.000Z',
      }),
    ).toEqual({ status: 'doing', completed_at: null, reopen_status: 'doing', archived_at: null })

    // A Task that arrives already Completed keeps the history it carries. This is how a v3 backup
    // restores the instant its file recorded, and the one case where a supplied value survives.
    const imported = await seed(user, boardId, {
      status: 'done',
      completed_at: '2025-05-05T00:00:00.000Z',
      reopen_status: 'doing',
      archived_at: '2025-06-06T00:00:00.000Z',
    })
    expect(imported.row).toEqual({
      status: 'done',
      completed_at: '2025-05-05T00:00:00+00:00',
      reopen_status: 'doing',
      archived_at: '2025-06-06T00:00:00+00:00',
    })

    // A pre-v3 file records no instant, so the write itself becomes the Completion.
    const legacy = await seed(user, boardId, { status: 'done' })
    expect(legacy.row.completed_at).not.toBeNull()
    expect(legacy.row.reopen_status).toBe('todo')
  } finally {
    await deleteTestUser(user)
  }
})

test('Series definitions and Occurrences satisfy the invariants like any other row', async () => {
  const user = await createTestUser()
  try {
    const boardId = await currentBoardId(user.id)
    const definition = await seed(user, boardId, {
      status: 'todo',
      recur_freq: 'weekly',
      recur_interval: 1,
      day: '2026-07-01',
    })
    const occurrence = await seed(user, boardId, {
      status: 'done',
      recur_parent_id: definition.id,
      recur_origin_day: '2026-07-08',
      day: '2026-07-08',
    })

    expect(definition.row).toEqual({
      status: 'todo',
      completed_at: null,
      reopen_status: 'todo',
      archived_at: null,
    })
    expect(occurrence.row.completed_at).not.toBeNull()
    expect(occurrence.row.reopen_status).toBe('todo')
  } finally {
    await deleteTestUser(user)
  }
})

test('the named constraints are the backstop when the trigger is not there to normalize', async () => {
  const failures = await withPg(async (pg) => {
    await pg.query('begin')
    try {
      const board = await pg.query<{ id: string }>(
        `insert into public.boards (name) values ('lifecycle constraint fixture') returning id`,
      )
      const boardId = board.rows[0].id
      // Constraints, not the trigger, are what a restore or a later direct write actually meets --
      // `data.sql` loads under `session_replication_role = replica`, which fires no triggers at all.
      // Disabling it here is the only way to reach them, and reaching them is why they are named.
      await pg.query('alter table public.tasks disable trigger tasks_enforce_completion_lifecycle')

      const attempt = async (columns: string, values: unknown[]) => {
        await pg.query('savepoint attempt')
        try {
          const placeholders = values.map((_, i) => '$' + String(i + 2)).join(', ')
          await pg.query(
            `insert into public.tasks (board_id, title, ${columns})
             values ($1, 'constraint probe', ${placeholders})`,
            [boardId, ...values],
          )
          return ''
        } catch (error) {
          await pg.query('rollback to savepoint attempt')
          const e = error as { code?: string; constraint?: string; column?: string }
          return `${e.code}:${e.constraint ?? e.column}`
        }
      }

      return {
        completedWithoutInstant: await attempt('status', ['done']),
        activeWithInstant: await attempt('status, completed_at', ['todo', '2026-01-01T00:00:00Z']),
        activeArchived: await attempt('status, archived_at', ['todo', '2026-01-01T00:00:00Z']),
        missingMemory: await attempt('reopen_status', [null]),
        invalidMemory: await attempt('reopen_status', ['done']),
      }
    } finally {
      await pg.query('rollback')
    }
  })

  expect(failures).toEqual({
    completedWithoutInstant: '23514:tasks_completed_at_matches_status',
    activeWithInstant: '23514:tasks_completed_at_matches_status',
    activeArchived: '23514:tasks_archived_at_requires_completed',
    missingMemory: '23502:reopen_status',
    invalidMemory: '23514:tasks_reopen_status_active',
  })
})

test('every stored row already satisfies the invariants the backfill established', async () => {
  const offenders = await withPg(async (pg) => {
    const result = await pg.query<{ count: string }>(
      `select count(*)::text as count
         from public.tasks
        where (completed_at is not null) <> (status = 'done')
           or reopen_status is null
           or (archived_at is not null and status <> 'done')`,
    )
    return result.rows[0].count
  })
  expect(offenders).toBe('0')
})

test('a Viewer still cannot complete a Task, and the trigger grants nothing', async () => {
  const owner = await createTestUser()
  const viewer = await createTestUser()
  try {
    const boardId = await currentBoardId(owner.id)
    const { id } = await seed(owner, boardId, { status: 'todo' })
    await withPg((pg) =>
      pg.query(
        `insert into public.board_memberships (board_id, account_id, role)
         values ($1, $2, 'viewer')`,
        [boardId, viewer.id],
      ),
    )

    const { data, error } = await viewer.client
      .from('tasks')
      .update({ status: 'done' })
      .eq('id', id)
      .select(LIFECYCLE)
    expect(error).toBeNull()
    expect(data).toEqual([])

    const stored = await withPg((pg) =>
      pg.query<{ status: string }>(`select status from public.tasks where id = $1`, [id]),
    )
    expect(stored.rows[0].status).toBe('todo')
  } finally {
    // The viewer goes first: `handle_account_deletion` refuses to delete the sole Owner of a Board
    // somebody else is still a current member of.
    await deleteTestUser(viewer)
    await deleteTestUser(owner)
  }
})

test('the lifecycle columns carry the shape the enforced model requires', async () => {
  const columns = await withPg(async (pg) => {
    const result = await pg.query<{
      column_name: string
      data_type: string
      is_nullable: 'YES' | 'NO'
    }>(
      `select column_name, data_type, is_nullable
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'tasks'
          and column_name in ('completed_at', 'reopen_status', 'archived_at')
        order by column_name`,
    )
    return result.rows
  })

  // Completed At and Archive are nullable because their absence is the meaning: not Completed, not
  // Archived. The remembered active status has no such reading -- every Task has one -- which is
  // why it is the only one of the three that is NOT NULL.
  expect(columns).toEqual([
    { column_name: 'archived_at', data_type: 'timestamp with time zone', is_nullable: 'YES' },
    { column_name: 'completed_at', data_type: 'timestamp with time zone', is_nullable: 'YES' },
    { column_name: 'reopen_status', data_type: 'text', is_nullable: 'NO' },
  ])
})

test('the canonical Task payload inserts, updates, and upserts under the trigger', async () => {
  // `taskToRow` sends every lifecycle column on every write, so the column grants and the trigger
  // have to agree with the payload the app actually builds -- not with a hand-picked subset.
  const user = await createTestUser()
  try {
    const boardId = await currentBoardId(user.id)
    const completedAt = '2026-09-03T12:00:00.000Z'
    const archivedAt = '2026-09-03T13:00:00.000Z'
    const task = {
      ...makeMockTasks()[0],
      id: randomUUID(),
      labelId: null,
      title: 'canonical payload insert',
      status: 'completed' as const,
      completedAt,
      reopenStatus: 'doing' as const,
    }

    const { error: insertError } = await user.client.from('tasks').insert(taskToRow(task, boardId))
    expect(insertError).toBeNull()

    const { error: updateError } = await user.client
      .from('tasks')
      .update(taskToRow({ ...task, title: 'canonical payload update', archivedAt }, boardId))
      .eq('id', task.id)
    expect(updateError).toBeNull()

    const { error: upsertError } = await user.client
      .from('tasks')
      .upsert(taskToRow({ ...task, title: 'canonical payload upsert', archivedAt }, boardId), {
        onConflict: 'id',
      })
    expect(upsertError).toBeNull()

    const stored = await withPg((pg) =>
      pg.query<{
        title: string
        completed_at: Date | null
        reopen_status: string | null
        archived_at: Date | null
      }>(
        `select title, completed_at, reopen_status, archived_at
           from public.tasks where id = $1`,
        [task.id],
      ),
    )
    const row = stored.rows[0]
    expect(row.title).toBe('canonical payload upsert')
    // Completion arrived with the row, so it survives; Archive was a transition, so the server
    // owns the instant and the client's `archivedAt` never reaches storage.
    expect(row.completed_at).toEqual(new Date(completedAt))
    expect(row.reopen_status).toBe('doing')
    expect(row.archived_at).not.toBeNull()
    expect(row.archived_at).not.toEqual(new Date(archivedAt))
  } finally {
    await deleteTestUser(user)
  }
})
