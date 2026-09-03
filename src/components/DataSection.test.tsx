import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { serializeExport, type LegacyTask } from '../data/exportImport'
import { asTask, NO_RECUR, type Task, type TaskDraft } from '../types/task'
import { fakeBoardDirectory, fakeBoardSession, fakeBoardSummary } from '../board/fakeBoardDirectory'
import { fakeLabel, fakeLabelDirectory } from '../labels/fakeLabelDirectory'
import type { Database } from '../types/database.types'
import type { BoardRole } from '../board/role'
import type { Label } from '../types/label'

const h = vi.hoisted(() => {
  const inserted: unknown[][] = []
  const roles: BoardRole[] = ['owner']
  return {
    inserted,
    role: roles[0],
    destinationLabels: [] as Label[],
    selectTasks: vi.fn(() => Promise.resolve({ data: [] as unknown[], error: null })),
    selectLabels: vi.fn(() => Promise.resolve({ data: [] as unknown[], error: null })),
    insert: vi.fn((rows: unknown[]): Promise<{ error: { message: string } | null }> => {
      inserted.push(rows)
      return Promise.resolve({ error: null })
    }),
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) =>
      table === 'tasks'
        ? { select: vi.fn(() => ({ eq: h.selectTasks })), insert: h.insert }
        : { select: vi.fn(() => ({ eq: h.selectLabels })) },
    ),
  },
}))

vi.mock('../board/BoardDirectoryProvider', () => ({
  useBoardDirectoryContext: () => fakeBoardDirectory(),
  useBoardSession: () => fakeBoardSession(fakeBoardSummary({ role: h.role })),
}))
vi.mock('../labels/LabelDirectoryProvider', () => ({
  useLabelDirectoryContext: () => fakeLabelDirectory({ labels: h.destinationLabels }),
}))
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}))

import { DataSection } from './DataSection'

function task(over: Partial<TaskDraft> = {}): Task {
  return asTask({
    id: 'id-1',
    title: 'T',
    description: '',
    labelId: null,
    color: 'yellow',
    checklist: [],
    status: 'todo',
    completedAt: null,
    reopenStatus: null,
    archivedAt: null,
    day: '2026-07-10',
    order: 0,
    korder: 0,
    atTime: null,
    pinned: false,
    ...NO_RECUR,
    ...over,
  })
}

function legacyTask(over: Partial<LegacyTask> = {}): LegacyTask {
  const {
    labelId: _labelId,
    occurrenceDate,
    excludedDates,
    completedAt: _completedAt,
    reopenStatus: _reopenStatus,
    archivedAt: _archivedAt,
    status,
    ...base
  } = task()
  return {
    ...base,
    status: status === 'completed' ? 'done' : status,
    done: status === 'completed',
    recurOriginDay: occurrenceDate,
    recurSkip: excludedDates,
    category: 'work',
    ...over,
  } satisfies LegacyTask
}

function legacyExport(tasks: LegacyTask[], templates: LegacyTask[] = []): string {
  return JSON.stringify({
    version: 1,
    exportedAt: '2026-07-10T00:00:00Z',
    settings: { theme: 'glass', defaultView: 'agenda', weekStart: 1, timezone: 'UTC' },
    tasks,
    templates,
  })
}

type TaskRow = Database['public']['Tables']['tasks']['Row']

function taskRow(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'r1',
    board_id: 'b1',
    title: 'Exported',
    description: '',
    label_id: 'l-work',
    color: 'yellow',
    checklist: [],
    status: 'todo',
    completed_at: null,
    reopen_status: null,
    archived_at: null,
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

let exportedBlob: Blob | null = null

beforeEach(() => {
  h.inserted.length = 0
  h.role = 'owner'
  h.destinationLabels = [
    fakeLabel({ id: 'l-work', name: 'Work', position: 0 }),
    fakeLabel({ id: 'l-ideas', name: 'Ideas', dotColor: '#7c3aed', position: 1 }),
  ]
  h.selectTasks.mockReset().mockResolvedValue({ data: [], error: null })
  h.selectLabels.mockReset().mockResolvedValue({ data: [], error: null })
  h.insert.mockReset().mockImplementation((rows: unknown[]) => {
    h.inserted.push(rows)
    return Promise.resolve({ error: null })
  })
  exportedBlob = null
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn((blob: Blob) => {
      exportedBlob = blob
      return 'blob:test'
    }),
    revokeObjectURL: vi.fn(),
  })
})
afterEach(() => vi.unstubAllGlobals())

function importFile(json: string) {
  const input = screen.getByLabelText('Import file') as HTMLInputElement
  const file = new File([json], 'export.json', { type: 'application/json' })
  fireEvent.change(input, { target: { files: [file] } })
}

test('v2 import requires an explicit same-name mapping and inserts templates before instances', async () => {
  render(<DataSection />)
  const sourceLabels = [{ id: 'source-work', name: 'Work', dotColor: '#2563eb', position: 0 }]
  const template = task({ id: 'tpl-1', labelId: 'source-work', recurFreq: 'daily' })
  const instance = task({
    id: 'inst-1',
    labelId: 'source-work',
    recurParentId: 'tpl-1',
    occurrenceDate: '2026-07-10',
  })
  importFile(serializeExport([instance], [template], sourceLabels, 'x'))

  await screen.findByText(/1 task.*1 repeating series/i)
  const mapping = screen.getByRole('combobox', { name: 'Destination for Work' })
  expect(mapping).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()

  await userEvent.selectOptions(mapping, 'l-work')
  await userEvent.click(screen.getByRole('button', { name: 'Import' }))
  await waitFor(() => expect(h.inserted.length).toBe(2))

  const [templateBatch, taskBatch] = h.inserted as {
    recur_freq: string
    recur_parent_id: string | null
    id: string
    label_id: string | null
    label_assignment_explicit: boolean
  }[][]
  expect(templateBatch[0].recur_freq).toBe('daily')
  expect(taskBatch[0].recur_parent_id).toBe(templateBatch[0].id)
  expect(templateBatch[0].id).not.toBe('tpl-1')
  expect(templateBatch[0].label_id).toBe('l-work')
  expect(taskBatch[0].label_id).toBe('l-work')
})

test('v1 Categories use the same mapping UI and may map to Unlabeled without writing Category', async () => {
  render(<DataSection />)
  importFile(legacyExport([legacyTask({ category: 'ideas' })]))

  await screen.findByText(/1 task.*0 repeating series/i)
  const mapping = screen.getByRole('combobox', { name: 'Destination for Ideas' })
  expect(mapping).toHaveValue('')
  await userEvent.selectOptions(mapping, 'unlabeled')
  await userEvent.click(screen.getByRole('button', { name: 'Import' }))
  await waitFor(() => expect(h.inserted.length).toBe(1))

  const row = h.inserted[0][0] as Record<string, unknown>
  expect(row.label_id).toBeNull()
  // The compatibility columns left the payload entirely with the Category bridge that read them.
  expect(row).not.toHaveProperty('label_assignment_explicit')
  expect(row).not.toHaveProperty('category')
})

test('export downloads v3 with Board Labels and Completion fields, not settings or Category', async () => {
  h.selectTasks.mockResolvedValue({ data: [taskRow()], error: null })
  h.selectLabels.mockResolvedValue({
    data: [{ id: 'l-work', board_id: 'b1', name: 'Work', dot_color: '#2563eb', position: 0 }],
    error: null,
  })
  render(<DataSection />)

  await userEvent.click(screen.getByRole('button', { name: 'Export my data' }))
  await screen.findByText('Export downloaded.')
  if (!exportedBlob) throw new Error('export blob was not created')
  const exported = JSON.parse(await exportedBlob.text()) as {
    version: number
    labels: Array<Record<string, unknown>>
    tasks: Array<Record<string, unknown>>
    settings?: unknown
  }
  expect(exported.version).toBe(3)
  expect(exported.labels).toEqual([
    { id: 'l-work', name: 'Work', dotColor: '#2563eb', position: 0 },
  ])
  expect(exported.tasks[0].labelId).toBe('l-work')
  expect(exported.tasks[0]).toMatchObject({
    status: 'todo',
    completedAt: null,
    reopenStatus: null,
    archivedAt: null,
  })
  expect(exported.tasks[0]).not.toHaveProperty('done')
  expect(exported.tasks[0]).not.toHaveProperty('category')
  expect(exported).not.toHaveProperty('settings')
  expect(h.selectTasks).toHaveBeenCalledWith('board_id', 'b1')
  expect(h.selectLabels).toHaveBeenCalledWith('board_id', 'b1')
})

test.each([
  ['owner', false, false],
  ['editor', true, false],
  ['viewer', true, true],
] as const)(
  '%s capabilities gate export and import independently',
  (role, exportDisabled, importDisabled) => {
    h.role = role
    render(<DataSection />)
    expect(screen.getByRole('button', { name: 'Export my data' })).toHaveProperty(
      'disabled',
      exportDisabled,
    )
    expect(screen.getByRole('button', { name: 'Import from file…' })).toHaveProperty(
      'disabled',
      importDisabled,
    )
  },
)

test('an invalid file surfaces the validator error and inserts nothing', async () => {
  render(<DataSection />)
  importFile('{"version": 99}')
  await screen.findByText(/Unsupported export version/)
  expect(h.inserted.length).toBe(0)
})

test('a batch failure keeps the prepared rows; retrying resumes without re-inserting', async () => {
  render(<DataSection />)
  const sourceLabels = [{ id: 'source-work', name: 'Work', dotColor: '#2563eb', position: 0 }]
  const template = task({ id: 'tpl-1', labelId: 'source-work', recurFreq: 'daily' })
  const instance = task({
    id: 'inst-1',
    labelId: 'source-work',
    recurParentId: 'tpl-1',
    occurrenceDate: '2026-07-10',
  })
  importFile(serializeExport([instance], [template], sourceLabels, 'x'))
  await screen.findByText(/1 task.*1 repeating series/i)
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'Destination for Work' }),
    'l-work',
  )

  h.insert.mockImplementationOnce((rows: unknown[]) => {
    h.inserted.push(rows)
    return Promise.resolve({ error: null })
  })
  h.insert.mockImplementationOnce(() => Promise.resolve({ error: { message: 'boom' } }))

  await userEvent.click(screen.getByRole('button', { name: 'Import' }))
  await screen.findByText(/Import failed partway/)
  expect(h.inserted.length).toBe(1)
  expect(screen.getByRole('combobox', { name: 'Destination for Work' })).toBeDisabled()
  const firstTemplateId = (h.inserted[0][0] as { id: string }).id

  await userEvent.click(screen.getByRole('button', { name: 'Resume import' }))
  await waitFor(() => expect(h.inserted.length).toBe(2))
  await screen.findByText(/Imported 1 task.*1 repeating series/i)
  expect((h.inserted[0][0] as { id: string }).id).toBe(firstTemplateId)
  expect((h.inserted[1][0] as { recur_parent_id: string }).recur_parent_id).toBe(firstTemplateId)
})

test('a rejected insert keeps resume state and clears busy', async () => {
  render(<DataSection />)
  importFile(serializeExport([task()], [], [], 'x'))
  await screen.findByText(/1 task.*0 repeating series/i)
  h.insert.mockImplementationOnce(() => Promise.reject(new Error('network exploded')))

  await userEvent.click(screen.getByRole('button', { name: 'Import' }))
  await screen.findByText(/Import failed partway/)
  expect(await screen.findByRole('button', { name: 'Resume import' })).toBeEnabled()
})

test('export clears busy and surfaces an error when the load throws', async () => {
  h.selectTasks.mockImplementationOnce(() => Promise.reject(new Error('network exploded')))
  render(<DataSection />)
  const exportButton = screen.getByRole('button', { name: 'Export my data' })
  await userEvent.click(exportButton)
  expect(await screen.findByText(/Could not load your data/)).toBeInTheDocument()
  expect(exportButton).toBeEnabled()
})
