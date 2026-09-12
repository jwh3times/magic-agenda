import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, expect, test } from 'vitest'
import type { Database } from '../../src/types/database.types'
import { createTestUser, currentBoardId, deleteTestUser, type TestUser } from './helpers'

/**
 * The two Recurrence Rule columns added ahead of the client that reads them.
 *
 * The defaults test is the load-bearing one here, and it is the reason this file exists a release
 * early: the currently-deployed client names neither column, so every write it makes must keep
 * landing valid rows across the merge that adds them. If the defaults did not satisfy the new
 * constraints, the first task anyone saved after `Deploy Migrations` ran would be refused — and
 * production would be broken for the whole window before the next deploy, with nothing in this
 * repository having changed in between.
 */
let user: TestUser
let boardId: string
beforeAll(async () => {
  user = await createTestUser()
  boardId = await currentBoardId(user.id)
})
afterAll(async () => {
  if (user) await deleteTestUser(user)
})

type Insert = Database['public']['Tables']['tasks']['Insert']

/** A weekly Series definition, the only shape a weekday set is legal on. */
const weekly = { recur_freq: 'weekly', day: '2026-09-16' } as const

const invalid: [string, Partial<Insert>][] = [
  ['weekday below the domain', { ...weekly, recur_weekdays: [-1] }],
  ['weekday above the domain', { ...weekly, recur_weekdays: [7] }],
  // Covered by the domain check rather than a clause of its own: array containment answers false,
  // not NULL, for an array holding a NULL element. Pinned here because the opposite is the natural
  // guess, and guessing it would invite a redundant clause back into the constraint.
  ['a null weekday', { ...weekly, recur_weekdays: [1, null as unknown as number] }],
  // Duplicates are legal -- the walker reads the array as a set -- so the size cap is the only
  // thing bounding the payload, and it is not implied by the domain check.
  ['more weekdays than there are days', { ...weekly, recur_weekdays: [1, 1, 1, 1, 1, 1, 1, 1] }],
  ['a nested weekday array', { ...weekly, recur_weekdays: [[1, 2]] as unknown as number[] }],
  ['weekdays on a daily Rule', { recur_freq: 'daily', recur_weekdays: [1] }],
  ['weekdays on a monthly Rule', { recur_freq: 'monthly', recur_weekdays: [1] }],
  // The shape `resolveSave` produces if it forgets to reset the Rule parameters it spreads off the
  // editor draft: an Occurrence carrying its Series' weekdays.
  ['weekdays on a row with no Rule', { recur_weekdays: [1] }],
  ['a zero count', { ...weekly, recur_count: 0 }],
  ['a negative count', { ...weekly, recur_count: -1 }],
  ['a count past MAX_OCCURRENCES', { ...weekly, recur_count: 1001 }],
  ['a count on a row with no Rule', { recur_count: 5 }],
]

test.each(invalid)(
  'database rejects %s on INSERT and UPDATE, and writes nothing',
  async (_, values) => {
    const id = randomUUID()
    const denied = await user.client
      .from('tasks')
      .insert({ id, board_id: boardId, title: 'valid', ...values })
    expect(denied.error?.code).toBe('23514')
    const missing = await user.client.from('tasks').select('id').eq('id', id)
    expect(missing.error).toBeNull()
    expect(missing.data).toEqual([])

    // The positive control: without it a policy or grant that refused everything would pass every
    // case above for the wrong reason.
    const inserted = await user.client
      .from('tasks')
      .insert({ id, board_id: boardId, title: 'valid' })
      .select('*')
      .single()
    expect(inserted.error).toBeNull()
    const update = await user.client.from('tasks').update(values).eq('id', id)
    expect(update.error?.code).toBe('23514')
    const after = await user.client.from('tasks').select('*').eq('id', id).single()
    expect(after.error).toBeNull()
    expect(after.data).toEqual(inserted.data)
  },
)

test('a client naming neither column writes a row the new constraints accept', async () => {
  const inserted = await user.client
    .from('tasks')
    .insert({ board_id: boardId, title: 'pre-cutover client' })
    .select('recur_weekdays, recur_count')
    .single()
  expect(inserted.error).toBeNull()
  expect(inserted.data).toEqual({ recur_weekdays: [], recur_count: null })
})

// One insert per case rather than one batch of four, and not only for isolation: PostgREST unions
// the keys across a multi-row insert and sends an explicit NULL for every row that omits one, so a
// batch where some rows name `recur_weekdays` refuses the rest on its NOT NULL rather than taking
// the default. The app never meets that -- `taskToRow` names every column on every row -- but a
// batch here would be testing the vendor's key-union rule instead of these constraints.
const valid: [string, Partial<Insert>][] = [
  ['every weekday', { ...weekly, recur_weekdays: [0, 1, 2, 3, 4, 5, 6] }],
  ['a single weekday', { ...weekly, recur_weekdays: [3] }],
  ['the first count', { ...weekly, recur_count: 1 }],
  ['the last count', { ...weekly, recur_count: 1000 }],
  // Not mutually exclusive in the data: the editor offers one or the other, but a file or an API
  // write may carry both and the earlier end wins.
  [
    'both ends at once',
    { ...weekly, recur_until: '2026-12-31', recur_count: 10, recur_weekdays: [1, 3, 5] },
  ],
]

test.each(valid)('a weekly Series accepts %s', async (_, values) => {
  const inserted = await user.client
    .from('tasks')
    .insert({ board_id: boardId, title: 'valid', ...values })
    .select('recur_weekdays, recur_count')
    .single()
  expect(inserted.error).toBeNull()
  expect(inserted.data).toEqual({
    recur_weekdays: values.recur_weekdays ?? [],
    recur_count: values.recur_count ?? null,
  })
})

test('clearing the Rule and its parameters together is accepted', async () => {
  const created = await user.client
    .from('tasks')
    .insert({ ...weekly, board_id: boardId, title: 'ends as a plain task', recur_weekdays: [1, 3] })
    .select('id')
    .single()
  expect(created.error).toBeNull()

  // The order matters to the constraints, not just to the client: dropping to `none` while the
  // weekday set is still set is the refusal above, so `planEndSeriesAt`'s detached row has to
  // clear both in one write. This is that write.
  const detached = await user.client
    .from('tasks')
    .update({ recur_freq: 'none', recur_weekdays: [], recur_count: null })
    .eq('id', created.data!.id)
    .select('recur_weekdays, recur_count')
    .single()
  expect(detached.error).toBeNull()
  expect(detached.data).toEqual({ recur_weekdays: [], recur_count: null })
})
