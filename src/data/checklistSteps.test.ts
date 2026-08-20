import { describe, it, expect } from 'vitest'
import { reconcileSteps } from './checklistSteps'
import type { ChecklistItem } from '../types/task'

const s = (id: string, text: string, done = false): ChecklistItem => ({ id, text, done })
const shape = (list: ChecklistItem[]) => list.map((x) => [x.id, x.text, x.done])

describe('reconcileSteps — identity matching', () => {
  it('keeps a tick on a Step that was renamed', () => {
    const series = [s('a', 'Buy oat milk')]
    const occurrence = [s('a', 'Buy milk', true)]
    expect(shape(reconcileSteps(series, occurrence))).toEqual([['a', 'Buy oat milk', true]])
  })

  it('drops the tick of a Step that was removed', () => {
    const series = [s('a', 'One')]
    const occurrence = [s('a', 'One', false), s('b', 'Two', true)]
    expect(shape(reconcileSteps(series, occurrence))).toEqual([['a', 'One', false]])
  })

  it('adds a new Step unticked', () => {
    const series = [s('a', 'One'), s('new', 'Three')]
    const occurrence = [s('a', 'One', true)]
    expect(shape(reconcileSteps(series, occurrence))).toEqual([
      ['a', 'One', true],
      ['new', 'Three', false],
    ])
  })

  it('preserves every tick when Steps are reordered', () => {
    // The case that rules out position matching: identity follows the Step, not the slot.
    const series = [s('c', 'Third'), s('a', 'First'), s('b', 'Second')]
    const occurrence = [s('a', 'First', true), s('b', 'Second', false), s('c', 'Third', true)]
    expect(shape(reconcileSteps(series, occurrence))).toEqual([
      ['c', 'Third', true],
      ['a', 'First', true],
      ['b', 'Second', false],
    ])
  })

  it('does not shift ticks when a Step is inserted at the top', () => {
    const series = [s('new', 'Zeroth'), s('a', 'First'), s('b', 'Second')]
    const occurrence = [s('a', 'First', true), s('b', 'Second', false)]
    expect(shape(reconcileSteps(series, occurrence))).toEqual([
      ['new', 'Zeroth', false],
      ['a', 'First', true],
      ['b', 'Second', false],
    ])
  })

  it('takes the Series Step order and text verbatim', () => {
    const out = reconcileSteps([s('a', 'Canonical')], [s('a', 'stale text', true)])
    expect(out).toEqual([{ id: 'a', text: 'Canonical', done: true }])
  })
})

describe('reconcileSteps — text fallback for pre-stable-id Occurrences', () => {
  it('recovers ticks when the Occurrence carries unrelated ids but the same text', () => {
    // How every Occurrence materialized before #214 looks: same text, freshly minted ids.
    const series = [s('a', 'One'), s('b', 'Two')]
    const occurrence = [s('x1', 'One', true), s('x2', 'Two', false)]
    expect(shape(reconcileSteps(series, occurrence))).toEqual([
      ['a', 'One', true],
      ['b', 'Two', false],
    ])
  })

  it('an id match always beats a text match', () => {
    // The crux. Step 'a' is renamed from "One" to "Two" in this very edit, while a *different*
    // legacy Step still carries the words "Two". Identity must win, or the rename would steal a
    // tick that belongs to the other Step.
    const series = [s('a', 'Two')]
    const occurrence = [s('a', 'One', false), s('x9', 'Two', true)]
    expect(shape(reconcileSteps(series, occurrence))).toEqual([['a', 'Two', false]])
  })

  it('consumes each leftover Step at most once', () => {
    const series = [s('a', 'Repeat'), s('b', 'Repeat')]
    const occurrence = [s('x1', 'Repeat', true), s('x2', 'Repeat', false)]
    expect(shape(reconcileSteps(series, occurrence))).toEqual([
      ['a', 'Repeat', true],
      ['b', 'Repeat', false],
    ])
  })

  it('leaves a Step unticked when nothing matches by id or text', () => {
    expect(shape(reconcileSteps([s('a', 'New')], [s('x1', 'Old', true)]))).toEqual([
      ['a', 'New', false],
    ])
  })
})

describe('reconcileSteps — edges', () => {
  it('is empty when the Series has no Steps', () => {
    expect(reconcileSteps([], [s('a', 'One', true)])).toEqual([])
  })

  it('is all-unticked when the Occurrence has none', () => {
    expect(shape(reconcileSteps([s('a', 'One')], []))).toEqual([['a', 'One', false]])
  })

  it('does not mutate either input', () => {
    const series = [s('a', 'One')]
    const occurrence = [s('a', 'One', true)]
    reconcileSteps(series, occurrence)
    expect(series).toEqual([{ id: 'a', text: 'One', done: false }])
    expect(occurrence).toEqual([{ id: 'a', text: 'One', done: true }])
  })
})
