import { renderHook, act, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { asTask, NO_RECUR, type Task } from '../types/task'
import { addDays, parseDay, ymd } from '../lib/dates'

const h = vi.hoisted(() => {
  const capture: {
    handler: ((p: unknown) => void) | null
    rows: unknown[]
    selectError: { message: string } | null
    selectStatus: number
    failLaterPage: boolean
    writeRows: unknown[] | null
    insertError: { code?: string; message: string } | null
    /** What `captureTaskAttachments` resolves with (#404). */
    attachments: { id: string; taskId: string }[]
    /**
     * Ordered log of the writes that have a *sequence* contract: an attachment capture has to
     * happen before the DELETE that cascades it away, and a restore after the Task is back.
     */
    trace: string[]
  } = {
    handler: null,
    rows: [],
    selectError: null,
    selectStatus: 200,
    failLaterPage: false,
    writeRows: null,
    insertError: null,
    attachments: [],
    trace: [],
  }
  const ok = () => Promise.resolve({ data: null, error: null })
  const writeSelect = vi.fn(() => Promise.resolve({ data: capture.writeRows, error: null }))
  const selectable = () => {
    const result = Promise.resolve({ data: null, error: capture.insertError })
    return Object.assign(result, { select: writeSelect })
  }
  // Stable spies so tests can assert on the rows reload/materialize/updateSeries write.
  const insert = vi.fn(selectable)
  const upsert = vi.fn(() => {
    capture.trace.push('upsertTasks')
    return selectable()
  })
  // Stable spy behind `.update(...).eq(...)` so a test can force it to reject (throw),
  // proving a throw takes the same rollback + setError path as a resolved `{ error }`.
  const updateEq = vi.fn(selectable)
  // `.delete().eq(...)` is used both as a one-level chain (removeTask, deleteSeriesFuture's
  // whole-series delete) and as a two-level chain (`.eq(...).gt/gte(...)`, updateSeries's
  // truncation-delete / deleteSeriesFuture's instance-delete). Give `.eq(...)`'s return value
  // both a `.then` (so awaiting it directly resolves `{ error }`, for the one-level callers)
  // and spy-able `.gt`/`.gte` legs (so a test can force just that leg to reject).
  const deleteGt = vi.fn(ok)
  const deleteGte = vi.fn(ok)
  const deleteEq = vi.fn(() => {
    capture.trace.push('deleteTask')
    return Object.assign(ok(), { gt: deleteGt, gte: deleteGte })
  })
  // `.delete().in('id', ids)`: bulk delete's one batched request (#270).
  const deleteIn = vi.fn(() => {
    capture.trace.push('deleteTasks')
    return ok()
  })
  const channel: Record<string, unknown> = {}
  channel.on = vi.fn((_e: string, _f: unknown, cb: (p: unknown) => void) => {
    capture.handler = cb
    return channel
  })
  channel.subscribe = vi.fn((cb?: (s: string) => void) => {
    cb?.('SUBSCRIBED')
    return channel
  })
  // The attachment data layer is mocked as a module rather than through the Supabase stub above:
  // `supabase.from` here ignores the table name, so a real `captureTaskAttachments` would read the
  // `tasks` fixtures. What these tests are about is *when* it is called, not how it queries.
  const captureTaskAttachments = vi.fn((ids: readonly string[]) => {
    capture.trace.push(`captureAttachments:${[...ids].join(',')}`)
    return Promise.resolve(capture.attachments)
  })
  const restoreAttachments = vi.fn((rows: readonly { id: string }[]) => {
    capture.trace.push(`restoreAttachments:${rows.map((r) => r.id).join(',')}`)
    return Promise.resolve()
  })

  return {
    capture,
    ok,
    selectable,
    writeSelect,
    insert,
    upsert,
    updateEq,
    deleteEq,
    deleteGt,
    deleteGte,
    deleteIn,
    channel,
    captureTaskAttachments,
    restoreAttachments,
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      // Model the API cap even for an unpaged query, so removing pagination reproduces #287.
      select: vi.fn(() => {
        const result = {
          data: h.capture.rows.slice(0, 1000),
          count: h.capture.rows.length,
          error: h.capture.selectError,
          status: h.capture.selectStatus,
        }
        return {
          eq: vi.fn(() =>
            Object.assign(Promise.resolve(result), {
              order: () => ({
                range: (from: number, to: number) =>
                  Promise.resolve({
                    ...result,
                    data: h.capture.rows.slice(from, Math.min(to + 1, from + 1000)),
                    ...(from > 0 && h.capture.failLaterPage
                      ? { error: { message: 'later page failed' }, status: 500 }
                      : {}),
                  }),
              }),
            }),
          ),
          then: (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve),
        }
      }),
      insert: h.insert,
      upsert: h.upsert,
      update: vi.fn(() => ({ eq: h.updateEq })),
      delete: vi.fn(() => ({ eq: h.deleteEq, in: h.deleteIn })),
    })),
    channel: vi.fn(() => h.channel),
    removeChannel: vi.fn(),
  },
}))

vi.mock('./attachments', () => ({
  captureTaskAttachments: h.captureTaskAttachments,
  restoreAttachments: h.restoreAttachments,
}))

import { useTasks } from './useTasks'
import { readBoardSnapshot } from './snapshot'

const serverRow = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  user_id: 'u1',
  title: 'server',
  description: '',
  category: 'work',
  color: 'yellow',
  checklist: [],
  status: 'todo',
  completed_at: null,
  reopen_status: 'todo',
  archived_at: null,
  day: '2026-07-01',
  at_time: null,
  pinned: false,
  order_index: 0,
  korder: 0,
  recur_freq: 'none',
  recur_interval: 1,
  recur_until: null,
  recur_parent_id: null,
  recur_skip: [],
  recur_origin_day: null,
  recur_weekdays: [],
  recur_count: null,
  // Board containment, attribution, and the compare-and-swap token are present on every row. The
  // app maps Label ownership but intentionally keeps the remaining storage metadata outside Task.
  board_id: 'b1',
  label_id: null,
  label_assignment_explicit: false,
  author_id: null,
  last_editor_id: null,
  author_kind: 'author',
  revision: 1,
  created_at: '',
  updated_at: '',
  ...over,
})

import { rowToTask } from './mappers'

const serverTask = (over: Record<string, unknown> = {}) => rowToTask(serverRow(over))

const appTask = (over: Partial<Task>): Task =>
  asTask({
    id: 't1',
    title: 'server',
    description: '',
    labelId: null,
    color: 'yellow',
    checklist: [],
    status: 'todo',
    completedAt: null,
    reopenStatus: 'todo',
    archivedAt: null,
    day: '2026-07-01',
    atTime: null,
    pinned: false,
    order: 0,
    korder: 0,
    ...NO_RECUR,
    ...over,
  })

beforeEach(() => {
  h.capture.handler = null
  h.capture.rows = [serverRow()]
  h.capture.selectError = null
  h.capture.selectStatus = 200
  h.capture.failLaterPage = false
  h.capture.writeRows = null
  h.capture.insertError = null
  h.insert.mockClear()
  h.upsert.mockClear()
  h.updateEq.mockReset()
  h.updateEq.mockImplementation(h.selectable)
  h.writeSelect.mockClear()
  h.deleteEq.mockClear()
  h.deleteGt.mockReset()
  h.deleteGt.mockImplementation(h.ok)
  h.deleteGte.mockReset()
  h.deleteGte.mockImplementation(h.ok)
  h.deleteIn.mockClear()
  h.capture.attachments = []
  h.capture.trace = []
  h.captureTaskAttachments.mockClear()
  h.restoreAttachments.mockClear()
})

test('a stale echo of our own write does not clobber optimistic state', async () => {
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => {
    await result.current.updateTask(appTask({ title: 'local edit' }))
  })
  expect(result.current.tasks[0].title).toBe('local edit')

  // The write's own change event arrives back — carrying the pre-edit row.
  act(() => {
    h.capture.handler!({
      eventType: 'UPDATE',
      new: serverRow({ title: 'stale echo' }),
      old: { id: 't1' },
    })
  })
  expect(result.current.tasks[0].title).toBe('local edit')
})

test('a change from another device is applied', async () => {
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    h.capture.handler!({
      eventType: 'INSERT',
      new: serverRow({ id: 't2', title: 'from the phone' }),
      old: {},
    })
  })
  expect(result.current.tasks.map((t) => t.id)).toEqual(['t1', 't2'])
})

test('a burst of remote events all apply (series creation from another device)', async () => {
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    h.capture.handler!({
      eventType: 'INSERT',
      new: serverRow({ id: 't2', title: 'burst 1' }),
      old: {},
    })
    h.capture.handler!({
      eventType: 'INSERT',
      new: serverRow({ id: 't3', title: 'burst 2' }),
      old: {},
    })
    h.capture.handler!({
      eventType: 'INSERT',
      new: serverRow({ id: 't4', title: 'burst 3' }),
      old: {},
    })
  })
  expect(result.current.tasks.map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4'])
})

test('reload does not re-insert instances the board already loaded (no duplicate-key 23505)', async () => {
  const today = ymd(new Date())
  // A daily series ending today = exactly one occurrence (today), already materialized as i1.
  h.capture.rows = [
    serverRow({ id: 'tpl1', recur_freq: 'daily', day: today, recur_until: today }),
    serverRow({ id: 'i1', recur_parent_id: 'tpl1', recur_origin_day: today, day: today }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  // The lone occurrence is already covered by i1, so materialize must insert nothing. The bug:
  // reload read a stale (empty) board and re-inserted i1, hitting tasks_recur_instance_uniq.
  expect(h.insert).not.toHaveBeenCalled()
  expect(result.current.tasks.map((t) => t.id)).toEqual(['i1'])
})

test('a materialization race reloads every Occurrence without surfacing an error (#426)', async () => {
  const today = ymd(new Date())
  const tomorrow = ymd(addDays(new Date(), 1))
  const definition = serverRow({
    id: 'series-1',
    recur_freq: 'daily',
    day: today,
    recur_until: tomorrow,
  })
  h.capture.rows = [definition]
  h.capture.insertError = { code: '23505', message: 'duplicate Occurrence' }
  h.insert.mockImplementationOnce(() => {
    // The concurrent writer won one row, then completed the same missing set before our reload.
    h.capture.rows = [
      definition,
      serverRow({
        id: 'winner-today',
        recur_parent_id: 'series-1',
        recur_origin_day: today,
        day: today,
      }),
      serverRow({
        id: 'winner-tomorrow',
        recur_parent_id: 'series-1',
        recur_origin_day: tomorrow,
        day: tomorrow,
      }),
    ]
    return h.selectable()
  })

  const { result } = renderHook(() => useTasks('u1', 'b1', true))

  await waitFor(() =>
    expect({
      error: result.current.error,
      taskIds: result.current.tasks.map((task) => task.id),
    }).toEqual({
      error: null,
      taskIds: ['winner-today', 'winner-tomorrow'],
    }),
  )
})

test('updateSeries "this and future" persists the edited content to existing instances', async () => {
  const today = ymd(new Date())
  h.capture.rows = [
    serverRow({ id: 'tpl1', recur_freq: 'daily', day: today, title: 'old', at_time: '09:00:00' }),
    serverRow({
      id: 'i1',
      recur_parent_id: 'tpl1',
      recur_origin_day: today,
      day: today,
      title: 'old',
      at_time: '09:00:00',
    }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  h.upsert.mockClear()

  const instance = result.current.tasks.find((t) => t.id === 'i1')!
  await act(async () => {
    await result.current.saveTask(
      instance,
      {
        ...instance,
        title: 'new',
        atTime: '14:00',
        recurFreq: 'daily',
        recurInterval: 1,
        recurUntil: null,
      },
      false,
      'future',
    )
  })

  // The instance row written to the DB must carry the edited title and atTime. The bug built these
  // rows from tasksRef.current right after setTasks, so the deferred ref still held the pre-edit
  // 'old' title; atTime was never included in the whitelist at all, so it always reverted to the
  // template's stale time regardless of ref timing.
  const call = h.upsert.mock.calls[0] as unknown as unknown[]
  const rows = call[0] as { id: string; title: string; at_time: string | null }[]
  expect(rows.find((r) => r.id === 'i1')?.title).toBe('new')
  expect(rows.find((r) => r.id === 'i1')?.at_time).toBe('14:00')
  expect(rows.find((r) => r.id === 'tpl1')?.at_time).toBe('14:00')

  // Optimistic board state must also carry the new time, not just the eventual DB write.
  expect(result.current.tasks.find((t) => t.id === 'i1')?.atTime).toBe('14:00')
})

test('removing the Recurrence Rule with "this and all future" ends the Series here (#220)', async () => {
  const today = ymd(new Date())
  const earlier = ymd(addDays(new Date(), -7))
  h.capture.rows = [
    serverRow({ id: 'tpl1', recur_freq: 'weekly', day: earlier, title: 'Standup' }),
    serverRow({ id: 'i0', recur_parent_id: 'tpl1', recur_origin_day: earlier, day: earlier }),
    serverRow({ id: 'i1', recur_parent_id: 'tpl1', recur_origin_day: today, day: today }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  h.upsert.mockClear()

  const instance = result.current.tasks.find((t) => t.id === 'i1')!
  await act(async () => {
    // The draft the editor produces: the Occurrence with its Series' Rule merged on, then Repeat
    // set back to "Does not repeat".
    await result.current.saveTask(
      { ...instance, recurFreq: 'weekly', recurInterval: 1, recurUntil: null },
      { ...instance, recurFreq: 'none', recurInterval: 1, recurUntil: null },
      false,
      'future',
    )
  })

  // The edited card survives as a standalone Task rather than vanishing into a hidden definition,
  // which is what the old routing produced: a definition carrying `recurFreq: 'none'` that
  // materialized nothing and was no longer reachable as a Series.
  const kept = result.current.tasks.find((t) => t.id === 'i1')!
  expect(kept.recurParentId).toBeNull()
  expect(kept.occurrenceDate).toBeNull()
  // Earlier Occurrences belong to the Series that just ended and are left alone.
  expect(result.current.tasks.map((t) => t.id)).toEqual(['i0', 'i1'])

  const call = h.upsert.mock.calls[0] as unknown as unknown[]
  const rows = call[0] as { id: string; recur_freq: string; recur_until: string | null }[]
  // The detach is written before anything is deleted, and the definition keeps a real Rule.
  expect(rows.find((r) => r.id === 'i1')?.recur_freq).toBe('none')
  expect(rows.find((r) => r.id === 'tpl1')?.recur_freq).toBe('weekly')
  expect(rows.find((r) => r.id === 'tpl1')?.recur_until).toBe(ymd(addDays(new Date(), -1)))
})

test('a failed detach leaves the Series definition undeleted (#220)', async () => {
  // The ordering `planEndSeriesAt` documents as load-bearing, asserted end to end rather than on
  // the plan's shape: `tasks.recur_parent_id` cascades, so deleting the definition after a detach
  // that never landed would take the row the user is keeping.
  const today = ymd(new Date())
  h.capture.rows = [
    serverRow({ id: 'tpl1', recur_freq: 'weekly', day: today, title: 'Standup' }),
    serverRow({ id: 'i1', recur_parent_id: 'tpl1', recur_origin_day: today, day: today }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  h.deleteEq.mockClear()
  h.upsert.mockRejectedValueOnce(new Error('detach failed'))

  const instance = result.current.tasks.find((t) => t.id === 'i1')!
  await act(async () => {
    await result.current.saveTask(
      { ...instance, recurFreq: 'weekly', recurInterval: 1, recurUntil: null },
      { ...instance, recurFreq: 'none', recurInterval: 1, recurUntil: null },
      false,
      'future',
    )
  })

  // Cutting at the anchor would otherwise delete tpl1 by id, cascading to i1.
  expect(h.deleteEq).not.toHaveBeenCalled()
  expect(h.deleteGt).not.toHaveBeenCalled()
  // `FATAL` also resyncs, so the row comes back from the server rather than being left detached
  // locally against a database that never took the write.
  await waitFor(() =>
    expect(result.current.tasks.find((t) => t.id === 'i1')?.recurParentId).toBe('tpl1'),
  )
})

test('rollForward moves overdue tasks to today and upserts only them', async () => {
  h.capture.rows = [
    serverRow({ id: 't1', day: '2020-01-01', order_index: 0 }),
    serverRow({ id: 't2', day: '2026-07-10', order_index: 2 }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => {
    await result.current.rollForward('2026-07-10')
  })
  const moved = result.current.tasks.find((t) => t.id === 't1')!
  expect(moved.day).toBe('2026-07-10')
  expect(moved.order).toBe(3)
})

test('rollForward with onlyIds moves only the given overdue tasks', async () => {
  h.capture.rows = [
    serverRow({ id: 't1', day: '2020-01-01', order_index: 0 }),
    serverRow({ id: 't2', day: '2020-01-02', order_index: 1 }),
    serverRow({ id: 't3', day: '2026-07-10', order_index: 2 }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => {
    await result.current.rollForward('2026-07-10', new Set(['t1']))
  })
  const moved = result.current.tasks.find((t) => t.id === 't1')!
  const untouched = result.current.tasks.find((t) => t.id === 't2')!
  expect(moved.day).toBe('2026-07-10')
  expect(untouched.day).toBe('2020-01-02') // still overdue, but excluded from onlyIds

  // Only the moved task's row is upserted.
  const lastCall = h.upsert.mock.calls[h.upsert.mock.calls.length - 1] as unknown as [
    { id: string }[],
  ]
  expect(lastCall[0].map((r) => r.id)).toEqual(['t1'])
})

test('a thrown/rejected write rolls back the optimistic change and sets error, same as a resolved { error }', async () => {
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.tasks.find((t) => t.id === 't1')?.status).toBe('todo')

  // The write layer rejects instead of resolving `{ error }` (e.g. a network fault).
  h.writeSelect.mockRejectedValueOnce(new Error('network down'))

  await act(async () => {
    await result.current.toggleCompletion('t1')
  })

  // The optimistic toggle must be rolled back...
  expect(result.current.tasks.find((t) => t.id === 't1')?.status).toBe('todo')
  // ...and the throw must surface through the same setError path a resolved `{ error }` would.
  expect(result.current.error).toBe('network down')
})

test('a Completion write reconciles the authoritative row returned after server triggers', async () => {
  h.capture.rows = [serverRow({ status: 'doing' })]
  h.capture.writeRows = [
    serverRow({
      status: 'done',
      completed_at: '2026-09-03T14:30:00.000Z',
      reopen_status: 'doing',
    }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => {
    await result.current.toggleCompletion('t1')
  })

  expect(h.writeSelect).toHaveBeenCalledTimes(1)
  expect(result.current.tasks[0]).toMatchObject({
    status: 'completed',
    completedAt: '2026-09-03T14:30:00.000Z',
    reopenStatus: 'doing',
  })
})

test('an editor Workflow Status change reconciles its authoritative returned row', async () => {
  h.capture.rows = [serverRow({ status: 'todo' })]
  h.capture.writeRows = [
    serverRow({
      status: 'done',
      completed_at: '2026-09-03T14:31:00.000Z',
      reopen_status: 'todo',
    }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => {
    await result.current.updateTask(
      appTask({
        status: 'completed',
        completedAt: '2026-09-03T14:30:59.000Z',
        reopenStatus: 'todo',
      }),
    )
  })

  expect(h.writeSelect).toHaveBeenCalledTimes(1)
  expect(result.current.tasks[0].completedAt).toBe('2026-09-03T14:31:00.000Z')
})

test('a Kanban Workflow Status batch reconciles all authoritative returned rows', async () => {
  h.capture.rows = [serverRow({ status: 'todo' })]
  h.capture.writeRows = [
    serverRow({
      status: 'done',
      completed_at: '2026-09-03T14:32:00.000Z',
      reopen_status: 'todo',
    }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const completed = appTask({
    status: 'completed',
    completedAt: '2026-09-03T14:31:59.000Z',
    reopenStatus: 'todo',
  })

  await act(async () => {
    await result.current.persistReorder([completed], ['todo', 'completed'], 'status')
  })

  expect(h.writeSelect).toHaveBeenCalledTimes(1)
  expect(result.current.tasks[0].completedAt).toBe('2026-09-03T14:32:00.000Z')
})

test('a failing excludedDates write on deleteOccurrence still removes the occurrence locally and surfaces the error', async () => {
  const today = ymd(new Date())
  // The Rule outlives this delete on purpose. Capped at `today` it would have exactly one
  // Occurrence Date, so deleting `i1` spends it and `planDeleteOccurrence` drops the definition
  // instead of writing an Excluded Date to it (#231) — leaving nothing for the rejection below to
  // land on, and leaking the unconsumed `mockRejectedValueOnce` into the next test.
  const until = ymd(addDays(parseDay(today), 2))
  h.capture.rows = [
    serverRow({ id: 'tpl1', recur_freq: 'daily', day: today, recur_until: until }),
    serverRow({ id: 'i1', recur_parent_id: 'tpl1', recur_origin_day: today, day: today }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  // The template's excludedDates update rejects (e.g. a network fault) — this was previously
  // swallowed by a bare console.error with no user-visible signal.
  h.upsert.mockRejectedValueOnce(new Error('skip write failed'))

  const instance = result.current.tasks.find((t) => t.id === 'i1')!
  await act(async () => {
    await result.current.deleteTask(instance.id, 'this')
  })

  // The occurrence removal (the following step, removeTask) still ran locally despite the
  // failed excludedDates write...
  expect(result.current.tasks.find((t) => t.id === 'i1')).toBeUndefined()
  // ...and the failure is now surfaced instead of failing silently.
  expect(result.current.error).toBe('skip write failed')
})

// #231 through the real hook. The planner tests cover the decision; this covers the wiring, since
// it is the first `deleteTask(_, 'this')` plan whose deletion targets the definition row rather
// than the Occurrence, and lets the database cascade take the Occurrence with it.
test('deleting the last occurrence of a spent repeat deletes the definition, not the occurrence', async () => {
  const today = ymd(new Date())
  h.capture.rows = [
    serverRow({ id: 'tpl1', recur_freq: 'daily', day: today, recur_until: today }),
    serverRow({ id: 'i1', recur_parent_id: 'tpl1', recur_origin_day: today, day: today }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  h.deleteEq.mockClear()
  h.upsert.mockClear()

  const instance = result.current.tasks.find((t) => t.id === 'i1')!
  await act(async () => {
    await result.current.deleteTask(instance.id, 'this')
  })

  expect(result.current.tasks.find((t) => t.id === 'i1')).toBeUndefined()
  expect(result.current.error).toBeNull()
  // One delete, aimed at the definition — the cascade removes 'i1'.
  expect(h.deleteEq).toHaveBeenCalledTimes(1)
  expect(h.deleteEq).toHaveBeenCalledWith('id', 'tpl1')
  // No Excluded Date written to a row that is going away.
  expect(h.upsert).not.toHaveBeenCalled()
})

test('a failing trim-delete on updateSeries still materializes the widened window and surfaces the error', async () => {
  const today = ymd(new Date())
  h.capture.rows = [
    serverRow({ id: 'tpl1', recur_freq: 'daily', day: today, recur_until: today }),
    serverRow({ id: 'i1', recur_parent_id: 'tpl1', recur_origin_day: today, day: today }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  h.insert.mockClear()

  // The trim-delete's `.gt(...)` leg rejects (e.g. a network fault) — this was previously
  // swallowed by a bare console.error with no user-visible signal.
  h.deleteGt.mockRejectedValueOnce(new Error('trim failed'))

  const until = ymd(addDays(parseDay(today), 3))
  const instance = result.current.tasks.find((t) => t.id === 'i1')!
  await act(async () => {
    await result.current.saveTask(
      instance,
      { ...instance, recurFreq: 'daily', recurInterval: 1, recurUntil: until },
      false,
      'future',
    )
  })

  // materialize (the following step) still ran despite the failed trim-delete: widening the
  // window from `recur_until: today` to `until` backfills the newly-in-range occurrences.
  const days = result.current.tasks
    .filter((t) => t.recurParentId === 'tpl1')
    .map((t) => t.day)
    .sort()
  expect(days).toEqual([
    today,
    ymd(addDays(parseDay(today), 1)),
    ymd(addDays(parseDay(today), 2)),
    until,
  ])
  // ...and the failure is now surfaced instead of failing silently.
  expect(result.current.error).toBe('trim failed')
})

test('a failed load hydrates from the snapshot and materializes nothing', async () => {
  localStorage.setItem(
    'ma-snapshot-board.b1',
    JSON.stringify({
      v: 9,
      userId: 'u1',
      boardId: 'b1',
      savedAt: 1_770_000_000_000,
      tasks: [{ ...serverTask(), id: 'cached' }],
      templates: [{ ...serverTask(), id: 'tmpl', recurFreq: 'daily', recurParentId: null }],
    }),
  )
  h.capture.selectError = { message: 'FetchError: Failed to fetch' }
  h.capture.selectStatus = 0

  const { result } = renderHook(() => useTasks('u1', 'b1', true))

  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.tasks.map((t) => t.id)).toEqual(['cached'])
  expect(result.current.offline).toBe(true)
  expect(result.current.fallbackReason).toBe('network')
  expect(result.current.savedAt).toBe(1_770_000_000_000)
  expect(result.current.error).toBeNull()
  // Templates live outside the `tasks` list (in templatesRef), so this is the only way to prove
  // hydrateFromSnapshot() actually restored them — dropping that assignment would leave every
  // other assertion in this test passing while silently losing the concept of the series.
  expect(result.current.getTemplate('tmpl')).toBeDefined()
  // The dangerous one: materialize() inserts rows, and running it over snapshot state
  // risks duplicate instances against tasks_recur_instance_uniq (23505).
  expect(h.insert).not.toHaveBeenCalled()
})

test('an authentication failure keeps the snapshot but is not relabelled as offline', async () => {
  localStorage.setItem(
    'ma-snapshot-board.b1',
    JSON.stringify({
      v: 9,
      userId: 'u1',
      boardId: 'b1',
      savedAt: 1_770_000_000_000,
      tasks: [{ ...serverTask(), id: 'cached' }],
      templates: [],
    }),
  )
  h.capture.selectError = { message: 'JWT expired' }
  h.capture.selectStatus = 401

  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  expect(result.current.tasks.map((task) => task.id)).toEqual(['cached'])
  expect(result.current.offline).toBe(true)
  expect(result.current.fallbackReason).toBe('auth')
  expect(result.current.error).toBe('JWT expired')
})

test('a failed load with no snapshot still surfaces the error', async () => {
  h.capture.selectError = { message: 'FetchError: Failed to fetch' }
  h.capture.selectStatus = 0
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.offline).toBe(false)
  expect(result.current.error).toContain('Failed to fetch')
})

test('a failed load with no snapshot does not poison storage with an empty board', async () => {
  h.capture.selectError = { message: 'FetchError: Failed to fetch' }
  h.capture.selectStatus = 0
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  // Advance well past the writer's 1s debounce so this proves no write ever happens, rather
  // than merely racing a write that just hasn't fired yet. If a server load never succeeds,
  // writing `{ tasks: [], templates: [] }` here would read back as valid, freshly-saved offline
  // data on the very next failed load — indistinguishable from a genuinely empty board.
  await new Promise((r) => setTimeout(r, 1500))
  expect(localStorage.getItem('ma-snapshot-board.b1')).toBeNull()
})

test('a successful load writes a snapshot', async () => {
  h.capture.rows = [serverRow()]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  // The snapshot write is debounced, so the default 1000ms waitFor races it under CI load -- this
  // test failed exactly that way on main at 1088ms. The three other snapshot assertions in this
  // file already wait 2000ms; this was the one that did not.
  await waitFor(() => expect(localStorage.getItem('ma-snapshot-board.b1')).not.toBeNull(), {
    timeout: 2000,
  })
  const snap = readBoardSnapshot('u1', 'b1')
  expect(snap).not.toBeNull()
  expect(snap?.tasks).toHaveLength(1)
  // Proves templatesRef.current is actually threaded into the write call, not just the tasks.
  expect(snap?.templates).toEqual([])
})

test('a template-only realtime change refreshes the offline snapshot (#249)', async () => {
  h.capture.rows = [
    serverRow({ id: 'tpl1', title: 'old series title', recur_freq: 'daily' }),
    serverRow({ id: 'i1', title: 'occurrence', recur_parent_id: 'tpl1' }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  await waitFor(
    () => expect(readBoardSnapshot('u1', 'b1')?.templates[0]?.title).toBe('old series title'),
    { timeout: 2000 },
  )

  act(() => {
    h.capture.handler!({
      eventType: 'UPDATE',
      new: serverRow({ id: 'tpl1', title: 'new series title', recur_freq: 'daily' }),
      old: { id: 'tpl1' },
    })
  })

  // No visible Task changed, so this catches a writer that only uses `tasks` as its debounce
  // trigger even though the envelope also persists hidden Series definitions.
  await waitFor(
    () => expect(readBoardSnapshot('u1', 'b1')?.templates[0]?.title).toBe('new series title'),
    { timeout: 2000 },
  )
})

test('reconnecting clears offline mode', async () => {
  localStorage.setItem(
    'ma-snapshot-board.b1',
    JSON.stringify({ v: 9, userId: 'u1', boardId: 'b1', savedAt: 1, tasks: [], templates: [] }),
  )
  h.capture.selectError = { message: 'FetchError: Failed to fetch' }
  h.capture.selectStatus = 0
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.offline).toBe(true))

  h.capture.selectError = null
  h.capture.selectStatus = 200
  h.capture.rows = [serverRow()]
  act(() => {
    window.dispatchEvent(new Event('online'))
  })
  await waitFor(() => expect(result.current.offline).toBe(false))
  expect(result.current.fallbackReason).toBeNull()
  expect(result.current.tasks).toHaveLength(1)
})

// FIX 2 bite-proof. A session that vanished without SIGNED_OUT leaves the board hydrated from
// snapshot (offline, read-only). When connectivity returns but there is still no session,
// `reload()` succeeds against RLS with `{ data: [], error: null }` — a "successful" load that
// authenticated nothing. Before the fix, that flipped `hasLoadedFromServer` and let the debounced
// writer overwrite the real snapshot with an empty board, so the *next* offline boot would show
// nothing under an "Offline" banner instead of the last-known tasks.
test('reconnecting while sessionless does not poison the board snapshot with an empty board', async () => {
  const existing = {
    v: 9,
    userId: 'u1',
    boardId: 'b1',
    savedAt: 1,
    tasks: [{ ...serverTask(), id: 'cached' }],
    templates: [],
  }
  localStorage.setItem('ma-snapshot-board.b1', JSON.stringify(existing))
  h.capture.selectError = { message: 'FetchError: Failed to fetch' }
  h.capture.selectStatus = 0
  const { result } = renderHook(() => useTasks('u1', 'b1', false))
  await waitFor(() => expect(result.current.offline).toBe(true))
  expect(result.current.tasks.map((t) => t.id)).toEqual(['cached'])

  // Network returns, but there is still no session: RLS answers the reload with `[]` and no
  // error rather than an error.
  h.capture.selectError = null
  h.capture.selectStatus = 200
  h.capture.rows = []
  act(() => {
    window.dispatchEvent(new Event('online'))
  })
  await waitFor(() => expect(result.current.offline).toBe(false))

  // Advance well past the writer's 1s debounce so this proves no write ever happens, rather than
  // merely racing a write that just hasn't fired yet (see the equivalent failed-load test above).
  await new Promise((r) => setTimeout(r, 1500))
  expect(readBoardSnapshot('u1', 'b1')).toEqual(existing)
})

test('deleting an id that is not on the board is a no-op, not a stray write', async () => {
  // Taking an id rather than a task (#132) means the row acted on is always this hook's own state.
  // An unknown id is what an already-deleted-elsewhere row looks like: deleting it again would be
  // a pointless write, and for a series a plan computed against a row that isn't there.
  h.capture.rows = [serverRow({ id: 't1' })]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  h.deleteEq.mockClear()
  const before = result.current.tasks.length

  await act(async () => {
    await result.current.deleteTask('not-on-the-board')
  })

  expect(result.current.tasks).toHaveLength(before)
  expect(h.deleteEq).not.toHaveBeenCalled()
  expect(result.current.error).toBeNull()
})

test('adding a recurrence rule keeps the task in progress instead of resetting it', async () => {
  const today = ymd(new Date())
  h.capture.rows = [
    serverRow({
      id: 't1',
      day: today,
      status: 'doing',
      order_index: 3,
      korder: 7,
      pinned: true,
      checklist: [
        { id: 'c1', text: 'step one', done: true },
        { id: 'c2', text: 'step two', done: false },
      ],
    }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  const original = result.current.tasks.find((t) => t.id === 't1')!
  await act(async () => {
    await result.current.saveTask(original, { ...original, recurFreq: 'weekly' }, false)
  })

  // Until #206 this row became the hidden template and materialization built a replacement in its
  // place — new id, status back to 'todo', checklist unticked, order 5000. The card the user was
  // working on is now the series' first Occurrence, so none of that happens.
  const first = result.current.tasks.find((t) => t.id === 't1')
  expect(first).toBeDefined()
  expect(first!.status).toBe('doing')
  expect(first!.checklist.map((c) => c.done)).toEqual([true, false])
  expect(first!.order).toBe(3)
  expect(first!.korder).toBe(7)
  expect(first!.occurrenceDate).toBe(today)
  expect(first!.recurParentId).toBeTruthy()
  expect(first!.recurFreq).toBe('none')

  // Exactly one card on today, not the original plus a materialized duplicate.
  expect(result.current.tasks.filter((t) => t.day === today)).toHaveLength(1)

  // The template is hidden from the board but reachable, and holds the rule.
  const template = result.current.getTemplate(first!.recurParentId!)
  expect(template?.recurFreq).toBe('weekly')
  expect(result.current.tasks.some((t) => t.id === template!.id)).toBe(false)
  // Per-occurrence state never lands on a definition.
  expect(template?.status).toBe('todo')
  expect(template?.checklist.every((c) => !c.done)).toBe(true)
})

test('promotion writes the template and the first occurrence in one batch', async () => {
  const today = ymd(new Date())
  h.capture.rows = [serverRow({ id: 't1', day: today })]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  h.upsert.mockClear()

  const original = result.current.tasks.find((t) => t.id === 't1')!
  await act(async () => {
    await result.current.saveTask(original, { ...original, recurFreq: 'weekly' }, false)
  })

  const rows = (h.upsert.mock.calls[0] as unknown as unknown[])[0] as {
    id: string
    recur_freq: string
    recur_parent_id: string | null
    recur_origin_day: string | null
  }[]
  expect(rows).toHaveLength(2)
  const template = rows.find((r) => r.recur_freq === 'weekly')!
  const first = rows.find((r) => r.id === 't1')!
  expect(first.recur_parent_id).toBe(template.id)
  expect(first.recur_origin_day).toBe(today)
  expect(first.recur_freq).toBe('none')
})

test('loads every Task on a Board larger than the API row cap', async () => {
  h.capture.rows = Array.from({ length: 1250 }, (_, i) => serverRow({ id: `task-${i}` }))
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBeNull()
  expect(result.current.tasks).toHaveLength(1250)
})

test.each(['delete', 'end'] as const)(
  '%s Series from here preserves an earlier Occurrence beyond the first page',
  async (operation) => {
    h.capture.rows = [
      serverRow({ id: 'tpl', recur_freq: 'daily', day: '2020-01-01', recur_until: '2020-01-02' }),
      serverRow({
        id: 'later',
        recur_parent_id: 'tpl',
        recur_origin_day: '2020-01-02',
        day: '2020-01-02',
      }),
      ...Array.from({ length: 1247 }, (_, i) => serverRow({ id: `plain-${i}` })),
      serverRow({
        id: 'earlier',
        recur_parent_id: 'tpl',
        recur_origin_day: '2020-01-01',
        day: '2020-01-01',
      }),
    ]
    const { result } = renderHook(() => useTasks('u1', 'b1', true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const later = result.current.tasks.find((task) => task.id === 'later')!
    await act(async () => {
      if (operation === 'delete') await result.current.deleteTask(later.id, 'future')
      else
        await result.current.saveTask(
          { ...later, recurFreq: 'daily' },
          { ...later, recurFreq: 'none' },
          false,
          'future',
        )
    })
    expect(result.current.error).toBeNull()
    expect(result.current.tasks.some((task) => task.id === 'earlier')).toBe(true)
    expect(result.current.getTemplate('tpl')).toBeDefined()
    expect(h.deleteEq).not.toHaveBeenCalledWith('id', 'tpl')
    if (operation === 'end') {
      expect(result.current.tasks.find((task) => task.id === 'later')?.recurParentId).toBeNull()
      expect(h.deleteGt).toHaveBeenCalledWith('recur_origin_day', '2020-01-02')
    }
  },
)

test('a failed reload revokes permission to execute destructive Series plans until a complete reload', async () => {
  h.capture.rows = [
    serverRow({ id: 'tpl', recur_freq: 'daily', day: '2020-01-01', recur_until: '2020-01-01' }),
    serverRow({
      id: 'occurrence',
      recur_parent_id: 'tpl',
      recur_origin_day: '2020-01-01',
      day: '2020-01-01',
    }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  h.capture.selectError = { message: 'load failed' }
  h.capture.selectStatus = 500
  await act(async () => {
    await result.current.reload()
  })
  await act(async () => {
    await result.current.deleteTask('occurrence', 'future')
  })
  expect(result.current.error).toContain('Reload the complete Board')
  expect(h.deleteEq).not.toHaveBeenCalled()
  expect(h.upsert).not.toHaveBeenCalled()
  h.capture.selectError = null
  h.capture.selectStatus = 200
  await act(async () => {
    await result.current.reload()
  })
  await act(async () => {
    await result.current.deleteTask('occurrence', 'future')
  })
  expect(h.deleteEq).toHaveBeenCalledWith('id', 'tpl')
})

test('a later load page failure publishes no partial Board and materializes nothing', async () => {
  h.capture.rows = [
    serverRow({ id: 'tpl', recur_freq: 'daily', day: ymd(new Date()) }),
    ...Array.from({ length: 1000 }, (_, i) => serverRow({ id: `plain-${i}` })),
  ]
  h.capture.failLaterPage = true
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBe('later page failed')
  expect(result.current.tasks).toEqual([])
  expect(result.current.getTemplate('tpl')).toBeUndefined()
  expect(h.insert).not.toHaveBeenCalled()
  expect(h.upsert).not.toHaveBeenCalled()
})

// #351: Archived Tasks are hidden only at the Board's view seam (#242). useTasks must keep them in
// state, in the snapshot, and through realtime — filtering them here would make materialization
// re-create an Archived Occurrence (23505) and let a trim delete a Series still in use.
const ARCHIVED = {
  status: 'done',
  completed_at: '2026-07-01T12:00:00.000Z',
  archived_at: '2026-07-02T12:00:00.000Z',
}

test('an Archived Occurrence stays on the board state and is not re-inserted on load (#351)', async () => {
  const today = ymd(new Date())
  // The companion of the non-Archived test above: the lone occurrence is covered by an Archived i1.
  h.capture.rows = [
    serverRow({ id: 'tpl1', recur_freq: 'daily', day: today, recur_until: today }),
    serverRow({
      id: 'i1',
      recur_parent_id: 'tpl1',
      recur_origin_day: today,
      day: today,
      ...ARCHIVED,
    }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  expect(h.insert).not.toHaveBeenCalled()
  expect(result.current.tasks.map((t) => t.id)).toEqual(['i1'])
  expect(result.current.tasks[0].archivedAt).not.toBeNull()
  expect(result.current.getTemplate('tpl1')?.excludedDates).toEqual([])
})

test('a realtime Archive keeps the row in board state (#351)', async () => {
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    h.capture.handler!({ eventType: 'UPDATE', new: serverRow(ARCHIVED), old: { id: 't1' } })
  })

  expect(result.current.tasks.map((t) => t.id)).toEqual(['t1'])
  expect(result.current.tasks[0].archivedAt).toBe(ARCHIVED.archived_at)
})

test('the offline snapshot keeps Archived Tasks, both written and hydrated (#351)', async () => {
  h.capture.rows = [serverRow({ id: 'active' }), serverRow({ id: 'archived', ...ARCHIVED })]
  const first = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(first.result.current.loading).toBe(false))
  await waitFor(
    () =>
      expect(readBoardSnapshot('u1', 'b1')?.tasks.map((t) => t.id)).toEqual(['active', 'archived']),
    { timeout: 2000 },
  )
  first.unmount()

  h.capture.selectError = { message: 'FetchError: Failed to fetch' }
  h.capture.selectStatus = 0
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.offline).toBe(true)
  expect(result.current.tasks.map((t) => t.id)).toEqual(['active', 'archived'])
  expect(result.current.tasks[1].archivedAt).toBe(ARCHIVED.archived_at)
})

test('bulkUpdate writes only the changed rows in one batch and reconciles a status change (#270)', async () => {
  h.capture.rows = [
    serverRow({ id: 't1', status: 'todo', korder: 0 }),
    serverRow({
      id: 't2',
      status: 'completed',
      reopen_status: 'todo',
      completed_at: 'x',
      korder: 0,
    }),
    serverRow({ id: 't3', status: 'doing', reopen_status: 'doing', korder: 1 }),
  ]
  h.capture.writeRows = [serverRow({ id: 't1', status: 'done', completed_at: 'server-time' })]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  h.upsert.mockClear()

  await act(async () => {
    await result.current.bulkUpdate(new Set(['t1', 't2']), { kind: 'status', status: 'completed' })
  })

  expect(h.upsert).toHaveBeenCalledTimes(1)
  const [rows] = h.upsert.mock.calls[0] as unknown as [{ id: string }[]]
  expect(rows.map((r) => r.id)).toEqual(['t1'])
  expect(h.writeSelect).toHaveBeenCalled()
  expect(result.current.tasks.find((t) => t.id === 't1')?.completedAt).toBe('server-time')
  expect(result.current.tasks.find((t) => t.id === 't3')?.status).toBe('doing')
})

test('a failed bulkUpdate rolls every selected Task back and surfaces the error', async () => {
  h.capture.rows = [
    serverRow({ id: 't1', color: 'yellow' }),
    serverRow({ id: 't2', color: 'blue' }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  h.upsert.mockRejectedValueOnce(new Error('nope'))

  await act(async () => {
    await result.current.bulkUpdate(new Set(['t1', 't2']), { kind: 'color', color: 'mint' })
  })

  expect(result.current.tasks.map((t) => t.color)).toEqual(['yellow', 'blue'])
  expect(result.current.error).toBe('nope')
})

test('bulkDelete of plain Tasks is one batched delete, rolled back on failure', async () => {
  h.capture.rows = [serverRow({ id: 't1' }), serverRow({ id: 't2' }), serverRow({ id: 't3' })]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => {
    await result.current.bulkDelete(new Set(['t1', 't3']))
  })
  expect(h.deleteIn).toHaveBeenCalledWith('id', ['t1', 't3'])
  expect(result.current.tasks.map((t) => t.id)).toEqual(['t2'])

  h.deleteIn.mockRejectedValueOnce(new Error('denied'))
  await act(async () => {
    await result.current.bulkDelete(new Set(['t2']))
  })
  expect(result.current.tasks.map((t) => t.id)).toEqual(['t2'])
  expect(result.current.error).toBe('denied')
})

test('bulkDelete of Occurrences writes one definition update and one batched row delete', async () => {
  const today = ymd(new Date())
  const next = ymd(addDays(parseDay(today), 1))
  h.capture.rows = [
    serverRow({ id: 'tpl1', recur_freq: 'daily', day: today }),
    serverRow({ id: 'i1', recur_parent_id: 'tpl1', recur_origin_day: today, day: today }),
    serverRow({ id: 'i2', recur_parent_id: 'tpl1', recur_origin_day: next, day: next }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  h.upsert.mockClear()

  await act(async () => {
    await result.current.bulkDelete(new Set(['i1', 'i2']))
  })

  expect(h.upsert).toHaveBeenCalledTimes(1)
  const [rows] = h.upsert.mock.calls[0] as unknown as [{ id: string; recur_skip: string[] }[]]
  expect(rows.map((r) => [r.id, r.recur_skip])).toEqual([['tpl1', [today, next]]])
  expect(h.deleteIn).toHaveBeenCalledWith('id', ['i1', 'i2'])
})

// ——— undo (#271) ———

test('completing offers undo; undo writes the prior row back and clears the offer', async () => {
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => {
    await result.current.toggleCompletion('t1')
  })
  expect(result.current.lastUndo?.label).toBe('Completed “server”')
  h.upsert.mockClear()

  let ok = false
  await act(async () => {
    ok = await result.current.undo()
  })
  expect(ok).toBe(true)
  expect(result.current.lastUndo).toBeNull()
  expect(result.current.tasks.find((t) => t.id === 't1')?.status).toBe('todo')
  const [rows] = h.upsert.mock.calls[0] as unknown as [{ id: string; status: string }[]]
  expect(rows.map((r) => [r.id, r.status])).toEqual([['t1', 'todo']])
})

test('a failed action offers no undo, and any other write forgets a pending one', async () => {
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  h.writeSelect.mockRejectedValueOnce(new Error('network down'))
  await act(async () => {
    await result.current.toggleCompletion('t1')
  })
  expect(result.current.lastUndo).toBeNull()

  await act(async () => {
    await result.current.toggleCompletion('t1')
  })
  expect(result.current.lastUndo).not.toBeNull()
  await act(async () => {
    await result.current.updateTask({ ...result.current.tasks[0], title: 'edited' })
  })
  expect(result.current.lastUndo).toBeNull()
})

test('undoing a plain delete re-inserts the row with its original id', async () => {
  h.capture.rows = [serverRow({ id: 't1', title: 'keep me' }), serverRow({ id: 't2' })]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => {
    await result.current.deleteTask('t1')
  })
  expect(result.current.lastUndo?.label).toBe('Deleted “keep me”')
  h.upsert.mockClear()
  await act(async () => {
    await result.current.undo()
  })
  expect(result.current.tasks.map((t) => t.id).sort()).toEqual(['t1', 't2'])
  const [rows] = h.upsert.mock.calls[0] as unknown as [{ id: string; title: string }[]]
  expect(rows.map((r) => [r.id, r.title])).toEqual([['t1', 'keep me']])
})

test('undoing a drag restores the pre-drag placement, not the last preview', async () => {
  h.capture.rows = [
    serverRow({ id: 't1', title: 'dragged', day: '2026-07-01', order_index: 0 }),
    serverRow({ id: 't2', day: '2026-07-02', order_index: 0 }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  const board = result.current.tasks
  const hover = board.map((t) => (t.id === 't1' ? { ...t, day: '2026-07-02', order: 1 } : t))
  act(() => result.current.previewReorder(hover))
  const drop = hover.map((t) => (t.id === 't1' ? { ...t, order: 0 } : { ...t, order: 1 }))
  await act(async () => {
    await result.current.persistReorder(drop, ['2026-07-01', '2026-07-02'], 'day')
  })
  expect(result.current.lastUndo?.label).toBe('Moved “dragged”')

  await act(async () => {
    await result.current.undo()
  })
  const t1 = result.current.tasks.find((t) => t.id === 't1')!
  const t2 = result.current.tasks.find((t) => t.id === 't2')!
  expect([t1.day, t1.order, t2.order]).toEqual(['2026-07-01', 0, 0])
})

test('undoing a bulk delete of Occurrences restores the definition before its Occurrences', async () => {
  const today = ymd(new Date())
  h.capture.rows = [
    serverRow({ id: 'tpl1', recur_freq: 'daily', day: today, recur_until: today }),
    serverRow({ id: 'i1', recur_parent_id: 'tpl1', recur_origin_day: today, day: today }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => {
    await result.current.bulkDelete(new Set(['i1']))
  })
  expect(result.current.lastUndo?.label).toBe('Deleted 1 task')
  h.upsert.mockClear()
  await act(async () => {
    await result.current.undo()
  })

  const calls = h.upsert.mock.calls as unknown as [{ id: string }[]][]
  expect(calls.map(([rows]) => rows.map((r) => r.id))).toEqual([['tpl1'], ['i1']])
  expect(result.current.tasks.map((t) => t.id)).toEqual(['i1'])
  expect(result.current.getTemplate('tpl1')).toBeDefined()
})

test('undo refuses on a board that has not completed an authenticated load', async () => {
  const { result } = renderHook(() => useTasks('u1', 'b1', false))
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => {
    await result.current.toggleCompletion('t1')
  })
  let ok = true
  await act(async () => {
    ok = await result.current.undo()
  })
  expect(ok).toBe(false)
  expect(result.current.error).toBe('Reload the complete Board before undoing.')
})

test('an undo recorded on one Board is hidden and refused after switching Boards', async () => {
  const { result, rerender } = renderHook(({ board }) => useTasks('u1', board, true), {
    initialProps: { board: 'b1' },
  })
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => {
    await result.current.toggleCompletion('t1')
  })
  expect(result.current.lastUndo).not.toBeNull()

  rerender({ board: 'b2' })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.lastUndo).toBeNull()
  h.upsert.mockClear()
  let ok = true
  await act(async () => {
    ok = await result.current.undo()
  })
  expect(ok).toBe(false)
  expect(h.upsert).not.toHaveBeenCalled()
})

test('an action still saving when a later write starts offers no undo', async () => {
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  let finish!: () => void
  h.writeSelect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ data: null, error: null })
      }),
  )
  let toggling!: void | Promise<void>
  act(() => {
    toggling = result.current.toggleCompletion('t1')
  })
  await act(async () => {
    await result.current.updateTask({ ...result.current.tasks[0], title: 'edited meanwhile' })
  })
  await act(async () => {
    finish()
    await toggling
  })
  expect(result.current.lastUndo).toBeNull()
})

test('a drag origin left by a cancelled drag is not inherited after a reload', async () => {
  h.capture.rows = [
    serverRow({ id: 't1', title: 'dragged', day: '2026-07-01', order_index: 0 }),
    serverRow({ id: 't2', day: '2026-07-02', order_index: 0 }),
  ]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  // A drag that hovers and is cancelled: an origin is recorded, nothing persists.
  act(() =>
    result.current.previewReorder(
      result.current.tasks.map((t) => (t.id === 't1' ? { ...t, day: '2026-07-03' } : t)),
    ),
  )
  // The server now has t1 elsewhere; a reload brings that in.
  h.capture.rows = [
    serverRow({ id: 't1', title: 'dragged', day: '2026-07-05', order_index: 0 }),
    serverRow({ id: 't2', day: '2026-07-02', order_index: 0 }),
  ]
  await act(async () => {
    await result.current.reload()
  })

  const board = result.current.tasks
  const moved = board.map((t) => (t.id === 't1' ? { ...t, day: '2026-07-02', order: 1 } : t))
  act(() => result.current.previewReorder(moved))
  await act(async () => {
    await result.current.persistReorder(moved, ['2026-07-05', '2026-07-02'], 'day')
  })
  await act(async () => {
    await result.current.undo()
  })
  // Restored to where the reload put it, not to the stale pre-cancel origin.
  expect(result.current.tasks.find((t) => t.id === 't1')?.day).toBe('2026-07-05')
})

// ——— undo restores attachments (#404) ———
// The delete cascade takes `task_attachments` rows with the Task. Undo re-inserted only the Task,
// so the attachments were gone while their files sat in storage, reachable by nothing. What these
// assert is *sequence*: the rows have to be read before the DELETE and written back after the
// Task is, and neither order is visible in a diff.

const attachment = (id: string, taskId: string) => ({
  id,
  taskId,
  boardId: 'b1',
  storagePath: `b1/${taskId}/${id}`,
  filename: `${id}.png`,
  mimeType: 'image/png',
  sizeBytes: 10,
  uploadedBy: 'u1',
  createdAt: '',
})

test('a plain delete reads its attachments before the DELETE, and undo writes them back after the Task', async () => {
  h.capture.rows = [serverRow({ id: 't1', title: 'has files' })]
  h.capture.attachments = [attachment('a1', 't1')]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  h.capture.trace = []

  await act(async () => {
    await result.current.deleteTask('t1')
  })
  // Before, not after: once the DELETE lands the cascade has taken the rows.
  expect(h.capture.trace).toEqual(['captureAttachments:t1', 'deleteTask'])

  h.capture.trace = []
  await act(async () => {
    await result.current.undo()
  })
  // After, not before: the composite foreign key has nowhere to point until the Task is back.
  expect(h.capture.trace).toEqual(['upsertTasks', 'restoreAttachments:a1'])
})

test('the attachment read happens after the Task has already left the board, not before', async () => {
  h.capture.rows = [serverRow({ id: 't1' })]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  // Hold the capture open. Every delete pays for this read, so it must not be what the user waits
  // on: the optimistic removal has to have happened already.
  let release!: () => void
  h.captureTaskAttachments.mockImplementationOnce(
    () => new Promise((resolve) => (release = () => resolve([]))),
  )
  let deleting!: void | Promise<void>
  // The synchronous form: the optimistic removal happens before `deleteTask`'s first await, so
  // this flushes it without letting the held-open capture resolve.
  act(() => {
    deleting = result.current.deleteTask('t1')
  })
  expect(result.current.tasks).toEqual([])
  expect(h.deleteEq).not.toHaveBeenCalled()

  await act(async () => {
    release()
    await deleting
  })
  expect(h.deleteEq).toHaveBeenCalled()
})

test('an attachment read that fails still deletes the Task and still offers undo', async () => {
  h.capture.rows = [serverRow({ id: 't1', title: 'unreadable' })]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  // `captureTaskAttachments` swallows its own failures; this proves the caller does not reintroduce
  // one. A delete that failed because an attachment read did would be a far worse bug than #404.
  h.captureTaskAttachments.mockResolvedValueOnce([])
  await act(async () => {
    await result.current.deleteTask('t1')
  })
  expect(result.current.tasks).toEqual([])
  expect(result.current.error).toBeNull()
  expect(result.current.lastUndo?.label).toBe('Deleted “unreadable”')

  h.capture.trace = []
  await act(async () => {
    await result.current.undo()
  })
  // Nothing captured, so nothing to put back — and `restoreAttachments` is still called, because
  // "no attachments" is its own no-op rather than a branch the caller has to remember.
  expect(h.capture.trace).toEqual(['upsertTasks', 'restoreAttachments:'])
})

test('a bulk delete captures every id the undo entry covers, not only the deleted ones', async () => {
  const today = ymd(new Date())
  h.capture.rows = [
    serverRow({ id: 'tpl1', recur_freq: 'daily', day: today, recur_until: today }),
    serverRow({ id: 'i1', recur_parent_id: 'tpl1', recur_origin_day: today, day: today }),
  ]
  h.capture.attachments = [attachment('a1', 'i1')]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => {
    await result.current.bulkDelete(new Set(['i1']))
  })
  // The definition is in the entry because deleting its last Occurrence retires it. Capturing its
  // attachments too costs one predicate and means the entry can never be short of a row it
  // restores; `restoreAttachments` ignores the ones whose Task never left.
  const [ids] = h.captureTaskAttachments.mock.calls[0] as unknown as [string[]]
  expect([...ids].sort()).toEqual(['i1', 'tpl1'])
})

test('an action that deletes nothing captures nothing', async () => {
  h.capture.rows = [serverRow({ id: 't1' })]
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => {
    await result.current.toggleCompletion('t1')
  })
  expect(h.captureTaskAttachments).not.toHaveBeenCalled()

  h.capture.trace = []
  await act(async () => {
    await result.current.undo()
  })
  expect(h.restoreAttachments).toHaveBeenCalledWith([])
})
