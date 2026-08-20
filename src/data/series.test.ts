import { describe, it, expect } from 'vitest'
import {
  instanceKey,
  makeInstance,
  pendingInstances,
  planDeleteOccurrence,
  planDeleteSeriesFrom,
  planEditSeriesFrom,
  planPromoteToSeries,
  resolveDelete,
  resolveSave,
} from './series'
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

/** A weekly template anchored on 2026-07-01, and instances for the first three occurrences. */
function series() {
  const tmpl = t('tmpl', {
    day: '2026-07-01',
    recurFreq: 'weekly',
    recurInterval: 1,
    title: 'Standup',
  })
  const inst = (id: string, day: string) =>
    t(id, { day, recurParentId: 'tmpl', occurrenceDate: day, title: 'Standup' })
  return {
    templates: [tmpl],
    tasks: [inst('i1', '2026-07-01'), inst('i2', '2026-07-08'), inst('i3', '2026-07-15')],
  }
}

const ids = (tasks: readonly Task[]) => tasks.map((x) => x.id)
let counter = 0
const nextId = () => `gen-${++counter}`

// ——— identity ———

describe('instanceKey', () => {
  it('identifies the occurrence covered, not the day the card sits on', () => {
    // Mirrors the (recur_parent_id, recur_origin_day) unique index. Dragging an instance must not
    // make its original occurrence look unfilled — that regenerates a duplicate and hits 23505.
    const moved = t('i1', { day: '2026-07-04', recurParentId: 'p', occurrenceDate: '2026-07-01' })
    expect(instanceKey(moved)).toBe('p|2026-07-01')
  })

  it('falls back to the day for legacy instances with no recorded origin', () => {
    expect(instanceKey(t('i1', { day: '2026-07-01', recurParentId: 'p' }))).toBe('p|2026-07-01')
  })
})

describe('makeInstance', () => {
  it('copies series content but never the rule, and stamps the origin', () => {
    const tmpl = t('tmpl', {
      day: '2026-07-01',
      recurFreq: 'weekly',
      recurInterval: 2,
      recurUntil: '2026-12-31',
      title: 'Standup',
      labelId: 'label-1',
      pinned: true,
      atTime: '09:00',
      checklist: [{ id: 'c1', text: 'agenda', done: true }],
    })
    const inst = makeInstance(tmpl, '2026-07-15', nextId)

    expect(inst.recurParentId).toBe('tmpl')
    expect(inst.occurrenceDate).toBe('2026-07-15')
    expect(inst.day).toBe('2026-07-15')
    // An instance must never carry a rule of its own, or it would materialize its own instances.
    expect(inst.recurFreq).toBe('none')
    expect(inst.recurUntil).toBeNull()
    // Content copies across; per-occurrence progress resets.
    expect(inst.title).toBe('Standup')
    expect(inst.labelId).toBe('label-1')
    // Pinning is Occurrence State and is never inherited (#215) — see the dedicated test below.
    expect(inst.pinned).toBe(false)
    expect(inst.atTime).toBe('09:00')
    expect(inst.checklist).toHaveLength(1)
    expect(inst.checklist[0]).toMatchObject({ text: 'agenda', done: false })
    // Step ids are **shared** with the definition, not minted (#214). That shared identity is what
    // lets an all-future Checklist edit carry each Occurrence's ticks across instead of resetting
    // them. Only `done` resets here — a future Occurrence starts with nothing ticked.
    expect(inst.checklist[0].id).toBe('c1')
    expect(inst.done).toBe(false)
    expect(inst.status).toBe('todo')
  })
})

describe('pendingInstances', () => {
  it('proposes only the occurrences with no instance yet', () => {
    const s = series()
    const missing = pendingInstances(s.templates, s.tasks, '2026-07-01', nextId)
    // First three occurrences are covered; the horizon reaches ~90 days, so later ones are not.
    expect(missing.every((m) => m.recurParentId === 'tmpl')).toBe(true)
    expect(missing.map((m) => m.day)).not.toContain('2026-07-01')
    expect(missing.map((m) => m.day)).not.toContain('2026-07-15')
    expect(missing.map((m) => m.day)).toContain('2026-07-22')
  })

  it('treats a dragged instance as still covering its origin occurrence', () => {
    const s = series()
    const moved = s.tasks.map((x) =>
      x.id === 'i2' ? { ...x, day: '2026-07-09' } : x,
    ) as readonly Task[]
    const missing = pendingInstances(s.templates, moved, '2026-07-01', nextId)
    // 2026-07-08 is still covered by i2 even though the card now sits on the 9th.
    expect(missing.map((m) => m.day)).not.toContain('2026-07-08')
  })

  it('never proposes two instances for the same occurrence in one pass', () => {
    const s = series()
    const all = pendingInstances(s.templates, [], '2026-07-01', nextId)
    const keys = all.map(instanceKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('skips deleted occurrences so they never come back', () => {
    const s = series()
    const templates = [{ ...s.templates[0], excludedDates: ['2026-07-22'] }]
    const missing = pendingInstances(templates, s.tasks, '2026-07-01', nextId)
    expect(missing.map((m) => m.day)).not.toContain('2026-07-22')
  })

  it('proposes nothing for a template with no rule or an unscheduled anchor', () => {
    expect(pendingInstances([t('a', { day: '2026-07-01' })], [], '2026-07-01', nextId)).toEqual([])
    expect(
      pendingInstances([t('a', { day: 'inbox', recurFreq: 'weekly' })], [], '2026-07-01', nextId),
    ).toEqual([])
  })
})

// ——— scope resolution ———

describe('resolveSave', () => {
  const instance = t('i1', { recurParentId: 'tmpl', occurrenceDate: '2026-07-08' })

  it('creates when the editor was opened for a new task', () => {
    expect(resolveSave(null, t('new'), true).kind).toBe('create')
  })

  it('updates a plain task directly', () => {
    expect(resolveSave(t('a'), t('a'), false).kind).toBe('update-plain')
  })

  it('promotes a standalone task that gained a recurrence rule', () => {
    const draft = t('a', { day: '2026-07-01', recurFreq: 'weekly', recurInterval: 1 })
    expect(resolveSave(t('a', { day: '2026-07-01' }), draft, false).kind).toBe('promote-to-series')
  })

  it('does not promote an occurrence that carries a rule in the draft', () => {
    // An instance's draft arrives with its series' rule merged on by `Board.openTask`, so
    // `isTemplate` alone would misread it. Having a parent is what settles it.
    const draft = t('i1', { recurParentId: 'tmpl', recurFreq: 'weekly' })
    expect(resolveSave(instance, draft, false, 'this').kind).toBe('update-occurrence')
  })

  it('edits the series from this occurrence when the scope is "future"', () => {
    const op = resolveSave(instance, t('i1', { title: 'New' }), false, 'future')
    expect(op).toMatchObject({ kind: 'update-series-from', instance: { id: 'i1' } })
  })

  it('strips the rule when editing just this occurrence', () => {
    // The instance must never persist a rule of its own, or it starts materializing instances.
    // Board used to be responsible for remembering this, with only a comment enforcing it.
    const draft = t('i1', { recurFreq: 'weekly', recurInterval: 3, recurUntil: '2026-12-31' })
    const op = resolveSave(instance, draft, false, 'this')
    expect(op.kind).toBe('update-occurrence')
    if (op.kind !== 'update-occurrence') throw new Error('unreachable')
    expect(op.task.recurFreq).toBe('none')
    expect(op.task.recurInterval).toBe(1)
    expect(op.task.recurUntil).toBeNull()
    expect(op.task.recurParentId).toBe('tmpl') // still belongs to its series
  })

  it('treats a missing scope on an instance as "this occurrence"', () => {
    // The editor emits `undefined` rather than 'this' when no prompt was shown.
    expect(resolveSave(instance, t('i1'), false).kind).toBe('update-occurrence')
  })
})

describe('resolveDelete', () => {
  const instance = t('i1', { recurParentId: 'tmpl' })
  it('routes by whether the task belongs to a series, then by scope', () => {
    expect(resolveDelete(t('plain'))).toEqual({ kind: 'delete-plain', id: 'plain' })
    expect(resolveDelete(instance, 'future').kind).toBe('delete-series-from')
    expect(resolveDelete(instance, 'this').kind).toBe('delete-occurrence')
    expect(resolveDelete(instance).kind).toBe('delete-occurrence')
  })
})

// ——— plans ———

describe('planEditSeriesFrom', () => {
  it('edits this occurrence and every later one, leaving earlier ones alone', () => {
    const s = series()
    const draft = t('i2', { title: 'Renamed', description: 'd', recurFreq: 'weekly' })
    const plan = planEditSeriesFrom(s, s.tasks[1], draft)!

    expect(plan.state.tasks.find((x) => x.id === 'i1')!.title).toBe('Standup') // untouched
    expect(plan.state.tasks.find((x) => x.id === 'i2')!.title).toBe('Renamed')
    expect(plan.state.tasks.find((x) => x.id === 'i3')!.title).toBe('Renamed')
    expect(plan.state.templates[0].title).toBe('Renamed')
    expect(ids(plan.upserts)).toEqual(['tmpl', 'i2', 'i3'])
    expect(plan.materialize).toEqual([plan.state.templates[0]])
  })

  it('never carries per-occurrence progress across the series', () => {
    // pinned/status/done are per-occurrence; a "this and all future" edit that copied them would
    // clobber each occurrence's own state.
    const s = series()
    s.tasks[2] = { ...s.tasks[2], done: true, status: 'done', pinned: true }
    const draft = t('i2', { title: 'Renamed', done: false, status: 'todo', pinned: false })
    const plan = planEditSeriesFrom(s, s.tasks[1], draft)!

    const i3 = plan.state.tasks.find((x) => x.id === 'i3')!
    expect(i3.title).toBe('Renamed')
    expect(i3.done).toBe(true)
    expect(i3.status).toBe('done')
    expect(i3.pinned).toBe(true)
  })

  it('carries a Label edit through the template and future occurrences', () => {
    const s = series()
    const draft = t('i2', { labelId: 'label-2', recurFreq: 'weekly' })
    const plan = planEditSeriesFrom(s, s.tasks[1], draft)!

    expect(plan.state.tasks.find((x) => x.id === 'i1')?.labelId).toBeNull()
    expect(plan.state.tasks.find((x) => x.id === 'i2')?.labelId).toBe('label-2')
    expect(plan.state.tasks.find((x) => x.id === 'i3')?.labelId).toBe('label-2')
    expect(plan.state.templates[0].labelId).toBe('label-2')
  })

  it('scopes by the occurrence origin, not the day a dragged card sits on', () => {
    const s = series()
    // i2 covers 2026-07-08 but was dragged back before i1's day.
    s.tasks[1] = { ...s.tasks[1], day: '2026-06-30' }
    const plan = planEditSeriesFrom(s, s.tasks[1], t('i2', { title: 'Renamed' }))!
    expect(plan.state.tasks.find((x) => x.id === 'i1')!.title).toBe('Standup')
    expect(plan.state.tasks.find((x) => x.id === 'i2')!.title).toBe('Renamed')
  })

  it('drops occurrences past a shortened end, and schedules the matching delete', () => {
    const s = series()
    const draft = t('i1', { title: 'Standup', recurFreq: 'weekly', recurUntil: '2026-07-10' })
    const plan = planEditSeriesFrom(s, s.tasks[0], draft)!

    expect(ids(plan.state.tasks)).toEqual(['i1', 'i2']) // i3 is past the new end
    expect(plan.deletions).toEqual([
      {
        target: { by: 'occurrence-after', parentId: 'tmpl', day: '2026-07-10' },
        onFailure: { abort: false, recover: 'none' },
      },
    ])
    expect(plan.markIds).toContain('i3')
  })

  it('schedules no delete when the rule was not shortened', () => {
    const s = series()
    const plan = planEditSeriesFrom(s, s.tasks[0], t('i1', { recurFreq: 'weekly' }))!
    expect(plan.deletions).toEqual([])
  })

  it('treats a failed content upsert as fatal for the rest of the plan', () => {
    // There is nothing coherent to trim to if the new rule never persisted.
    const s = series()
    const plan = planEditSeriesFrom(s, s.tasks[0], t('i1', { recurFreq: 'weekly' }))!
    expect(plan.upsertOnFailure).toEqual({ abort: true, recover: 'reload' })
  })

  it('returns null when the series no longer has a template', () => {
    const s = series()
    expect(planEditSeriesFrom({ ...s, templates: [] }, s.tasks[0], t('i1'))).toBeNull()
  })
})

describe('pinning is never inherited (#215)', () => {
  it('builds an unpinned Occurrence from a pinned definition', () => {
    const tmpl = t('tmpl', { day: '2026-07-01', recurFreq: 'weekly', pinned: true })
    expect(makeInstance(tmpl, '2026-07-15', nextId).pinned).toBe(false)
  })

  it('promotion keeps the card\u2019s own pin but leaves the definition unpinned', () => {
    // The whole bug in one assertion pair: the user's card stays pinned because it is their card,
    // and the Series carries no pin, so nothing seeds future Occurrences with one.
    const draft = t('a', { day: '2026-07-01', recurFreq: 'weekly', pinned: true })
    const plan = planPromoteToSeries({ tasks: [draft], templates: [] }, draft, nextId)
    const definition = plan.state.templates[0]
    const first = plan.state.tasks.find((x) => x.id === 'a')!

    expect(first.pinned).toBe(true)
    expect(definition.pinned).toBe(false)
    // And an Occurrence materialized later from that definition is unpinned too.
    expect(makeInstance(definition, '2026-07-08', nextId).pinned).toBe(false)
  })

  it('pinning one Occurrence leaves every other Occurrence alone', () => {
    const state = series()
    const i2 = state.tasks[1]
    const plan = planEditSeriesFrom(state, i2, { ...i2, title: 'Renamed', pinned: true })!
    expect(plan.state.tasks.find((x) => x.id === 'i1')!.pinned).toBe(false)
    expect(plan.state.tasks.find((x) => x.id === 'i3')!.pinned).toBe(false)
    expect(plan.state.templates[0].pinned).toBe(false)
  })
})

describe('planEditSeriesFrom — field ownership (#213)', () => {
  it('keeps the edited Occurrence\u2019s own state when it changes alongside series content', () => {
    // Before #213 affected Occurrences were rebuilt from the *stored* row, so a pin toggled in the
    // same save as a rename was dropped on the very card being edited.
    const state = series()
    const i2 = state.tasks[1]
    const plan = planEditSeriesFrom(state, i2, { ...i2, title: 'Renamed', pinned: true })!
    const edited = plan.state.tasks.find((x) => x.id === 'i2')!
    expect(edited.pinned).toBe(true)
    expect(edited.title).toBe('Renamed')
  })

  it('moves only the edited Occurrence when its day changes alongside series content', () => {
    const state = series()
    const i2 = state.tasks[1]
    const plan = planEditSeriesFrom(state, i2, { ...i2, title: 'Renamed', day: '2026-07-10' })!
    expect(plan.state.tasks.find((x) => x.id === 'i2')!.day).toBe('2026-07-10')
    // Its Occurrence Date is identity and does not move with it.
    expect(plan.state.tasks.find((x) => x.id === 'i2')!.occurrenceDate).toBe('2026-07-08')
    // A later Occurrence takes the rename and keeps its own placement.
    const i3 = plan.state.tasks.find((x) => x.id === 'i3')!
    expect(i3.title).toBe('Renamed')
    expect(i3.day).toBe('2026-07-15')
  })

  it('does not carry the edited Occurrence\u2019s state onto any other Occurrence', () => {
    const state = series()
    const i2 = state.tasks[1]
    const plan = planEditSeriesFrom(state, i2, {
      ...i2,
      title: 'Renamed',
      pinned: true,
      status: 'doing',
    })!
    const i3 = plan.state.tasks.find((x) => x.id === 'i3')!
    expect(i3.pinned).toBe(false)
    expect(i3.status).toBe('todo')
  })

  it('never takes excludedDates from the draft', () => {
    // The trap: a draft is an Occurrence, whose excludedDates is always empty. Copying it onto the
    // Series would erase every Excluded Date and resurrect every deleted Occurrence.
    const base = series()
    const state = {
      ...base,
      templates: [{ ...base.templates[0], excludedDates: ['2026-07-22'] }],
    }
    const i2 = state.tasks[1]
    const plan = planEditSeriesFrom(state, i2, { ...i2, title: 'Renamed' })!
    expect(plan.state.templates[0].excludedDates).toEqual(['2026-07-22'])
  })

  it('propagates the Checklist to every affected Occurrence, keeping each one\u2019s ticks', () => {
    const state = series()
    // i3 has ticked the first Step; i2 has not.
    state.tasks[1] = { ...state.tasks[1], checklist: [{ id: 'c1', text: 'agenda', done: false }] }
    state.tasks[2] = { ...state.tasks[2], checklist: [{ id: 'c1', text: 'agenda', done: true }] }
    const i2 = state.tasks[1]

    const draft = {
      ...i2,
      checklist: [
        { id: 'c1', text: 'agenda (revised)', done: false },
        { id: 'c2', text: 'new step', done: false },
      ],
    }
    const plan = planEditSeriesFrom(state, i2, draft)!

    // The definition holds the Steps and never their progress.
    expect(plan.state.templates[0].checklist).toEqual([
      { id: 'c1', text: 'agenda (revised)', done: false },
      { id: 'c2', text: 'new step', done: false },
    ])
    // The edited card takes the draft outright.
    expect(plan.state.tasks.find((x) => x.id === 'i2')!.checklist).toEqual(draft.checklist)
    // A later Occurrence takes the new Steps and keeps the tick it had.
    expect(plan.state.tasks.find((x) => x.id === 'i3')!.checklist).toEqual([
      { id: 'c1', text: 'agenda (revised)', done: true },
      { id: 'c2', text: 'new step', done: false },
    ])
  })

  it('leaves Occurrences before the cut untouched', () => {
    const state = series()
    state.tasks[0] = { ...state.tasks[0], checklist: [{ id: 'c1', text: 'agenda', done: true }] }
    const i2 = state.tasks[1]
    const plan = planEditSeriesFrom(state, i2, {
      ...i2,
      checklist: [{ id: 'c1', text: 'changed', done: false }],
    })!
    expect(plan.state.tasks.find((x) => x.id === 'i1')!.checklist).toEqual([
      { id: 'c1', text: 'agenda', done: true },
    ])
  })
})

describe('planDeleteOccurrence', () => {
  it('removes the instance and records the skip against its origin', () => {
    const s = series()
    const plan = planDeleteOccurrence(s, s.tasks[1])

    expect(ids(plan.state.tasks)).toEqual(['i1', 'i3'])
    expect(plan.state.templates[0].excludedDates).toEqual(['2026-07-08'])
    expect(plan.upserts).toEqual([plan.state.templates[0]])
    expect(plan.deletions).toEqual([
      { target: { by: 'id', id: 'i2' }, onFailure: { abort: false, recover: 'rollback' } },
    ])
  })

  it('skips the origin occurrence, not the day the card was dragged to', () => {
    // Skipping the moved day would leave the real occurrence unfilled, and the next
    // materialization would resurrect the occurrence the user just deleted.
    const s = series()
    s.tasks[1] = { ...s.tasks[1], day: '2026-07-11' }
    const plan = planDeleteOccurrence(s, s.tasks[1])
    expect(plan.state.templates[0].excludedDates).toEqual(['2026-07-08'])
  })

  it('still deletes the occurrence when recording the skip fails', () => {
    // Best-effort, and deliberately non-aborting: the user asked for the occurrence to go.
    const s = series()
    const plan = planDeleteOccurrence(s, s.tasks[1])
    expect(plan.upsertOnFailure).toEqual({ abort: false, recover: 'none' })
  })

  it('degrades to a plain delete for an orphaned instance', () => {
    const s = series()
    const plan = planDeleteOccurrence({ ...s, templates: [] }, s.tasks[1])
    expect(plan.upserts).toEqual([])
    expect(plan.deletions).toEqual([
      { target: { by: 'id', id: 'i2' }, onFailure: { abort: false, recover: 'rollback' } },
    ])
  })
})

describe('planDeleteSeriesFrom', () => {
  it('caps the rule and deletes this occurrence onward', () => {
    const s = series()
    const plan = planDeleteSeriesFrom(s, s.tasks[1])

    expect(ids(plan.state.tasks)).toEqual(['i1'])
    expect(plan.state.templates[0].recurUntil).toBe('2026-07-07') // the day before the cut
    expect(plan.upserts).toEqual([plan.state.templates[0]])
    expect(plan.deletions).toEqual([
      {
        target: { by: 'occurrence-from', parentId: 'tmpl', day: '2026-07-08' },
        onFailure: { abort: false, recover: 'reload' },
      },
    ])
  })

  it('removes the whole series when cutting at the first occurrence', () => {
    const s = series()
    const plan = planDeleteSeriesFrom(s, s.tasks[0])

    expect(plan.state.tasks).toEqual([])
    expect(plan.state.templates).toEqual([])
    // Deleting the template cascades to its instances in the database.
    expect(plan.deletions).toEqual([
      { target: { by: 'id', id: 'tmpl' }, onFailure: { abort: false, recover: 'reload' } },
    ])
    expect(plan.markIds).toEqual(expect.arrayContaining(['tmpl', 'i1', 'i2', 'i3']))
  })

  it('cannot be tricked into the whole-series branch by dragging a card earlier', () => {
    // Scoped by origin: i2 covers 2026-07-08 even if its card was dragged before the anchor.
    const s = series()
    s.tasks[1] = { ...s.tasks[1], day: '2026-06-01' }
    const plan = planDeleteSeriesFrom(s, s.tasks[1])
    expect(plan.state.templates).toHaveLength(1)
    expect(plan.state.templates[0].recurUntil).toBe('2026-07-07')
  })

  it('degrades to a plain delete for an orphaned instance', () => {
    const s = series()
    const plan = planDeleteSeriesFrom({ ...s, templates: [] }, s.tasks[1])
    expect(ids(plan.state.tasks)).toEqual(['i1', 'i3'])
    expect(plan.deletions).toEqual([
      { target: { by: 'id', id: 'i2' }, onFailure: { abort: false, recover: 'rollback' } },
    ])
  })
})

describe('plans do not mutate their input', () => {
  it('leaves the given state untouched', () => {
    const s = series()
    const before = JSON.stringify(s)
    planEditSeriesFrom(s, s.tasks[1], t('i2', { title: 'X', recurFreq: 'weekly' }))
    planDeleteOccurrence(s, s.tasks[1])
    planDeleteSeriesFrom(s, s.tasks[1])
    expect(JSON.stringify(s)).toBe(before)
  })
})

describe('planPromoteToSeries', () => {
  /** A Task the user has already made progress on, scheduled and positioned on the board. */
  function inProgress() {
    return t('t1', {
      day: '2026-07-01',
      status: 'doing',
      order: 3,
      korder: 7,
      pinned: true,
      title: 'Water the plants',
      checklist: [
        { id: 'c1', text: 'step one', done: true },
        { id: 'c2', text: 'step two', done: false },
      ],
      recurFreq: 'weekly',
      recurInterval: 1,
    })
  }

  const ids = () => {
    let n = 0
    return () => `gen-${++n}`
  }

  it('keeps the original row as the first Occurrence, with its progress intact', () => {
    const draft = inProgress()
    const plan = planPromoteToSeries({ tasks: [draft], templates: [] }, draft, ids())

    // The whole point of #206: this is the same row the user was working on, not a fresh one.
    const first = plan.state.tasks.find((task) => task.id === 't1')!
    expect(first.status).toBe('doing')
    expect(first.checklist.map((c) => c.done)).toEqual([true, false])
    expect(first.order).toBe(3)
    expect(first.korder).toBe(7)
    expect(first.pinned).toBe(true)
    expect(plan.state.tasks).toHaveLength(1)
  })

  it('points the first Occurrence at a new template and stamps its Occurrence Date', () => {
    const draft = inProgress()
    const plan = planPromoteToSeries({ tasks: [draft], templates: [] }, draft, ids())

    const template = plan.state.templates[0]
    expect(template.id).toBe('gen-1')
    expect(template.id).not.toBe(draft.id)

    const first = plan.state.tasks[0]
    expect(first.recurParentId).toBe(template.id)
    expect(first.occurrenceDate).toBe('2026-07-01')
    // The rule lives on the template only; an Occurrence carrying one would itself look like a
    // template to `isTemplate` the moment its parent went away.
    expect(first.recurFreq).toBe('none')
    expect(first.recurUntil).toBeNull()
  })

  it('strips per-occurrence state from the template, which seeds every later Occurrence', () => {
    const draft = inProgress()
    const plan = planPromoteToSeries({ tasks: [draft], templates: [] }, draft, ids())

    const template = plan.state.templates[0]
    expect(template.status).toBe('todo')
    expect(template.done).toBe(false)
    expect(template.checklist.map((c) => c.done)).toEqual([false, false])
    // Shared content still travels: these are what each Occurrence is made of.
    expect(template.title).toBe('Water the plants')
    expect(template.day).toBe('2026-07-01')
    expect(template.recurFreq).toBe('weekly')
  })

  it('writes the template and its first Occurrence in one batch', () => {
    const draft = inProgress()
    const plan = planPromoteToSeries({ tasks: [draft], templates: [] }, draft, ids())

    // A template with no Occurrence is invisible and an Occurrence with no template is orphaned,
    // so a partial write of these two is worse than neither.
    expect(plan.upserts.map((task) => task.id)).toEqual(['gen-1', 't1'])
    expect(plan.deletions).toEqual([])
    expect(plan.markIds).toEqual(['gen-1', 't1'])
    expect(plan.materialize.map((task) => task.id)).toEqual(['gen-1'])
  })

  it('leaves the rest of the board alone', () => {
    const draft = inProgress()
    const other = t('other', { day: '2026-07-01', order: 1 })
    const plan = planPromoteToSeries({ tasks: [other, draft], templates: [] }, draft, ids())

    expect(plan.state.tasks.find((task) => task.id === 'other')).toEqual(other)
  })

  it('produces a first Occurrence that materialization treats as already covered', () => {
    const draft = inProgress()
    const plan = planPromoteToSeries({ tasks: [draft], templates: [] }, draft, ids())

    // The regression this guards: if the first Occurrence were not counted, materialization would
    // insert a second row for the same Occurrence Date and hit tasks_recur_instance_uniq.
    const pending = pendingInstances(plan.state.templates, plan.state.tasks, '2026-07-01', ids())
    expect(pending.some((task) => task.occurrenceDate === '2026-07-01')).toBe(false)
    // Everything after it is still pending — the anchor is skipped, not the whole rule.
    expect(pending[0].occurrenceDate).toBe('2026-07-08')
  })
})
