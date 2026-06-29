import { describe, it, expect } from 'vitest'
import { rowToTask, taskToRow, parseChecklist } from './mappers'
import type { Task } from '../types/task'
import type { Database } from '../types/database.types'

type TaskRow = Database['public']['Tables']['tasks']['Row']

function row(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'r1',
    user_id: 'u1',
    title: 'T',
    description: 'D',
    category: 'work',
    color: 'yellow',
    checklist: [],
    status: 'todo',
    day: null,
    order_index: 0,
    korder: 0,
    recur_freq: 'none',
    recur_interval: 1,
    recur_until: null,
    recur_parent_id: null,
    created_at: '2026-06-29T00:00:00Z',
    updated_at: '2026-06-29T00:00:00Z',
    ...over,
  }
}

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'T',
    description: 'D',
    category: 'work',
    color: 'yellow',
    checklist: [],
    status: 'todo',
    done: false,
    day: 'inbox',
    order: 0,
    korder: 0,
    ...over,
  }
}

describe('parseChecklist', () => {
  it('passes valid items through', () => {
    expect(parseChecklist([{ id: 'c1', text: 'a', done: true }])).toEqual([
      { id: 'c1', text: 'a', done: true },
    ])
  })
  it('coerces missing done to false and drops malformed entries', () => {
    expect(parseChecklist('nope')).toEqual([])
    expect(parseChecklist([{ id: 'c1', text: 'a' }, null, 42])).toEqual([
      { id: 'c1', text: 'a', done: false },
    ])
  })
})

describe('rowToTask', () => {
  it('maps a NULL day to the inbox sentinel', () => {
    expect(rowToTask(row({ day: null })).day).toBe('inbox')
  })
  it('passes a real date through', () => {
    expect(rowToTask(row({ day: '2026-07-01' })).day).toBe('2026-07-01')
  })
  it('derives done from status', () => {
    expect(rowToTask(row({ status: 'done' })).done).toBe(true)
    expect(rowToTask(row({ status: 'todo' })).done).toBe(false)
  })
  it('maps order_index -> order and keeps korder', () => {
    const t = rowToTask(row({ order_index: 5, korder: 3 }))
    expect(t.order).toBe(5)
    expect(t.korder).toBe(3)
  })
})

describe('taskToRow', () => {
  it('maps the inbox sentinel to a NULL day', () => {
    expect(taskToRow(task({ day: 'inbox' }), 'u1').day).toBeNull()
  })
  it('maps a real date through and stamps user_id', () => {
    const r = taskToRow(task({ day: '2026-07-01' }), 'u9')
    expect(r.day).toBe('2026-07-01')
    expect(r.user_id).toBe('u9')
  })
  it('maps order -> order_index and never stores the derived done flag', () => {
    const r = taskToRow(task({ order: 7, korder: 2, status: 'done', done: true }), 'u1')
    expect(r.order_index).toBe(7)
    expect(r.korder).toBe(2)
    expect(r.status).toBe('done')
    expect('done' in r).toBe(false)
  })
})

describe('round trip', () => {
  it('preserves core fields app -> row -> app', () => {
    const original = task({
      day: '2026-07-02',
      order: 3,
      korder: 1,
      status: 'doing',
      title: 'Hi',
      checklist: [{ id: 'c1', text: 'x', done: true }],
    })
    const r = taskToRow(original, 'u1')
    const back = rowToTask(row({ ...r, day: r.day ?? null }))
    expect(back.day).toBe('2026-07-02')
    expect(back.order).toBe(3)
    expect(back.korder).toBe(1)
    expect(back.status).toBe('doing')
    expect(back.checklist).toEqual([{ id: 'c1', text: 'x', done: true }])
  })
})
