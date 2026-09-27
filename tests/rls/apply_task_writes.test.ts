import { afterAll, beforeAll, expect, test } from 'vitest'
import type { Json } from '../../src/types/database.types'
import {
  anonClient,
  boardTaskInsert,
  createTestUser,
  currentBoardId,
  deleteTestUser,
  serviceClient,
  withPg,
  type TestUser,
} from './helpers'

/**
 * `apply_task_writes` — a whole plan in one transaction, and no upsert (#434).
 *
 * Every property here is one the old client-side sequence of upserts and deletes could break with
 * two writers: a deleted Task coming back, an existing row overwritten by an "insert", a plan half
 * applied, two Series edits interleaving, and a Series split across Boards.
 */

let owner: TestUser
let editor: TestUser
let viewer: TestUser
let boardId: string
let otherBoardId: string

type Row = { [key: string]: Json } & { id: string; revision: number }

beforeAll(async () => {
  owner = await createTestUser()
  editor = await createTestUser()
  viewer = await createTestUser()
  boardId = await currentBoardId(owner.id)
  otherBoardId = await currentBoardId(editor.id)
  await withPg(async (pg) => {
    await pg.query(
      `insert into public.board_memberships (board_id, account_id, role) values ($1, $2, 'editor')`,
      [boardId, editor.id],
    )
    await pg.query(
      `insert into public.board_memberships (board_id, account_id, role) values ($1, $2, 'viewer')`,
      [boardId, viewer.id],
    )
  })
})

afterAll(async () => {
  await withPg((pg) =>
    pg.query(
      `update public.board_memberships set ended_at = now(), end_reason = 'removed'
        where board_id = $1 and account_id = any($2) and ended_at is null`,
      [boardId, [editor.id, viewer.id]],
    ),
  )
  for (const u of [viewer, editor, owner]) if (u) await deleteTestUser(u)
})

/** A full row in `taskToRow`'s shape, read back from the database. */
async function newTask(values: Record<string, unknown> = {}, board = boardId, as = owner) {
  const { data, error } = await as.client
    .from('tasks')
    .insert(boardTaskInsert(board, { title: 'task', ...values }))
    .select()
    .single()
  if (error) throw new Error(error.message)
  const { author_id, last_editor_id, author_kind, created_at, updated_at, ...row } = data as Row
  void [author_id, last_editor_id, author_kind, created_at, updated_at]
  return row as Row
}

const apply = (
  as: TestUser,
  args: { expected?: Json[]; inserts?: Json[]; updates?: Json[]; deletions?: Json[] },
  board = boardId,
) =>
  as.client.rpc('apply_task_writes', {
    p_board_id: board,
    p_expected: args.expected ?? [],
    p_inserts: args.inserts ?? [],
    p_updates: args.updates ?? [],
    p_deletions: args.deletions ?? [],
  })

const exists = (id: string) =>
  withPg(async (pg) => (await pg.query('select 1 from public.tasks where id = $1', [id])).rowCount)

test('updates land and come back post-trigger, with the revision advanced', async () => {
  const task = await newTask()
  const { data, error } = await apply(editor, { updates: [{ ...task, title: 'moved', korder: 3 }] })
  expect(error).toBeNull()
  expect(data).toEqual([expect.objectContaining({ id: task.id, title: 'moved', korder: 3 })])
  expect((data as Row[])[0].revision).toBe(task.revision + 1)
})

test('an update cannot resurrect a Task deleted meanwhile — the reorder case', async () => {
  const task = await newTask()
  await editor.client.from('tasks').delete().eq('id', task.id)
  const { data, error } = await apply(owner, { updates: [{ ...task, order_index: 7 }] })
  expect(error).toBeNull()
  expect(data).toEqual([])
  expect(await exists(task.id)).toBe(0)
})

test('an insert never overwrites a row that already exists', async () => {
  const task = await newTask({ title: 'original' })
  const { data } = await apply(owner, { inserts: [{ ...task, title: 'overwritten?' }] })
  expect(data).toEqual([])
  const { data: row } = await owner.client.from('tasks').select('title').eq('id', task.id)
  expect(row).toEqual([{ title: 'original' }])
})

test('a plan is all or nothing: a failing step writes none of the others', async () => {
  const task = await newTask({ title: 'before' })
  const { error } = await apply(owner, {
    updates: [{ ...task, title: 'after' }],
    deletions: [{ by: 'nonsense' }],
  })
  expect(error?.message).toBe('invalid-deletion')
  const { data } = await owner.client.from('tasks').select('title').eq('id', task.id)
  expect(data).toEqual([{ title: 'before' }])
})

test('a stale expected revision refuses the whole plan', async () => {
  const definition = await newTask({ title: 'series', recur_freq: 'daily', day: '2026-10-01' })
  await owner.client.from('tasks').update({ title: 'renamed' }).eq('id', definition.id)
  const { error } = await apply(editor, {
    expected: [{ id: definition.id, revision: definition.revision }],
    updates: [{ ...definition, title: 'mine' }],
  })
  expect(error?.message).toBe('stale-revision')
  const { data } = await owner.client.from('tasks').select('title').eq('id', definition.id)
  expect(data).toEqual([{ title: 'renamed' }])
})

test('two concurrent Series edits against one revision: exactly one lands', async () => {
  const definition = await newTask({ title: 'series', recur_freq: 'weekly', day: '2026-10-01' })
  const expected = [{ id: definition.id, revision: definition.revision }]
  const results = await Promise.all([
    apply(owner, { expected, updates: [{ ...definition, title: 'owner' }] }),
    apply(editor, { expected, updates: [{ ...definition, title: 'editor' }] }),
  ])
  expect(results.filter((r) => r.error).map((r) => r.error?.message)).toEqual(['stale-revision'])
})

test('the same Occurrence inserted by two concurrent plans exists once', async () => {
  const definition = await newTask({ title: 'daily', recur_freq: 'daily', day: '2026-10-01' })
  const occurrence = {
    ...definition,
    id: crypto.randomUUID(),
    recur_freq: 'none',
    recur_parent_id: definition.id,
    recur_origin_day: '2026-10-02',
    day: '2026-10-02',
  }
  const second = { ...occurrence, id: crypto.randomUUID() }
  const results = await Promise.all([
    apply(owner, { inserts: [occurrence] }),
    apply(editor, { inserts: [second] }),
  ])
  expect(results.every((r) => r.error === null)).toBe(true)
  const count = await withPg(async (pg) => {
    const { rows } = await pg.query<{ n: string }>(
      `select count(*) as n from public.tasks
        where recur_parent_id = $1 and recur_origin_day = '2026-10-02'`,
      [definition.id],
    )
    return Number(rows[0].n)
  })
  expect(count).toBe(1)
})

test('a Series cannot be split across Boards, even by someone who can edit both', async () => {
  const definition = await newTask({ title: 'here', recur_freq: 'daily', day: '2026-10-01' })
  // The editor also owns their own Board; move an Occurrence's parent link across Boards.
  const elsewhere = await newTask({ title: 'there' }, otherBoardId, editor)
  const { error } = await apply(
    editor,
    {
      updates: [
        {
          ...elsewhere,
          recur_parent_id: definition.id,
          recur_origin_day: '2026-10-03',
          day: '2026-10-03',
        },
      ],
    },
    otherBoardId,
  )
  expect(error).not.toBeNull()
  const { data } = await editor.client
    .from('tasks')
    .select('recur_parent_id')
    .eq('id', elsewhere.id)
  expect(data).toEqual([{ recur_parent_id: null }])
})

test('deletions remove only what the target names, on this Board', async () => {
  const definition = await newTask({ title: 'daily', recur_freq: 'daily', day: '2026-10-01' })
  const occ = async (day: string) =>
    newTask({ recur_parent_id: definition.id, recur_origin_day: day, day, recur_freq: 'none' })
  const [a, b, c] = [await occ('2026-10-02'), await occ('2026-10-03'), await occ('2026-10-04')]
  const { error } = await apply(owner, {
    deletions: [{ by: 'occurrence-after', parentId: definition.id, day: '2026-10-02' }],
  })
  expect(error).toBeNull()
  expect([await exists(a.id), await exists(b.id), await exists(c.id)]).toEqual([1, 0, 0])
})

test('a Viewer writes nothing through it: RLS still decides', async () => {
  const task = await newTask({ title: 'untouched' })
  const { data } = await apply(viewer, { updates: [{ ...task, title: 'viewer' }] })
  expect(data ?? []).toEqual([])
  const insert = await apply(viewer, { inserts: [{ ...task, id: crypto.randomUUID() }] })
  expect(insert.error).not.toBeNull()
  const { data: row } = await owner.client.from('tasks').select('title').eq('id', task.id)
  expect(row).toEqual([{ title: 'untouched' }])
})

test('anon and service_role cannot call it', async () => {
  for (const client of [anonClient(), serviceClient()]) {
    const { error } = await client.rpc('apply_task_writes', {
      p_board_id: boardId,
      p_expected: [],
      p_inserts: [],
      p_updates: [],
      p_deletions: [],
    })
    expect(error?.code).toBe('42501')
  }
})
