import { renderHook, act, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { NO_RECUR, type Task } from '../types/task'
import { addDays, parseDay, ymd } from '../lib/dates'

const h = vi.hoisted(() => {
  const capture: {
    handler: ((p: unknown) => void) | null
    rows: unknown[]
    selectError: { message: string } | null
  } = {
    handler: null,
    rows: [],
    selectError: null,
  }
  const ok = () => Promise.resolve({ data: null, error: null })
  // Stable spies so tests can assert on the rows reload/materialize/updateSeries write.
  const insert = vi.fn(ok)
  const upsert = vi.fn(ok)
  // Stable spy behind `.update(...).eq(...)` so a test can force it to reject (throw),
  // proving a throw takes the same rollback + setError path as a resolved `{ error }`.
  const updateEq = vi.fn(ok)
  // `.delete().eq(...)` is used both as a one-level chain (removeTask, deleteSeriesFuture's
  // whole-series delete) and as a two-level chain (`.eq(...).gt/gte(...)`, updateSeries's
  // truncation-delete / deleteSeriesFuture's instance-delete). Give `.eq(...)`'s return value
  // both a `.then` (so awaiting it directly resolves `{ error }`, for the one-level callers)
  // and spy-able `.gt`/`.gte` legs (so a test can force just that leg to reject).
  const deleteGt = vi.fn(ok)
  const deleteGte = vi.fn(ok)
  const deleteEq = vi.fn(() => Object.assign(ok(), { gt: deleteGt, gte: deleteGte }))
  const channel: Record<string, unknown> = {}
  channel.on = vi.fn((_e: string, _f: unknown, cb: (p: unknown) => void) => {
    capture.handler = cb
    return channel
  })
  channel.subscribe = vi.fn((cb?: (s: string) => void) => {
    cb?.('SUBSCRIBED')
    return channel
  })
  return { capture, ok, insert, upsert, updateEq, deleteEq, deleteGt, deleteGte, channel }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      // `select(...)` is both awaitable and chainable, because the board load is now
      // `.select('*').eq('board_id', …)`. Returning a bare Promise made `.eq` undefined, which
      // failed as an empty board rather than as an error — the loudest possible bug reported in the
      // quietest possible way, so the mock keeps both shapes rather than only the one in use.
      select: vi.fn(() => {
        const result = { data: h.capture.rows, error: h.capture.selectError }
        return {
          eq: vi.fn(() => Promise.resolve(result)),
          then: (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve),
        }
      }),
      insert: h.insert,
      upsert: h.upsert,
      update: vi.fn(() => ({ eq: h.updateEq })),
      delete: vi.fn(() => ({ eq: h.deleteEq })),
    })),
    channel: vi.fn(() => h.channel),
    removeChannel: vi.fn(),
  },
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
  // Board containment, attribution, and the compare-and-swap token. Present on every row since the
  // Board foundation migration; still unread by the app, which is why the mapper ignores them.
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

const appTask = (over: Partial<Task>): Task => ({
  id: 't1',
  title: 'server',
  description: '',
  labelId: null,
  color: 'yellow',
  checklist: [],
  status: 'todo',
  done: false,
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
  h.insert.mockClear()
  h.upsert.mockClear()
  h.updateEq.mockReset()
  h.updateEq.mockImplementation(h.ok)
  h.deleteEq.mockClear()
  h.deleteGt.mockReset()
  h.deleteGt.mockImplementation(h.ok)
  h.deleteGte.mockReset()
  h.deleteGte.mockImplementation(h.ok)
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
  expect(result.current.tasks.find((t) => t.id === 't1')?.done).toBe(false)

  // The write layer rejects instead of resolving `{ error }` (e.g. a network fault).
  h.updateEq.mockRejectedValueOnce(new Error('network down'))

  await act(async () => {
    await result.current.toggleDone('t1')
  })

  // The optimistic toggle must be rolled back...
  expect(result.current.tasks.find((t) => t.id === 't1')?.done).toBe(false)
  // ...and the throw must surface through the same setError path a resolved `{ error }` would.
  expect(result.current.error).toBe('network down')
})

test('a failing excludedDates write on deleteOccurrence still removes the occurrence locally and surfaces the error', async () => {
  const today = ymd(new Date())
  h.capture.rows = [
    serverRow({ id: 'tpl1', recur_freq: 'daily', day: today, recur_until: today }),
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
      v: 5,
      userId: 'u1',
      boardId: 'b1',
      savedAt: 1_770_000_000_000,
      tasks: [{ ...serverTask(), id: 'cached' }],
      templates: [{ ...serverTask(), id: 'tmpl', recurFreq: 'daily', recurParentId: null }],
    }),
  )
  h.capture.selectError = { message: 'FetchError: Failed to fetch' }

  const { result } = renderHook(() => useTasks('u1', 'b1', true))

  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.tasks.map((t) => t.id)).toEqual(['cached'])
  expect(result.current.offline).toBe(true)
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

test('a failed load with no snapshot still surfaces the error', async () => {
  h.capture.selectError = { message: 'FetchError: Failed to fetch' }
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.offline).toBe(false)
  expect(result.current.error).toContain('Failed to fetch')
})

test('a failed load with no snapshot does not poison storage with an empty board', async () => {
  h.capture.selectError = { message: 'FetchError: Failed to fetch' }
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
  await waitFor(() => expect(localStorage.getItem('ma-snapshot-board.b1')).not.toBeNull())
  const snap = readBoardSnapshot('u1', 'b1')
  expect(snap).not.toBeNull()
  expect(snap?.tasks).toHaveLength(1)
  // Proves templatesRef.current is actually threaded into the write call, not just the tasks.
  expect(snap?.templates).toEqual([])
})

test('reconnecting clears offline mode', async () => {
  localStorage.setItem(
    'ma-snapshot-board.b1',
    JSON.stringify({ v: 5, userId: 'u1', boardId: 'b1', savedAt: 1, tasks: [], templates: [] }),
  )
  h.capture.selectError = { message: 'FetchError: Failed to fetch' }
  const { result } = renderHook(() => useTasks('u1', 'b1', true))
  await waitFor(() => expect(result.current.offline).toBe(true))

  h.capture.selectError = null
  h.capture.rows = [serverRow()]
  act(() => {
    window.dispatchEvent(new Event('online'))
  })
  await waitFor(() => expect(result.current.offline).toBe(false))
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
    v: 5,
    userId: 'u1',
    boardId: 'b1',
    savedAt: 1,
    tasks: [{ ...serverTask(), id: 'cached' }],
    templates: [],
  }
  localStorage.setItem('ma-snapshot-board.b1', JSON.stringify(existing))
  h.capture.selectError = { message: 'FetchError: Failed to fetch' }
  const { result } = renderHook(() => useTasks('u1', 'b1', false))
  await waitFor(() => expect(result.current.offline).toBe(true))
  expect(result.current.tasks.map((t) => t.id)).toEqual(['cached'])

  // Network returns, but there is still no session: RLS answers the reload with `[]` and no
  // error rather than an error.
  h.capture.selectError = null
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
