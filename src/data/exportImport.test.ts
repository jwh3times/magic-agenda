import { expect, test } from 'vitest'
import { NO_RECUR, type Task } from '../types/task'
import { chunk, parseExport, remapIds, serializeExport } from './exportImport'

function mk(over: Partial<Task> = {}): Task {
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
const settings = { theme: 'cork', defaultView: 'calendar' }

test('serialize → parse round-trips', () => {
  const json = serializeExport([plain, instance], [template], settings, '2026-07-10T00:00:00Z')
  const parsed = parseExport(json)
  if (!parsed.ok) throw new Error(parsed.error)
  expect(parsed.data.version).toBe(1)
  expect(parsed.data.tasks).toHaveLength(2)
  expect(parsed.data.templates).toHaveLength(1)
  expect(parsed.data.settings).toEqual(settings)
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
  const badTask = JSON.parse(serializeExport([plain], [], settings, 'x'))
  badTask.tasks[0].category = 'nonsense'
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

test('chunk splits preserving order', () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  expect(chunk([], 2)).toEqual([])
})
