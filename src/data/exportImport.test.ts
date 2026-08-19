import { expect, test } from 'vitest'
import { NO_RECUR, type Task } from '../types/task'
import {
  chunk,
  parseExport,
  prepareImport,
  referencedSourceLabels,
  remapIds,
  serializeExport,
  type ExportLabel,
  type LegacyTask,
} from './exportImport'
import { missingInstances } from './recurrence'

function task(over: Partial<Task> = {}): Task {
  return {
    id: 'id-1',
    title: 'T',
    description: '',
    labelId: null,
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

function legacyTask(over: Partial<LegacyTask> = {}): LegacyTask {
  const { labelId: _labelId, ...base } = task(over)
  return { ...base, category: 'work', ...over }
}

function legacyExport(tasks: LegacyTask[], templates: LegacyTask[] = []): string {
  return JSON.stringify({
    version: 1,
    exportedAt: '2026-07-10T00:00:00Z',
    settings: { theme: 'cork', defaultView: 'calendar', weekStart: 0, timezone: null },
    tasks,
    templates,
  })
}

const labels: ExportLabel[] = [
  { id: 'source-work', name: 'Work', dotColor: '#2563eb', position: 0 },
  { id: 'source-custom', name: 'Client A', dotColor: '#dc2626', position: 1 },
]

const template = task({
  id: 'tpl-1',
  labelId: 'source-custom',
  recurFreq: 'daily',
  recurSkip: ['2026-07-11'],
  checklist: [{ id: 'c1', text: 'sub', done: false }],
})
const instance = task({
  id: 'inst-1',
  labelId: 'source-work',
  recurParentId: 'tpl-1',
  recurOriginDay: '2026-07-10',
  checklist: [{ id: 'c2', text: 'sub', done: true }],
})
const plain = task({ id: 'plain-1', labelId: null, atTime: '09:30', pinned: true })

test('v2 serialize → parse round-trips Label definitions and nullable assignments without account settings', () => {
  const json = serializeExport([plain, instance], [template], labels, '2026-07-10T00:00:00Z')
  const raw = JSON.parse(json) as Record<string, unknown>
  expect(raw.version).toBe(2)
  expect(raw).not.toHaveProperty('settings')

  const parsed = parseExport(json)
  if (!parsed.ok) throw new Error(parsed.error)
  expect(parsed.data.sourceVersion).toBe(2)
  expect(parsed.data.labels).toEqual(labels)
  expect(parsed.data.tasks.map((item) => item.labelId)).toEqual([null, 'source-work'])
  expect(parsed.data.templates[0].labelId).toBe('source-custom')
})

test('v2 serialization fails closed when split reads observed a dangling Label assignment', () => {
  expect(() =>
    serializeExport([task({ labelId: 'concurrently-removed' })], [], labels, 'x'),
  ).toThrow('A task references a Label that is missing from this export.')
})

test('v1 remains parseable and presents referenced Categories as source Labels while discarding settings', () => {
  const parsed = parseExport(
    legacyExport([
      legacyTask({ id: 'work', category: 'work' }),
      legacyTask({ id: 'health', category: 'health' }),
    ]),
  )
  if (!parsed.ok) throw new Error(parsed.error)

  expect(parsed.data.sourceVersion).toBe(1)
  expect('settings' in parsed.data).toBe(false)
  expect(referencedSourceLabels(parsed.data).map((label) => label.name)).toEqual(['Work', 'Health'])
  expect(parsed.data.tasks.every((item) => item.labelId !== null)).toBe(true)
})

test('v2 rejects duplicate Label ids, malformed definitions, and dangling task references', () => {
  const valid = JSON.parse(
    serializeExport([task({ labelId: 'source-work' })], [], labels, 'x'),
  ) as {
    labels: Array<Record<string, unknown>>
    tasks: Array<Record<string, unknown>>
  }

  valid.labels.push({ ...valid.labels[0] })
  expect(parseExport(JSON.stringify(valid))).toEqual({
    ok: false,
    error: 'The file contains duplicate Label definitions.',
  })

  valid.labels.pop()
  valid.labels[0].dotColor = 'not-a-color'
  expect(parseExport(JSON.stringify(valid))).toEqual({
    ok: false,
    error: 'The file contains a malformed Label.',
  })

  valid.labels[0].dotColor = '#2563eb'
  valid.tasks[0].labelId = 'missing-source'
  expect(parseExport(JSON.stringify(valid))).toEqual({
    ok: false,
    error: 'The file references a Label definition it does not contain.',
  })
})

test('prepareImport requires an explicit mapping even when a destination has the same name', () => {
  const parsed = parseExport(serializeExport([task({ labelId: 'source-work' })], [], labels, 'x'))
  if (!parsed.ok) throw new Error(parsed.error)

  expect(prepareImport(parsed.data, new Map(), new Set(['destination-work']), 'b1')).toEqual({
    ok: false,
    error: 'Choose a destination for every source Label.',
  })
})

test('prepareImport rejects a destination Label outside the selected Board', () => {
  const parsed = parseExport(serializeExport([task({ labelId: 'source-work' })], [], labels, 'x'))
  if (!parsed.ok) throw new Error(parsed.error)

  expect(
    prepareImport(
      parsed.data,
      new Map([['source-work', 'another-board-label']]),
      new Set(['destination-work']),
      'b1',
    ),
  ).toEqual({ ok: false, error: 'A chosen destination Label is no longer available.' })
})

test('mapping applies to plain Tasks, templates, and instances before fresh row planning', () => {
  const parsed = parseExport(serializeExport([plain, instance], [template], labels, 'x'))
  if (!parsed.ok) throw new Error(parsed.error)

  const planned = prepareImport(
    parsed.data,
    new Map<string, string | null>([
      ['source-work', 'destination-work'],
      ['source-custom', null],
    ]),
    new Set(['destination-work']),
    'b1',
  )
  if (!planned.ok) throw new Error(planned.error)

  expect(planned.data.templateRows[0].label_id).toBeNull()
  expect(planned.data.taskRows.map((row) => row.label_id)).toEqual([null, 'destination-work'])
  expect(planned.data.taskRows.every((row) => row.board_id === 'b1')).toBe(true)
  expect(planned.data.templateRows[0].id).not.toBe('tpl-1')
  expect(planned.data.taskRows[1].recur_parent_id).toBe(planned.data.templateRows[0].id)
})

test('v1 Categories use the same explicit mapping path and no longer opt into the database bridge', () => {
  const parsed = parseExport(legacyExport([legacyTask({ category: 'ideas' })]))
  if (!parsed.ok) throw new Error(parsed.error)
  const [source] = referencedSourceLabels(parsed.data)
  const planned = prepareImport(
    parsed.data,
    new Map([[source.id, 'destination-ideas']]),
    new Set(['destination-ideas']),
    'b1',
  )
  if (!planned.ok) throw new Error(planned.error)

  expect(planned.data.taskRows[0].label_id).toBe('destination-ideas')
})

test('remapIds freshens every id but preserves series links, skips, and content', () => {
  const { tasks, templates } = remapIds({ tasks: [plain, instance], templates: [template] })
  const [remappedTemplate] = templates
  expect(remappedTemplate.id).not.toBe('tpl-1')
  expect(remappedTemplate.recurSkip).toEqual(['2026-07-11'])
  expect(remappedTemplate.checklist[0].id).not.toBe('c1')
  const remappedInstance = tasks.find((item) => item.recurParentId)!
  expect(remappedInstance.recurParentId).toBe(remappedTemplate.id)
  expect(remappedInstance.recurOriginDay).toBe('2026-07-10')
  const kept = tasks.find((item) => !item.recurParentId)!
  expect(kept.atTime).toBe('09:30')
  expect(kept.pinned).toBe(true)
})

test('an instance whose template is missing becomes a plain task', () => {
  const { tasks } = remapIds({ tasks: [instance], templates: [] })
  expect(tasks[0].recurParentId).toBeNull()
  expect(tasks[0].recurOriginDay).toBeNull()
})

test('parseExport rejects garbage, unsupported versions, malformed tasks, and mixed arrays', () => {
  expect(parseExport('not json').ok).toBe(false)
  expect(parseExport('42').ok).toBe(false)
  expect(parseExport(JSON.stringify({ version: 3, tasks: [], templates: [] })).ok).toBe(false)

  const malformed = JSON.parse(serializeExport([plain], [], labels, 'x')) as {
    tasks: Array<Record<string, unknown>>
  }
  malformed.tasks[0].done = 'yes'
  expect(parseExport(JSON.stringify(malformed)).ok).toBe(false)

  const templateInTasks = JSON.stringify({
    version: 2,
    exportedAt: 'x',
    labels,
    tasks: [template],
    templates: [],
  })
  expect(parseExport(templateInTasks)).toEqual({
    ok: false,
    error: 'The file mixes up repeating series and tasks.',
  })
})

test('a remapped template + instance is not re-materialized on the next reload', () => {
  const { tasks, templates } = remapIds({ tasks: [instance], templates: [template] })
  const missing = missingInstances(templates[0], [tasks[0]], '2026-07-10', 3)
  expect(missing).not.toContain('2026-07-10')
  expect(missing).toEqual(['2026-07-12', '2026-07-13'])
})

test('chunk splits preserving order', () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  expect(chunk([], 2)).toEqual([])
})
