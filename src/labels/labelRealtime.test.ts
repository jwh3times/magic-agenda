import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { describe, expect, test } from 'vitest'
import type { Database } from '../types/database.types'
import { fakeLabel } from './fakeLabelDirectory'
import { applyLabelChange, payloadToLabelChange, type LabelChange } from './labelRealtime'

type LabelRow = Database['public']['Tables']['labels']['Row']

const row = (over: Partial<LabelRow> = {}): LabelRow => ({
  id: 'l1',
  board_id: 'b1',
  name: 'Work',
  dot_color: '#2563eb',
  position: 0,
  created_at: '2026-08-18T00:00:00Z',
  updated_at: '2026-08-18T00:00:00Z',
  ...over,
})

const payload = (
  over: Partial<RealtimePostgresChangesPayload<LabelRow>>,
): RealtimePostgresChangesPayload<LabelRow> =>
  ({
    eventType: 'INSERT',
    new: row(),
    old: {},
    ...over,
  }) as RealtimePostgresChangesPayload<LabelRow>

const vocabulary = [
  fakeLabel({ id: 'a', name: 'Work', position: 0 }),
  fakeLabel({ id: 'b', name: 'Personal', position: 1 }),
  fakeLabel({ id: 'c', name: 'Errands', position: 2 }),
]

describe('payloadToLabelChange', () => {
  test('an INSERT becomes an upsert carrying the mapped Label', () => {
    const change = payloadToLabelChange(payload({ eventType: 'INSERT', new: row({ id: 'new' }) }))
    expect(change).toEqual({
      type: 'UPSERT',
      label: { id: 'new', boardId: 'b1', name: 'Work', dotColor: '#2563eb', position: 0 },
    })
  })

  test('an UPDATE collapses into the same upsert case', () => {
    const change = payloadToLabelChange(
      payload({ eventType: 'UPDATE', new: row({ name: 'Renamed' }) }),
    )
    expect(change?.type).toBe('UPSERT')
    expect(change).toMatchObject({ label: { id: 'l1', name: 'Renamed' } })
  })

  test('a DELETE carries only the primary key, so it yields an id', () => {
    // Replica identity is DEFAULT, so `new` is empty and `old` holds the key alone. Reading `new`
    // here would silently drop every delete.
    const change = payloadToLabelChange(
      payload({ eventType: 'DELETE', new: {}, old: { id: 'gone' } }),
    )
    expect(change).toEqual({ type: 'DELETE', id: 'gone' })
  })

  test('an unusable payload is null rather than a half-built Label', () => {
    expect(payloadToLabelChange(payload({ eventType: 'DELETE', old: {} }))).toBeNull()
    expect(payloadToLabelChange(payload({ eventType: 'INSERT', new: {} as never }))).toBeNull()
    expect(
      payloadToLabelChange(payload({ eventType: 'INSERT', new: { id: 'x' } as never })),
    ).toBeNull()
  })
})

describe('applyLabelChange', () => {
  test('an unknown upsert lands in position order, not arrival order', () => {
    // What a real remote create looks like: another client appended, so it arrives past the end.
    const appended: LabelChange = {
      type: 'UPSERT',
      label: fakeLabel({ id: 'new', name: 'Appended', position: 3 }),
    }
    expect(applyLabelChange(vocabulary, appended).map((l) => l.id)).toEqual(['a', 'b', 'c', 'new'])

    // And one that genuinely belongs before the end goes there rather than at the tail.
    const early: LabelChange = {
      type: 'UPSERT',
      label: fakeLabel({ id: 'early', name: 'Early', position: -1 }),
    }
    expect(applyLabelChange(vocabulary, early).map((l) => l.id)).toEqual(['early', 'a', 'b', 'c'])
  })

  test('an upsert that ties an existing position breaks by id, deterministically', () => {
    // Positions are not unique, so two rows can legitimately tie mid-reorder. Which one wins is
    // arbitrary; that it is *stable* is what stops the list flickering as the rest of the batch
    // lands. 'b' precedes 'mid' by id.
    const tied: LabelChange = {
      type: 'UPSERT',
      label: fakeLabel({ id: 'mid', name: 'Tied', position: 1 }),
    }
    expect(applyLabelChange(vocabulary, tied).map((l) => l.id)).toEqual(['a', 'b', 'mid', 'c'])
  })

  test('a known upsert replaces rather than duplicating', () => {
    const change: LabelChange = {
      type: 'UPSERT',
      label: fakeLabel({ id: 'b', name: 'Renamed', position: 1 }),
    }
    const next = applyLabelChange(vocabulary, change)
    expect(next).toHaveLength(3)
    expect(next.find((l) => l.id === 'b')?.name).toBe('Renamed')
  })

  test('applying the same upsert twice is idempotent, which a reconnect replay depends on', () => {
    const change: LabelChange = {
      type: 'UPSERT',
      label: fakeLabel({ id: 'b', name: 'Renamed', position: 1 }),
    }
    const once = applyLabelChange(vocabulary, change)
    expect(applyLabelChange(once, change)).toEqual(once)
  })

  test('a remote reorder arriving as separate updates still lands in position order', () => {
    // The realistic shape: one UPDATE per moved row, in whatever order the socket delivers them.
    const moved = applyLabelChange(
      applyLabelChange(vocabulary, {
        type: 'UPSERT',
        label: fakeLabel({ id: 'c', name: 'Errands', position: 0 }),
      }),
      { type: 'UPSERT', label: fakeLabel({ id: 'a', name: 'Work', position: 2 }) },
    )
    expect(moved.map((l) => l.id)).toEqual(['c', 'b', 'a'])
  })

  test('a transient duplicate position still orders stably rather than flickering', () => {
    // Nothing constrains (board_id, position) to be unique, so a half-applied reorder is legal.
    const next = applyLabelChange(vocabulary, {
      type: 'UPSERT',
      label: fakeLabel({ id: 'c', name: 'Errands', position: 0 }),
    })
    expect(next.map((l) => l.id)).toEqual(['a', 'c', 'b'])
  })

  test('a delete removes exactly one Label', () => {
    expect(applyLabelChange(vocabulary, { type: 'DELETE', id: 'b' }).map((l) => l.id)).toEqual([
      'a',
      'c',
    ])
  })

  test('deleting an unknown id is a no-op, which is what an already-applied delete looks like', () => {
    expect(applyLabelChange(vocabulary, { type: 'DELETE', id: 'nope' })).toEqual(vocabulary)
  })

  test('does not mutate the input', () => {
    const before = vocabulary.map((l) => ({ ...l }))
    applyLabelChange(vocabulary, { type: 'DELETE', id: 'a' })
    applyLabelChange(vocabulary, { type: 'UPSERT', label: fakeLabel({ id: 'z', position: 9 }) })
    expect(vocabulary).toEqual(before)
  })
})
