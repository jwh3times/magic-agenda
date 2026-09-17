import { describe, expect, test } from 'vitest'
import { captureUndo, planUndo } from './undo'
import {
  asTask,
  isSeriesDefinition,
  NO_RECUR,
  type SeriesDefinition,
  type Task,
} from '../types/task'

function t(id: string, over: Partial<Task> = {}): Task {
  return asTask({
    id,
    title: id,
    description: '',
    labelId: null,
    color: 'yellow',
    checklist: [],
    status: 'todo',
    completedAt: null,
    reopenStatus: 'todo',
    archivedAt: null,
    day: '2026-09-17',
    atTime: null,
    pinned: false,
    order: 0,
    korder: 0,
    ...NO_RECUR,
    ...over,
  })
}

function def(id: string, excludedDates: string[] = []): SeriesDefinition {
  const task = t(id, { recurFreq: 'weekly', recurInterval: 1, excludedDates })
  if (!isSeriesDefinition(task)) throw new Error('fixture is not a definition')
  return task
}

describe('captureUndo', () => {
  test('records the prior version of each touched row, routed to tasks or definitions', () => {
    const before = { tasks: [t('a'), t('b')], templates: [def('s')] }
    const entry = captureUndo('Deleted', before, ['a', 's', 'unknown'])
    expect(entry.label).toBe('Deleted')
    expect(entry.tasks).toEqual([before.tasks[0]])
    expect(entry.templates).toEqual([before.templates[0]])
  })
})

describe('planUndo', () => {
  test('writes changed rows back and restores their place in state', () => {
    const before = { tasks: [t('a', { status: 'todo' }), t('b')], templates: [] }
    const entry = captureUndo('Completed', before, ['a'])
    const current = {
      tasks: [
        t('a', { status: 'completed', completedAt: 'x', reopenStatus: 'todo' }),
        t('b', { title: 'edited elsewhere' }),
      ],
      templates: [],
    }

    const plan = planUndo(entry, current)
    expect(plan.upsertTasks).toEqual([before.tasks[0]])
    expect(plan.upsertTemplates).toEqual([])
    // Rows the action did not touch keep their current version.
    expect(plan.state.tasks).toEqual([before.tasks[0], current.tasks[1]])
    expect(plan.markIds).toEqual(['a'])
  })

  test('re-inserts deleted rows with their original ids, definitions before occurrences', () => {
    const series = def('s', ['2026-09-10'])
    const occurrence = t('o', {
      recurParentId: 's',
      occurrenceDate: '2026-09-17',
      day: '2026-09-17',
    })
    const before = { tasks: [t('plain'), occurrence], templates: [series] }
    const entry = captureUndo('Deleted 2 tasks', before, ['plain', 'o', 's'])
    // The bulk delete retired the Series: every one of these rows is gone now.
    const current = { tasks: [], templates: [] }

    const plan = planUndo(entry, current)
    expect(plan.upsertTemplates).toEqual([series])
    expect(plan.upsertTasks).toEqual([t('plain'), occurrence])
    expect(plan.state).toEqual({ tasks: [t('plain'), occurrence], templates: [series] })
    expect(plan.markIds).toEqual(['s', 'plain', 'o'])
  })

  test('restores a definition whose Excluded Dates the action extended', () => {
    const before = {
      tasks: [t('o', { recurParentId: 's', occurrenceDate: '2026-09-17' })],
      templates: [def('s')],
    }
    const entry = captureUndo('Deleted', before, ['o', 's'])
    const current = { tasks: [], templates: [def('s', ['2026-09-17'])] }
    const plan = planUndo(entry, current)
    expect(plan.state.templates).toEqual([def('s')])
    expect(plan.upsertTemplates).toEqual([def('s')])
  })
})
