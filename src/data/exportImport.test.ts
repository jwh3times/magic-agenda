import { expect, test } from 'vitest'
import { NO_RECUR } from '../types/task'
import {
  chunk,
  legacyTaskToRow,
  parseExport,
  remapIds,
  rowToLegacyTask,
  serializeExport,
  type LegacyTask,
} from './exportImport'
import { missingInstances } from './recurrence'
import type { Database } from '../types/database.types'

function mk(over: Partial<LegacyTask> = {}): LegacyTask {
  return {
    id: 'id-1',
    title: 'T',
    description: '',
    category: 'work',
    color: 'yellow',
    checklist: [],
    status: 'todo',
    done: false,
    day: '2026-07-10',
    order: 0,
    korder: 0,
    atTime: null,
    pinned: false,
    ...NO_RECUR,
    ...over,
  }
}

type TaskRow = Database['public']['Tables']['tasks']['Row']

function row(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'r1',
    user_id: 'u1',
    board_id: 'b1',
    title: 'T',
    description: '',
    category: 'work',
    label_id: null,
    label_assignment_explicit: false,
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
    author_id: null,
    last_editor_id: null,
    author_kind: 'author',
    revision: 1,
    created_at: '2026-08-16T00:00:00Z',
    updated_at: '2026-08-16T00:00:00Z',
    ...over,
  }
}

const template = mk({
  id: 'tpl-1',
  recurFreq: 'daily',
  recurSkip: ['2026-07-11'],
  checklist: [{ id: 'c1', text: 'sub', done: false }],
})
const instance = mk({
  id: 'inst-1',
  recurParentId: 'tpl-1',
  recurOriginDay: '2026-07-10',
  checklist: [{ id: 'c2', text: 'sub', done: true }],
})
const plain = mk({ id: 'plain-1', atTime: '09:30', pinned: true })
const settings = { theme: 'cork', defaultView: 'calendar', weekStart: 0, timezone: null }

test('serialize → parse round-trips', () => {
  const json = serializeExport([plain, instance], [template], settings, '2026-07-10T00:00:00Z')
  const parsed = parseExport(json)
  if (!parsed.ok) throw new Error(parsed.error)
  expect(parsed.data.version).toBe(1)
  expect(parsed.data.tasks).toHaveLength(2)
  expect(parsed.data.templates).toHaveLength(1)
  expect(parsed.data.settings).toEqual(settings)
})

test('v1 export resolves the canonical Label alias and contains no Label fields', () => {
  const exported = rowToLegacyTask(
    row({ label_id: 'l-errands', category: 'work' }),
    new Map([['l-errands', 'errands']]),
  )
  expect(exported.category).toBe('errands')
  expect('labelId' in exported).toBe(false)
})

test('v1 export falls back to the stored Category for Unlabeled or an unaliased Label', () => {
  expect(rowToLegacyTask(row({ label_id: null, category: 'personal' }), new Map()).category).toBe(
    'personal',
  )
  expect(rowToLegacyTask(row({ label_id: 'custom', category: 'health' }), new Map()).category).toBe(
    'health',
  )
})

test('v1 import opts into the temporary Category-to-Label database bridge', () => {
  const inserted = legacyTaskToRow(mk({ category: 'ideas' }), 'u1', 'b1')
  expect(inserted.category).toBe('ideas')
  expect(inserted.label_assignment_explicit).toBe(false)
  expect(inserted.label_id).toBeNull()
})

test('remapIds freshens every id but preserves series links, skips, and content', () => {
  const { tasks, templates } = remapIds({ tasks: [plain, instance], templates: [template] })
  const [tpl] = templates
  expect(tpl.id).not.toBe('tpl-1')
  expect(tpl.recurSkip).toEqual(['2026-07-11'])
  expect(tpl.checklist[0].id).not.toBe('c1')
  expect(tpl.checklist[0].text).toBe('sub')
  const inst = tasks.find((t) => t.recurParentId)!
  expect(inst.id).not.toBe('inst-1')
  expect(inst.recurParentId).toBe(tpl.id)
  expect(inst.recurOriginDay).toBe('2026-07-10')
  const kept = tasks.find((t) => !t.recurParentId)!
  expect(kept.atTime).toBe('09:30')
  expect(kept.pinned).toBe(true)
})

test('an instance whose template is missing becomes a plain task', () => {
  const { tasks } = remapIds({ tasks: [instance], templates: [] })
  expect(tasks[0].recurParentId).toBeNull()
  expect(tasks[0].recurOriginDay).toBeNull()
})

test('parseExport rejects garbage, wrong versions, and malformed tasks', () => {
  expect(parseExport('not json').ok).toBe(false)
  expect(parseExport('42').ok).toBe(false)
  expect(parseExport(JSON.stringify({ version: 2, tasks: [], templates: [] })).ok).toBe(false)
  const badTask = JSON.parse(serializeExport([plain], [], settings, 'x')) as unknown as {
    tasks: Array<Record<string, unknown>>
  }
  badTask.tasks[0].category = 'nonsense'
  expect(parseExport(JSON.stringify(badTask)).ok).toBe(false)
  delete badTask.tasks[0].category
  badTask.tasks[0].labelId = 'l1'
  expect(parseExport(JSON.stringify(badTask)).ok).toBe(false)
  const templateInTasksList = JSON.stringify({
    version: 1,
    exportedAt: 'x',
    settings,
    tasks: [],
    templates: [plain],
  })
  expect(parseExport(templateInTasksList).ok).toBe(false)
})

test('parseExport rejects a non-boolean done field', () => {
  const badDone = JSON.parse(serializeExport([plain], [], settings, 'x')) as unknown as {
    tasks: Array<Record<string, unknown>>
  }
  badDone.tasks[0].done = 'yes'
  expect(parseExport(JSON.stringify(badDone)).ok).toBe(false)
})

test('rejects a repeating template placed in the tasks array', () => {
  const templateInTasks = JSON.stringify({
    version: 1,
    exportedAt: 'x',
    settings,
    tasks: [template],
    templates: [],
  })
  expect(parseExport(templateInTasks).ok).toBe(false)
})

test('parseExport rejects a row that is both recurring and carries a parent id', () => {
  // A template has recurFreq !== 'none' and no parent; an instance has recurFreq === 'none' and a
  // parent. A row with both is neither — internally contradictory, and isTemplate() alone can't
  // catch it (a truthy recurParentId already makes isTemplate() false).
  const hybrid = JSON.parse(serializeExport([plain], [], settings, 'x')) as unknown as {
    tasks: Array<Record<string, unknown>>
  }
  hybrid.tasks[0].recurFreq = 'daily'
  hybrid.tasks[0].recurParentId = 'tpl-1'
  expect(parseExport(JSON.stringify(hybrid)).ok).toBe(false)
})

test('a remapped template + instance is not re-materialized on the next reload (import↔materialize safety)', () => {
  // template: daily from 2026-07-10, skips 07-11. instance: materialized for origin 07-10 (the
  // template's own anchor occurrence). remapIds gives both fresh ids but must preserve the link.
  const { tasks, templates } = remapIds({ tasks: [instance], templates: [template] })
  const [remappedTemplate] = templates
  const [remappedInstance] = tasks

  // Same rolling-materialize call useTasks makes on load/reload: today = the template's anchor day,
  // horizon 3 days -> occurrences 07-10, (skip 07-11), 07-12, 07-13.
  const missing = missingInstances(remappedTemplate, [remappedInstance], '2026-07-10', 3)

  // The imported instance already covers its origin occurrence, so materialize must not regenerate
  // it (and can't collide on the (recur_parent_id, recur_origin_day) unique index).
  expect(missing).not.toContain('2026-07-10')
  expect(missing).toEqual(['2026-07-12', '2026-07-13'])
  expect(remappedInstance.recurOriginDay).toBe('2026-07-10')
  expect(remappedInstance.recurParentId).toBe(remappedTemplate.id)
})

test('chunk splits preserving order', () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  expect(chunk([], 2)).toEqual([])
})
