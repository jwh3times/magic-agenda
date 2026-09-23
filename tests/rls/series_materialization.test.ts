import { afterAll, beforeAll, expect, test } from 'vitest'
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
import { rowToTask, taskToRow } from '../../src/data/mappers'
import { makeInstance } from '../../src/data/series'
import type { Database, Json } from '../../src/types/database.types'

/**
 * The two commands behind server-side Series materialization (#424).
 *
 * The planning is the client's own pure planner, tested under Deno; what is tested here is the
 * database half: what the job may read, and that its insert can race the client without failing
 * and cannot write anything but a real Occurrence of a real definition on the same Board.
 */

interface MaterializationState {
  definitions: { id: string; board_id: string; recur_freq: string; day: string }[]
  occurrences: { recur_parent_id: string; recur_origin_day: string; day: string | null }[]
}

let alice: TestUser
let bob: TestUser
let aliceBoard: string
let bobBoard: string

async function state(from: string): Promise<MaterializationState> {
  const { data, error } = await serviceClient().rpc('series_materialization_state', {
    p_from: from,
  })
  if (error) throw new Error(`state failed: ${error.message}`)
  return data as unknown as MaterializationState
}

async function insertRows(rows: object[]): Promise<number> {
  const { data, error } = await serviceClient().rpc('insert_materialized_occurrences', {
    p_rows: rows as unknown as Json,
  })
  if (error) throw new Error(`insert failed: ${error.message}`)
  return data
}

type TaskRow = Database['public']['Tables']['tasks']['Row']

/** Every definition this file created, as stored, so fixtures can be built from the real row. */
const definitionRows = new Map<string, TaskRow>()

/**
 * One Occurrence of `parent` on `day`, built by the app's own `rowToTask` → `makeInstance` →
 * `taskToRow` — exactly the payload the Edge Function sends. A hand-written row drifts from the
 * real shape one NOT NULL column at a time; this cannot.
 */
function occurrenceRow(parent: string, board: string, day: string) {
  const row = definitionRows.get(parent)
  if (!row) throw new Error(`unknown definition ${parent}`)
  return taskToRow(
    makeInstance(rowToTask(row), day, () => crypto.randomUUID()),
    board,
  )
}

async function definition(user: TestUser, board: string, day = '2026-10-01'): Promise<string> {
  const { data, error } = await user.client
    .from('tasks')
    .insert(boardTaskInsert(board, { title: 'series', day, recur_freq: 'daily' }))
    .select('*')
    .single()
  if (error) throw new Error(`fixture failed: ${error.message}`)
  definitionRows.set(data.id, data)
  return data.id
}

async function occurrencesOf(parent: string): Promise<{ id: string; author_id: string | null }[]> {
  return withPg(async (pg) => {
    const result = await pg.query<{ id: string; author_id: string | null }>(
      `select id, author_id from public.tasks where recur_parent_id = $1 order by recur_origin_day`,
      [parent],
    )
    return result.rows
  })
}

/** Tasks on the two test Boards: scoped, so parallel test files cannot move the count. */
async function boardTaskCount(): Promise<number> {
  return withPg(async (pg) => {
    const result = await pg.query<{ count: string }>(
      'select count(*) from public.tasks where board_id in ($1, $2)',
      [aliceBoard, bobBoard],
    )
    return Number(result.rows[0].count)
  })
}

beforeAll(async () => {
  alice = await createTestUser()
  bob = await createTestUser()
  aliceBoard = await currentBoardId(alice.id)
  bobBoard = await currentBoardId(bob.id)
})

afterAll(async () => {
  for (const user of [alice, bob]) {
    if (user) await deleteTestUser(user)
  }
})

test('the state carries every Series definition and only in-window Occurrence identities', async () => {
  const def = await definition(alice, aliceBoard)
  const { data: plain } = await alice.client
    .from('tasks')
    .insert(boardTaskInsert(aliceBoard, { title: 'plain', day: '2026-10-01' }))
    .select('id')
    .single()
  expect(await insertRows([occurrenceRow(def, aliceBoard, '2026-09-01')])).toBe(1)
  expect(await insertRows([occurrenceRow(def, aliceBoard, '2026-10-05')])).toBe(1)

  const result = await state('2026-10-01')
  const ours = result.definitions.find((d) => d.id === def)
  // The full row, so the Edge Function maps it with the client's own `rowToTask`.
  expect(ours).toMatchObject({
    id: def,
    board_id: aliceBoard,
    recur_freq: 'daily',
    day: '2026-10-01',
  })
  expect(result.definitions.map((d) => d.id)).not.toContain(plain!.id)

  const covered = result.occurrences.filter((o) => o.recur_parent_id === def)
  // The September Occurrence is below the window and is left out; that bound is what keeps the
  // state proportional to the window rather than to all history.
  expect(covered).toEqual([
    { recur_parent_id: def, recur_origin_day: '2026-10-05', day: '2026-10-05' },
  ])
  // An Occurrence is never itself reported as a definition.
  expect(result.definitions.every((d) => d.recur_freq !== 'none')).toBe(true)

  await alice.client.from('tasks').delete().eq('board_id', aliceBoard)
})

test('inserted Occurrences are real rows, attributed to nobody', async () => {
  const def = await definition(alice, aliceBoard)
  expect(await insertRows([occurrenceRow(def, aliceBoard, '2026-10-02')])).toBe(1)

  // `stamp_task_attribution` sets author_id = auth.uid(), which is NULL for the job: the documented
  // behaviour for administrative writes.
  const rows = await occurrencesOf(def)
  expect(rows).toHaveLength(1)
  expect(rows[0].author_id).toBeNull()
  // And the Board's own member sees it, through RLS, like any Occurrence.
  const { data } = await alice.client.from('tasks').select('id').eq('recur_parent_id', def)
  expect(data).toHaveLength(1)

  await alice.client.from('tasks').delete().eq('id', def)
})

test('an Occurrence the client already made is skipped, and the rest of the batch still lands', async () => {
  // The race this exists for: the client materializes on load with a plain insert, and the job may
  // run at the same moment. The unique index must be a no-op for the job, never a batch failure.
  const def = await definition(alice, aliceBoard)
  // Without the two newest Rule columns, which the fixture does not need and whose client grant
  // postdates the attribution migration.
  const {
    recur_weekdays: _w,
    recur_count: _c,
    ...clientRow
  } = occurrenceRow(def, aliceBoard, '2026-10-03')
  const { error } = await alice.client.from('tasks').insert(clientRow)
  expect(error).toBeNull()

  const inserted = await insertRows([
    occurrenceRow(def, aliceBoard, '2026-10-03'),
    occurrenceRow(def, aliceBoard, '2026-10-04'),
  ])
  expect(inserted).toBe(1)
  expect(await occurrencesOf(def)).toHaveLength(2)

  await alice.client.from('tasks').delete().eq('id', def)
})

test('only Occurrences of an existing definition on the same Board are written', async () => {
  const def = await definition(alice, aliceBoard)
  const before = await boardTaskCount()

  const inserted = await insertRows([
    // No parent: a standalone Task is not an Occurrence, whatever the payload claims.
    { ...occurrenceRow(def, aliceBoard, '2026-10-06'), recur_parent_id: null },
    // A parent on another Board: containment, not just the composite FK, refuses it quietly.
    occurrenceRow(def, bobBoard, '2026-10-07'),
    // A parent that does not exist, as after a definition deleted mid-run.
    { ...occurrenceRow(def, aliceBoard, '2026-10-08'), recur_parent_id: crypto.randomUUID() },
  ])
  expect(inserted).toBe(0)
  const after = await boardTaskCount()
  expect(after).toBe(before)

  // The success half: the same call with a valid row does write, so the zero above is a refusal.
  expect(await insertRows([occurrenceRow(def, aliceBoard, '2026-10-06')])).toBe(1)

  await alice.client.from('tasks').delete().eq('id', def)
})

test('a standalone Task cannot be passed off as a definition', async () => {
  const { data: plain } = await alice.client
    .from('tasks')
    .insert(boardTaskInsert(aliceBoard, { title: 'plain', day: '2026-10-01' }))
    .select('id')
    .single()
  const def = await definition(alice, aliceBoard)
  expect(
    await insertRows([
      { ...occurrenceRow(def, aliceBoard, '2026-10-09'), recur_parent_id: plain!.id },
    ]),
  ).toBe(0)
  await alice.client.from('tasks').delete().eq('id', def)
  await alice.client.from('tasks').delete().eq('id', plain!.id)
})

test('only service_role may read the state or insert', async () => {
  for (const client of [anonClient(), alice.client]) {
    const read = await client.rpc('series_materialization_state', { p_from: '2026-10-01' })
    expect(read.error?.code).toBe('42501')
    const write = await client.rpc('insert_materialized_occurrences', { p_rows: [] })
    expect(write.error?.code).toBe('42501')
  }
  // Success half: the service role reaches both.
  expect(await state('2026-10-01')).toHaveProperty('definitions')
  expect(await insertRows([])).toBe(0)
})
