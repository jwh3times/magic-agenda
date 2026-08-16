import { describe, it, expect } from 'vitest'
import {
  changedTaskKeys,
  cleanDraft,
  intendDelete,
  intendSave,
  onlyPerOccurrenceChanged,
} from './editIntent'
import { NO_RECUR, type Task } from '../types/task'

function t(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: '',
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

const instance = (over: Partial<Task> = {}) =>
  t('i1', { recurParentId: 'tmpl', recurOriginDay: '2026-07-08', day: '2026-07-08', ...over })

describe('changedTaskKeys', () => {
  it('reports only the fields that actually differ', () => {
    const a = t('x', { title: 'A', pinned: false })
    expect(changedTaskKeys(a, { ...a })).toEqual([])
    expect(changedTaskKeys(a, { ...a, title: 'B' })).toEqual(['title'])
  })

  it('ignores `done`, which is derived from status', () => {
    // Comparing it separately would double-count every status change.
    const a = t('x', { status: 'todo', done: false })
    expect(changedTaskKeys(a, { ...a, status: 'done', done: true })).toEqual(['status'])
  })

  it('compares the checklist by content, not by reference', () => {
    // cleanDraft always remaps checklist into a fresh array, so reference equality never holds.
    const a = t('x', { checklist: [{ id: 'c1', text: 'one', done: false }] })
    const same = { ...a, checklist: [{ id: 'c1', text: 'one', done: false }] }
    expect(changedTaskKeys(a, same)).toEqual([])
    const edited = { ...a, checklist: [{ id: 'c1', text: 'two', done: false }] }
    expect(changedTaskKeys(a, edited)).toEqual(['checklist'])
  })

  it('fails safe when checklist key order drifts', () => {
    // The JSON.stringify comparison assumes a consistent ChecklistItem key order. This is the
    // property the old comment claimed and no test could assert, because the function was private:
    // drifting key order must OVER-report a change (over-show the scope prompt), never suppress
    // one that was needed.
    const a = t('x', { checklist: [{ id: 'c1', text: 'one', done: false }] })
    const reordered = {
      ...a,
      checklist: [{ done: false, text: 'one', id: 'c1' } as Task['checklist'][number]],
    }
    expect(changedTaskKeys(a, reordered)).toEqual(['checklist'])
  })
})

describe('onlyPerOccurrenceChanged', () => {
  it('is true for pin and status edits', () => {
    const a = instance()
    expect(onlyPerOccurrenceChanged(a, { ...a, pinned: true })).toBe(true)
    expect(onlyPerOccurrenceChanged(a, { ...a, status: 'doing' })).toBe(true)
    expect(onlyPerOccurrenceChanged(a, { ...a, status: 'done', done: true })).toBe(true)
  })

  it('is false as soon as any series content changes', () => {
    const a = instance()
    for (const change of [
      { title: 'New' },
      { description: 'd' },
      { labelId: 'label-2' },
      { atTime: '09:00' },
      { checklist: [{ id: 'c', text: 'x', done: false }] },
    ]) {
      expect(onlyPerOccurrenceChanged(a, { ...a, ...change })).toBe(false)
    }
  })

  it('is true for no change at all', () => {
    const a = instance()
    expect(onlyPerOccurrenceChanged(a, { ...a })).toBe(true)
  })
})

describe('cleanDraft', () => {
  it('trims the title and derives done from status', () => {
    const cleaned = cleanDraft(t('x', { title: '  spaced  ', status: 'done', done: false }))
    expect(cleaned.title).toBe('spaced')
    expect(cleaned.done).toBe(true)
  })

  it('normalizes an unscheduled day to the inbox sentinel', () => {
    expect(cleanDraft(t('x', { day: '' })).day).toBe('inbox')
    expect(cleanDraft(t('x', { day: '2026-07-01' })).day).toBe('2026-07-01')
  })

  it('remaps the checklist into fresh objects with a fixed key order', () => {
    const draft = t('x', { checklist: [{ id: 'c1', text: 'one', done: true }] })
    const cleaned = cleanDraft(draft)
    expect(cleaned.checklist).toEqual([{ id: 'c1', text: 'one', done: true }])
    expect(cleaned.checklist).not.toBe(draft.checklist)
    expect(Object.keys(cleaned.checklist[0])).toEqual(['id', 'text', 'done'])
  })
})

describe('intendSave', () => {
  it('blocks on an empty or whitespace-only title', () => {
    expect(intendSave(t('x'), t('x', { title: '' }), false)).toEqual({ kind: 'blocked' })
    expect(intendSave(t('x'), t('x', { title: '   ' }), false)).toEqual({ kind: 'blocked' })
  })

  it('saves a new task with no scope', () => {
    const intent = intendSave(t('x'), t('x', { title: 'New' }), true)
    if (intent.kind !== 'save') throw new Error('unreachable')
    expect(intent.scope).toBeUndefined() // scope is meaningless for a task with no series
  })

  it('saves a plain task with no scope', () => {
    const intent = intendSave(t('x'), t('x', { title: 'Edited' }), false)
    if (intent.kind !== 'save') throw new Error('unreachable')
    expect(intent.scope).toBeUndefined()
  })

  it('saves a pin-only edit to an instance straight through, as "this"', () => {
    // No series content changed, so there is nothing to ask about — and the scope is definite
    // rather than undefined, which is the ambiguity Board used to have to resolve.
    const a = instance()
    const intent = intendSave(a, { ...a, pinned: true }, false)
    expect(intent).toMatchObject({ kind: 'save', scope: 'this' })
  })

  it('asks when series content on an instance changed', () => {
    const a = instance()
    expect(intendSave(a, { ...a, title: 'Renamed' }, false)).toEqual({ kind: 'ask' })
  })

  it('returns the cleaned task, not the raw draft', () => {
    const intent = intendSave(t('x'), t('x', { title: '  Trimmed  ', status: 'done' }), true)
    if (intent.kind !== 'save') throw new Error('unreachable')
    expect(intent.task.title).toBe('Trimmed')
    expect(intent.task.done).toBe(true)
  })

  it('never emits an undefined scope for an instance', () => {
    // The whole point of resolving the ambiguity here: for an instance the answer is always
    // 'this', or the caller is told to ask.
    const a = instance()
    for (const draft of [{ ...a }, { ...a, pinned: true }, { ...a, status: 'done' as const }]) {
      const intent = intendSave(a, draft, false)
      if (intent.kind === 'save') expect(intent.scope).toBe('this')
      else expect(intent.kind).toBe('ask')
    }
  })
})

describe('intendDelete', () => {
  it('asks for a recurring instance', () => {
    expect(intendDelete(instance(), false)).toEqual({ kind: 'ask' })
  })

  it('deletes a plain task and a brand-new one directly', () => {
    expect(intendDelete(t('x'), false)).toEqual({ kind: 'delete', id: 'x' })
    expect(intendDelete(instance(), true)).toEqual({ kind: 'delete', id: 'i1' })
  })

  it('emits only an id, so unsaved edits cannot reach the delete', () => {
    // This is how #132 was resolved: not by choosing between the draft and the original, but by
    // making the choice impossible. Nothing but the id crosses the seam, and the data layer looks
    // the row up in its own state — so no field added to the delete path later can silently start
    // depending on edits the user never saved.
    const intent = intendDelete(t('x', { title: 'Original', day: '2026-07-01' }), false)
    expect(intent).toEqual({ kind: 'delete', id: 'x' })
    expect(Object.keys(intent)).toEqual(['kind', 'id'])
  })
})
