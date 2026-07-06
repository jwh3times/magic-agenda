import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { serializeExport } from '../data/exportImport'
import { NO_RECUR, type Task } from '../types/task'

const h = vi.hoisted(() => {
  const inserted: unknown[][] = []
  return {
    inserted,
    selectTasks: vi.fn(() => Promise.resolve({ data: [], error: null })),
    maybeSingle: vi.fn(() =>
      Promise.resolve({ data: { theme: 'cork', default_view: 'calendar' }, error: null }),
    ),
    insert: vi.fn((rows: unknown[]) => {
      inserted.push(rows)
      return Promise.resolve({ error: null })
    }),
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) =>
      table === 'tasks'
        ? { select: h.selectTasks, insert: h.insert }
        : { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: h.maybeSingle })) })) },
    ),
  },
}))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}))

import { DataSection } from './DataSection'

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

beforeEach(() => {
  h.inserted.length = 0
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:test'),
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
    serializeExport([instance], [template], { theme: 'cork', defaultView: 'calendar' }, 'x'),
  )

  await screen.findByText(/1 task.*1 repeating series/i)
  await userEvent.click(screen.getByRole('button', { name: 'Import' }))
  await waitFor(() => expect(h.inserted.length).toBe(2))

  const [firstBatch, secondBatch] = h.inserted as {
    recur_freq: string
    recur_parent_id: string | null
    id: string
  }[][]
  expect(firstBatch[0].recur_freq).toBe('daily') // templates first (FK)
  expect(secondBatch[0].recur_parent_id).toBe(firstBatch[0].id) // link preserved
  expect(firstBatch[0].id).not.toBe('tpl-1') // fresh ids
})

test('an invalid file surfaces the validator error and inserts nothing', async () => {
  render(<DataSection />)
  importFile('{"version": 99}')
  await screen.findByText(/Unsupported export version/)
  expect(h.inserted.length).toBe(0)
})
