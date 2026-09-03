import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { taskToRow } from '../../src/data/mappers'
import { makeMockTasks } from '../../src/data/mockTasks'
import { createTestUser, currentBoardId, deleteTestUser, withPg } from './helpers'

test('tasks exposes nullable Completion and Archive persistence columns', async () => {
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

  expect(columns).toEqual([
    { column_name: 'archived_at', data_type: 'timestamp with time zone', is_nullable: 'YES' },
    { column_name: 'completed_at', data_type: 'timestamp with time zone', is_nullable: 'YES' },
    { column_name: 'reopen_status', data_type: 'text', is_nullable: 'YES' },
  ])
})

test('reopen_status accepts only active Workflow Status tokens when present', async () => {
  const invalidCode = await withPg(async (pg) => {
    await pg.query('begin')
    try {
      const board = await pg.query<{ id: string }>(
        `insert into public.boards (name) values ('completion constraint fixture') returning id`,
      )
      for (const status of [null, 'todo', 'doing']) {
        await pg.query(
          `insert into public.tasks (board_id, title, reopen_status) values ($1, $2, $3)`,
          [board.rows[0].id, `accepted ${status ?? 'null'}`, status],
        )
      }

      await pg.query('savepoint invalid_reopen_status')
      try {
        await pg.query(
          `insert into public.tasks (board_id, title, reopen_status) values ($1, 'invalid', 'done')`,
          [board.rows[0].id],
        )
        return ''
      } catch (error) {
        await pg.query('rollback to savepoint invalid_reopen_status')
        return error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      }
    } finally {
      await pg.query('rollback')
    }
  })

  expect(invalidCode).toBe('23514')
})

test('the canonical Task payload inserts, updates, and upserts lifecycle fields together', async () => {
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
    const insertPayload = taskToRow(task, boardId)
    expect(insertPayload).toMatchObject({
      status: 'done',
      completed_at: completedAt,
      reopen_status: 'doing',
      archived_at: null,
    })

    const { error: insertError } = await user.client.from('tasks').insert(insertPayload)
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
    expect(stored.rows).toEqual([
      {
        title: 'canonical payload upsert',
        completed_at: new Date(completedAt),
        reopen_status: 'doing',
        archived_at: new Date(archivedAt),
      },
    ])
  } finally {
    await deleteTestUser(user)
  }
})
