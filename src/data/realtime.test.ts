import { expect, test } from 'vitest'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { NO_RECUR, type Task } from '../types/task'
import type { Database } from '../types/database.types'
import { applyTaskChange, payloadToChange, type BoardState } from './realtime'

type TaskRow = Database['public']['Tables']['tasks']['Row']

const base: Task = {
  id: 't1',
  title: 'A',
  description: '',
  category: 'work',
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
}
const mk = (over: Partial<Task>): Task => ({ ...base, ...over })

const row = (over: Partial<TaskRow> = {}): TaskRow =>
  ({
    id: 't1',
    user_id: 'u1',
    title: 'A',
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
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...over,
  }) as TaskRow

const state = (tasks: Task[] = [], templates: Task[] = []): BoardState => ({ tasks, templates })

// ---- payloadToChange ----

test('maps INSERT and UPDATE payloads through rowToTask', () => {
  const p = { eventType: 'INSERT', new: row({ title: 'X', day: null }), old: {} }
  const change = payloadToChange(p as unknown as RealtimePostgresChangesPayload<TaskRow>)
  expect(change).toMatchObject({ type: 'INSERT', task: { title: 'X', day: 'inbox' } })
})

test('maps DELETE payloads to the old id, or null when the id is missing', () => {
  const del = { eventType: 'DELETE', new: {}, old: { id: 't9' } }
  expect(payloadToChange(del as unknown as RealtimePostgresChangesPayload<TaskRow>)).toEqual({
    type: 'DELETE',
    id: 't9',
  })
  const bad = { eventType: 'DELETE', new: {}, old: {} }
  expect(payloadToChange(bad as unknown as RealtimePostgresChangesPayload<TaskRow>)).toBeNull()
})

// ---- applyTaskChange: plain tasks ----

test('INSERT appends a new task', () => {
  const next = applyTaskChange(state([mk({ id: 't1' })]), {
    type: 'INSERT',
    task: mk({ id: 't2', title: 'B' }),
  })
  expect(next.tasks.map((t) => t.id)).toEqual(['t1', 't2'])
})

test('UPDATE replaces the matching task', () => {
  const next = applyTaskChange(state([mk({ id: 't1', title: 'old' })]), {
    type: 'UPDATE',
    task: mk({ id: 't1', title: 'new' }),
  })
  expect(next.tasks[0].title).toBe('new')
})

test('UPDATE for an unknown id inserts it (missed event tolerance)', () => {
  const next = applyTaskChange(state([]), { type: 'UPDATE', task: mk({ id: 't1' }) })
  expect(next.tasks).toHaveLength(1)
})

test('a no-op UPDATE returns the same state object', () => {
  const s = state([mk({ id: 't1' })])
  expect(applyTaskChange(s, { type: 'UPDATE', task: mk({ id: 't1' }) })).toBe(s)
})

test('DELETE removes the task; unknown ids are a referential no-op', () => {
  const s = state([mk({ id: 't1' })])
  expect(applyTaskChange(s, { type: 'DELETE', id: 't1' }).tasks).toHaveLength(0)
  expect(applyTaskChange(s, { type: 'DELETE', id: 'nope' })).toBe(s)
})

// ---- applyTaskChange: templates ----

const template = mk({ id: 'tpl1', recurFreq: 'daily', recurParentId: null })

test('template INSERT/UPDATE goes to templates, never the board', () => {
  const next = applyTaskChange(state([], []), { type: 'INSERT', task: template })
  expect(next.templates.map((t) => t.id)).toEqual(['tpl1'])
  expect(next.tasks).toHaveLength(0)
})

test('a template update leaves the board tasks array untouched (same reference)', () => {
  const s = state([mk({ id: 't1' })], [template])
  const next = applyTaskChange(s, {
    type: 'UPDATE',
    task: { ...template, title: 'renamed' },
  })
  expect(next.templates[0].title).toBe('renamed')
  expect(next.tasks).toBe(s.tasks)
})

test('a task promoted to a template moves out of the board list', () => {
  const s = state([mk({ id: 't1' })], [])
  const next = applyTaskChange(s, {
    type: 'UPDATE',
    task: mk({ id: 't1', recurFreq: 'weekly' }),
  })
  expect(next.tasks).toHaveLength(0)
  expect(next.templates.map((t) => t.id)).toEqual(['t1'])
})

test('a template demoted to a plain task moves back to the board', () => {
  const s = state([], [template])
  const next = applyTaskChange(s, {
    type: 'UPDATE',
    task: mk({ id: 'tpl1', recurFreq: 'none' }),
  })
  expect(next.templates).toHaveLength(0)
  expect(next.tasks.map((t) => t.id)).toEqual(['tpl1'])
})

test('deleting a template drops it and all of its local instances', () => {
  const inst = mk({ id: 'i1', recurParentId: 'tpl1', recurOriginDay: '2026-07-02' })
  const next = applyTaskChange(state([inst, mk({ id: 't1' })], [template]), {
    type: 'DELETE',
    id: 'tpl1',
  })
  expect(next.templates).toHaveLength(0)
  expect(next.tasks.map((t) => t.id)).toEqual(['t1'])
})

test('a template UPDATE with unchanged content returns the same state object', () => {
  const s = state([], [template])
  expect(applyTaskChange(s, { type: 'UPDATE', task: { ...template } })).toBe(s)
})

test('INSERT/UPDATE payloads with a missing or malformed row map to null', () => {
  const noRow = { eventType: 'INSERT', new: null, old: {} }
  expect(payloadToChange(noRow as unknown as RealtimePostgresChangesPayload<TaskRow>)).toBeNull()
  const noId = { eventType: 'UPDATE', new: { title: 'partial' }, old: {} }
  expect(payloadToChange(noId as unknown as RealtimePostgresChangesPayload<TaskRow>)).toBeNull()
})

// ---- applyTaskChange: instance dedupe ----

test('an instance INSERT for an occurrence we already cover replaces the local twin', () => {
  const local = mk({ id: 'local', recurParentId: 'tpl1', recurOriginDay: '2026-07-02' })
  const remote = mk({ id: 'remote', recurParentId: 'tpl1', recurOriginDay: '2026-07-02' })
  const next = applyTaskChange(state([local]), { type: 'INSERT', task: remote })
  expect(next.tasks.map((t) => t.id)).toEqual(['remote'])
})
