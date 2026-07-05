import { renderHook, act, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { NO_RECUR, type Task } from '../types/task'
import { ymd } from '../lib/dates'

const h = vi.hoisted(() => {
  const capture: { handler: ((p: unknown) => void) | null; rows: unknown[] } = {
    handler: null,
    rows: [],
  }
  const ok = () => Promise.resolve({ data: null, error: null })
  // Stable spies so tests can assert on the rows reload/materialize/updateSeries write.
  const insert = vi.fn(ok)
  const upsert = vi.fn(ok)
  const channel: Record<string, unknown> = {}
  channel.on = vi.fn((_e: string, _f: unknown, cb: (p: unknown) => void) => {
    capture.handler = cb
    return channel
  })
  channel.subscribe = vi.fn((cb?: (s: string) => void) => {
    cb?.('SUBSCRIBED')
    return channel
  })
  return { capture, ok, insert, upsert, channel }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => Promise.resolve({ data: h.capture.rows, error: null })),
      insert: h.insert,
      upsert: h.upsert,
      update: vi.fn(() => ({ eq: vi.fn(h.ok) })),
      delete: vi.fn(() => ({
        eq: vi.fn(h.ok),
        gt: vi.fn(h.ok),
        gte: vi.fn(h.ok),
      })),
    })),
    channel: vi.fn(() => h.channel),
    removeChannel: vi.fn(),
  },
}))

import { useTasks } from './useTasks'

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
  order_index: 0,
  korder: 0,
  recur_freq: 'none',
  recur_interval: 1,
  recur_until: null,
  recur_parent_id: null,
  recur_skip: [],
  recur_origin_day: null,
  created_at: '',
  updated_at: '',
  ...over,
})

const appTask = (over: Partial<Task>): Task => ({
  id: 't1',
  title: 'server',
  description: '',
  category: 'work',
  color: 'yellow',
  checklist: [],
  status: 'todo',
  done: false,
  day: '2026-07-01',
  order: 0,
  korder: 0,
  ...NO_RECUR,
  ...over,
})

beforeEach(() => {
  h.capture.handler = null
  h.capture.rows = [serverRow()]
  h.insert.mockClear()
  h.upsert.mockClear()
})

test('a stale echo of our own write does not clobber optimistic state', async () => {
  const { result } = renderHook(() => useTasks('u1'))
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
  const { result } = renderHook(() => useTasks('u1'))
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
  const { result } = renderHook(() => useTasks('u1'))
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
  const { result } = renderHook(() => useTasks('u1'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  // The lone occurrence is already covered by i1, so materialize must insert nothing. The bug:
  // reload read a stale (empty) board and re-inserted i1, hitting tasks_recur_instance_uniq.
  expect(h.insert).not.toHaveBeenCalled()
  expect(result.current.tasks.map((t) => t.id)).toEqual(['i1'])
})

test('updateSeries "this and future" persists the edited content to existing instances', async () => {
  const today = ymd(new Date())
  h.capture.rows = [
    serverRow({ id: 'tpl1', recur_freq: 'daily', day: today, title: 'old' }),
    serverRow({
      id: 'i1',
      recur_parent_id: 'tpl1',
      recur_origin_day: today,
      day: today,
      title: 'old',
    }),
  ]
  const { result } = renderHook(() => useTasks('u1'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  h.upsert.mockClear()

  const instance = result.current.tasks.find((t) => t.id === 'i1')!
  await act(async () => {
    await result.current.updateSeries(instance, {
      ...instance,
      title: 'new',
      recurFreq: 'daily',
      recurInterval: 1,
      recurUntil: null,
    })
  })

  // The instance row written to the DB must carry the edited title. The bug built these rows from
  // tasksRef.current right after setTasks, so the deferred ref still held the pre-edit 'old' title.
  const call = h.upsert.mock.calls[0] as unknown as unknown[]
  const rows = call[0] as { id: string; title: string }[]
  expect(rows.find((r) => r.id === 'i1')?.title).toBe('new')
})
