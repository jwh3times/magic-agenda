import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { serializeExport, type LegacyTask } from '../data/exportImport'
import { NO_RECUR } from '../types/task'
import { fakeBoardDirectory } from '../board/fakeBoardDirectory'
import type { Database } from '../types/database.types'

const h = vi.hoisted(() => {
  const inserted: unknown[][] = []
  return {
    inserted,
    selectTasks: vi.fn(() => Promise.resolve({ data: [] as unknown[], error: null })),
    selectLabels: vi.fn(() => Promise.resolve({ data: [] as unknown[], error: null })),
    maybeSingle: vi.fn(() =>
      Promise.resolve({ data: { theme: 'cork', default_view: 'calendar' }, error: null }),
    ),
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
        : table === 'labels'
          ? { select: vi.fn(() => ({ eq: h.selectLabels })) }
          : { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: h.maybeSingle })) })) },
    ),
  },
}))

vi.mock('../board/BoardDirectoryProvider', () => ({
  useBoardDirectoryContext: () => fakeBoardDirectory(),
}))
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}))

import { DataSection } from './DataSection'

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

function taskRow(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'r1',
    user_id: 'u1',
    board_id: 'b1',
    title: 'Exported',
    description: '',
    category: 'work',
    label_id: 'l-errands',
    label_assignment_explicit: true,
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

let exportedBlob: Blob | null = null

beforeEach(() => {
  h.inserted.length = 0
  h.selectTasks.mockReset().mockResolvedValue({ data: [], error: null })
  h.selectLabels.mockReset().mockResolvedValue({ data: [], error: null })
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

test('a valid file shows a summary; confirming inserts templates before instances', async () => {
  render(<DataSection />)
  const template = mk({ id: 'tpl-1', recurFreq: 'daily' })
  const instance = mk({ id: 'inst-1', recurParentId: 'tpl-1', recurOriginDay: '2026-07-10' })
  importFile(
    serializeExport(
      [instance],
      [template],
      { theme: 'cork', defaultView: 'calendar', weekStart: 0, timezone: null },
      'x',
    ),
  )

  await screen.findByText(/1 task.*1 repeating series/i)
  await userEvent.click(screen.getByRole('button', { name: 'Import' }))
  await waitFor(() => expect(h.inserted.length).toBe(2))

  const [firstBatch, secondBatch] = h.inserted as {
    recur_freq: string
    recur_parent_id: string | null
    id: string
    category: string
    label_assignment_explicit: boolean
  }[][]
  expect(firstBatch[0].recur_freq).toBe('daily') // templates first (FK)
  expect(secondBatch[0].recur_parent_id).toBe(firstBatch[0].id) // link preserved
  expect(firstBatch[0].id).not.toBe('tpl-1') // fresh ids
  expect(firstBatch[0].category).toBe('work')
  expect(firstBatch[0].label_assignment_explicit).toBe(false)
})

test('v1 export uses the canonical Label alias while keeping the file Category-shaped', async () => {
  h.selectTasks.mockResolvedValue({ data: [taskRow()], error: null })
  h.selectLabels.mockResolvedValue({
    data: [{ id: 'l-errands', legacy_category: 'errands' }],
    error: null,
  })
  render(<DataSection />)

  await userEvent.click(screen.getByRole('button', { name: 'Export my data' }))
  await screen.findByText('Export downloaded.')
  if (!exportedBlob) throw new Error('export blob was not created')
  const exported = JSON.parse(await exportedBlob.text()) as {
    tasks: Array<Record<string, unknown>>
  }
  expect(exported.tasks[0].category).toBe('errands')
  expect(exported.tasks[0]).not.toHaveProperty('labelId')
})

test('an invalid file surfaces the validator error and inserts nothing', async () => {
  render(<DataSection />)
  importFile('{"version": 99}')
  await screen.findByText(/Unsupported export version/)
  expect(h.inserted.length).toBe(0)
})

test('a batch failure keeps the remapped batches; retrying resumes without re-inserting', async () => {
  render(<DataSection />)
  const template = mk({ id: 'tpl-1', recurFreq: 'daily' })
  const instance = mk({ id: 'inst-1', recurParentId: 'tpl-1', recurOriginDay: '2026-07-10' })
  importFile(
    serializeExport(
      [instance],
      [template],
      { theme: 'cork', defaultView: 'calendar', weekStart: 0, timezone: null },
      'x',
    ),
  )
  await screen.findByText(/1 task.*1 repeating series/i)

  // First attempt: templates batch succeeds, tasks batch fails.
  h.insert.mockImplementationOnce((rows: unknown[]) => {
    h.inserted.push(rows)
    return Promise.resolve({ error: null })
  })
  h.insert.mockImplementationOnce(() => Promise.resolve({ error: { message: 'boom' } }))

  await userEvent.click(screen.getByRole('button', { name: 'Import' }))
  await screen.findByText(/Import failed partway/)
  expect(h.inserted.length).toBe(1) // only the templates batch made it in

  const [templateBatchFirst] = h.inserted as { recur_freq: string; id: string }[][]
  const firstTemplateId = templateBatchFirst[0].id

  // Retry: must resume from the tasks batch, not re-remap (which would insert the template again).
  await userEvent.click(screen.getByRole('button', { name: 'Resume import' }))
  await waitFor(() => expect(h.inserted.length).toBe(2))
  await screen.findByText(/Imported 1 tasks? and 1 repeating series/i)

  const [templateBatch, taskBatch] = h.inserted as {
    recur_freq: string
    recur_parent_id: string | null
    id: string
  }[][]
  expect(templateBatch[0].id).toBe(firstTemplateId) // same insert as before — not duplicated
  expect(taskBatch[0].recur_parent_id).toBe(firstTemplateId) // link preserved through the resume
})

test('a thrown (rejected) insert keeps the resume state and clears busy, like a resolved error', async () => {
  render(<DataSection />)
  const template = mk({ id: 'tpl-1', recurFreq: 'daily' })
  const instance = mk({ id: 'inst-1', recurParentId: 'tpl-1', recurOriginDay: '2026-07-10' })
  importFile(
    serializeExport(
      [instance],
      [template],
      { theme: 'cork', defaultView: 'calendar', weekStart: 0, timezone: null },
      'x',
    ),
  )
  await screen.findByText(/1 task.*1 repeating series/i)

  // First attempt: templates batch succeeds, tasks batch THROWS instead of resolving an error.
  h.insert.mockImplementationOnce((rows: unknown[]) => {
    h.inserted.push(rows)
    return Promise.resolve({ error: null })
  })
  h.insert.mockImplementationOnce(() => Promise.reject(new Error('network exploded')))

  const importBtn = screen.getByRole('button', { name: 'Import' })
  await userEvent.click(importBtn)
  await screen.findByText(/Import failed partway/)
  expect(h.inserted.length).toBe(1) // only the templates batch made it in

  // Busy cleared: the button is re-enabled and now offers Resume, not stuck disabled.
  const resumeBtn = await screen.findByRole('button', { name: 'Resume import' })
  expect(resumeBtn).toBeEnabled()

  const [templateBatchFirst] = h.inserted as { recur_freq: string; id: string }[][]
  const firstTemplateId = templateBatchFirst[0].id

  // Retry: resumes from the failed cursor instead of losing the batches/re-remapping.
  await userEvent.click(resumeBtn)
  await waitFor(() => expect(h.inserted.length).toBe(2))
  await screen.findByText(/Imported 1 tasks? and 1 repeating series/i)

  const [templateBatch, taskBatch] = h.inserted as {
    recur_freq: string
    recur_parent_id: string | null
    id: string
  }[][]
  expect(templateBatch[0].id).toBe(firstTemplateId)
  expect(taskBatch[0].recur_parent_id).toBe(firstTemplateId)
})

test('exportBoard clears busy and surfaces an error when the load throws', async () => {
  h.selectTasks.mockImplementationOnce(() => Promise.reject(new Error('network exploded')))
  render(<DataSection />)
  const exportBtn = screen.getByRole('button', { name: 'Export my data' })
  await userEvent.click(exportBtn)
  expect(await screen.findByText(/Could not load your data/)).toBeInTheDocument()
  expect(exportBtn).toBeEnabled()
})
