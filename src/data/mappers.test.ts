import { describe, it, expect } from 'vitest'
import { rowToTask, taskToRow, parseChecklist } from './mappers'
import { NO_RECUR, type Task } from '../types/task'
import type { Database } from '../types/database.types'

type TaskRow = Database['public']['Tables']['tasks']['Row']

function row(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'r1',
    title: 'T',
    description: 'D',
    category: 'work',
    label_assignment_explicit: false,
    user_id: 'u1',
    color: 'yellow',
    checklist: [],
    status: 'todo',
    day: null,
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
    // Board containment, Label compatibility, attribution, and the compare-and-swap token.
    board_id: 'b1',
    label_id: null,
    author_id: null,
    last_editor_id: null,
    author_kind: 'author',
    revision: 1,
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
    labelId: null,
    color: 'yellow',
    checklist: [],
    status: 'todo',
    done: false,
    day: 'inbox',
    atTime: null,
    pinned: false,
    order: 0,
    korder: 0,
    ...NO_RECUR,
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
  it('maps recur_origin_day -> recurOriginDay (null for non-instances)', () => {
    expect(rowToTask(row({ recur_origin_day: '2026-07-01' })).recurOriginDay).toBe('2026-07-01')
    expect(rowToTask(row({ recur_origin_day: null })).recurOriginDay).toBeNull()
  })
  it('maps the optional label relationship without exposing legacy Category', () => {
    const labeled = rowToTask(row({ label_id: 'label-1', category: 'personal' }))
    expect(labeled.labelId).toBe('label-1')
    expect('category' in labeled).toBe(false)

    expect(rowToTask(row({ label_id: null })).labelId).toBeNull()
  })
})

describe('taskToRow', () => {
  it('maps the inbox sentinel to a NULL day', () => {
    expect(taskToRow(task({ day: 'inbox' }), 'b1').day).toBeNull()
  })
  it('maps a real date through and stamps no owner column', () => {
    const r = taskToRow(task({ day: '2026-07-01' }), 'b1')
    expect(r.day).toBe('2026-07-01')
    // `board_id` is the only ownership column written now. `user_id` came out one release after
    // `category` and `label_assignment_explicit`, because it alone was NOT NULL with no default —
    // see `taskToRow`.
    expect('user_id' in r).toBe(false)
  })
  it('maps order -> order_index and never stores the derived done flag', () => {
    const r = taskToRow(task({ order: 7, korder: 2, status: 'done', done: true }), 'b1')
    expect(r.order_index).toBe(7)
    expect(r.korder).toBe(2)
    expect(r.status).toBe('done')
    expect('done' in r).toBe(false)
  })
  it('maps recurOriginDay -> recur_origin_day', () => {
    expect(taskToRow(task({ recurOriginDay: '2026-07-01' }), 'b1').recur_origin_day).toBe(
      '2026-07-01',
    )
    expect(taskToRow(task({ recurOriginDay: null }), 'b1').recur_origin_day).toBeNull()
  })
  it('writes an explicit nullable label assignment without writing legacy Category', () => {
    const labeled = taskToRow(task({ labelId: 'label-1' }), 'b1')
    expect(labeled.label_id).toBe('label-1')
    // The explicit-assignment marker went with the Category bridge that read it — see the
    // migration: leaving it while dropping the trigger, or vice versa, silently labels every
    // Unlabeled Task 'Work'.
    expect('label_assignment_explicit' in labeled).toBe(false)
    expect('category' in labeled).toBe(false)

    const unlabeled = taskToRow(task({ labelId: null }), 'b1')
    expect(unlabeled.label_id).toBeNull()
    expect('label_assignment_explicit' in unlabeled).toBe(false)
  })
})

describe('at_time', () => {
  it('round-trips and normalizes the seconds Postgres appends', () => {
    // Postgres `time` comes back as 'HH:MM:SS'; the app keeps 'HH:MM'.
    const withSeconds = rowToTask(row({ at_time: '14:30:00' }))
    expect(withSeconds.atTime).toBe('14:30')
    expect(taskToRow(withSeconds, 'b1').at_time).toBe('14:30')

    const allDay = rowToTask(row({ at_time: null }))
    expect(allDay.atTime).toBeNull()
    expect(taskToRow(allDay, 'b1').at_time).toBeNull()
  })
  it('treats a missing at_time column (pre-migration deploy window) as all-day', () => {
    const predeploy = rowToTask(row({ at_time: undefined as unknown as string }))
    expect(predeploy.atTime).toBeNull()
  })
})

describe('pinned', () => {
  it('round-trips and defaults false when the column is absent', () => {
    const baseRow = row()
    const pinnedRow = rowToTask({ ...baseRow, pinned: true })
    expect(pinnedRow.pinned).toBe(true)
    expect(taskToRow(pinnedRow, 'b1').pinned).toBe(true)
    // Deploy-window tolerance: a row read before the migration applied has no field.
    const legacy = rowToTask({ ...baseRow, pinned: undefined as unknown as boolean })
    expect(legacy.pinned).toBe(false)
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
    const r = taskToRow(original, 'b1')
    const back = rowToTask(row({ ...r, day: r.day ?? null }))
    expect(back.day).toBe('2026-07-02')
    expect(back.order).toBe(3)
    expect(back.korder).toBe(1)
    expect(back.status).toBe('doing')
    expect(back.checklist).toEqual([{ id: 'c1', text: 'x', done: true }])
  })
})
