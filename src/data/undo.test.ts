import { describe, expect, test } from 'vitest'
import { captureUndo, planUndo } from './undo'
import type { Attachment } from './attachments'
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

function attachment(id: string, taskId: string): Attachment {
  return {
    id,
    taskId,
    boardId: 'b1',
    storagePath: `b1/${taskId}/${id}`,
    filename: `${id}.png`,
    mimeType: 'image/png',
    sizeBytes: 10,
    uploadedBy: null,
    createdAt: '2026-09-17T00:00:00Z',
  }
}

describe('captureUndo', () => {
  test('records the prior version of each touched row, routed to tasks or definitions', () => {
    const before = { tasks: [t('a'), t('b')], templates: [def('s')] }
    const entry = captureUndo('Deleted', before, ['a', 's', 'unknown'])
    expect(entry.label).toBe('Deleted')
    expect(entry.tasks).toEqual([before.tasks[0]])
    expect(entry.templates).toEqual([before.templates[0]])
  })

  test('an action with no attachments records none', () => {
    const before = { tasks: [t('a')], templates: [] }
    expect(captureUndo('Completed', before, ['a']).attachments).toEqual([])
  })

  test('attachments are filtered by the same ids as the rows (#404)', () => {
    // The caller captures for every id the entry covers, and may be handed rows for a Task the
    // action did not touch -- a stale read, or a caller passing a wider set. The entry is the
    // boundary: it can only restore attachments belonging to rows it is also restoring.
    const before = { tasks: [t('a'), t('b')], templates: [] }
    const entry = captureUndo(
      'Deleted',
      before,
      ['a'],
      [attachment('att-a', 'a'), attachment('att-b', 'b')],
    )
    expect(entry.attachments.map((x) => x.id)).toEqual(['att-a'])
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

  test('carries the attachments through for the caller to write last (#404)', () => {
    // Not part of `state`: attachments are outside the board snapshot, so there is nothing
    // optimistic to restore -- only a write, and one that must follow the Task's.
    const before = { tasks: [t('a')], templates: [] }
    const entry = captureUndo('Deleted', before, ['a'], [attachment('att-a', 'a')])
    const plan = planUndo(entry, { tasks: [], templates: [] })
    expect(plan.insertAttachments).toEqual([attachment('att-a', 'a')])
    expect(plan.state.tasks).toEqual([t('a')])
  })
})
