import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => {
  const capture: { rows: unknown[]; error: { message: string } | null } = {
    rows: [],
    error: null,
  }
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({ data: capture.rows, error: capture.error })),
        })),
      })),
    })),
  }))
  return { capture, from }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: h.from } }))

import { readLabelSnapshot, writeLabelSnapshot } from '../data/snapshot'
import { useLabels } from './useLabels'

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  board_id: 'b1',
  name: `Label ${id}`,
  dot_color: '#2563eb',
  position: 0,
  ...over,
})

beforeEach(() => {
  localStorage.clear()
  h.capture.rows = [row('l1')]
  h.capture.error = null
  h.from.mockClear()
})

test('loads the selected Board’s labels and stores an offline snapshot', async () => {
  const { result } = renderHook(() => useLabels('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  expect(result.current.labels).toEqual([
    { id: 'l1', boardId: 'b1', name: 'Label l1', dotColor: '#2563eb', position: 0 },
  ])
  expect(result.current.offline).toBe(false)
  expect(readLabelSnapshot('u1', 'b1')?.labels).toEqual(result.current.labels)
})

test('falls back to the selected Board’s snapshot when loading fails', async () => {
  writeLabelSnapshot('u1', 'b1', [
    { id: 'cached', boardId: 'b1', name: 'Cached', dotColor: '#dc2626', position: 2 },
  ])
  h.capture.error = { message: 'FetchError: Failed to fetch' }

  const { result } = renderHook(() => useLabels('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))

  expect(result.current.labels.map((label) => label.id)).toEqual(['cached'])
  expect(result.current.offline).toBe(true)
  expect(result.current.error).toBeNull()
})

test('a sessionless successful read never overwrites a Label snapshot', async () => {
  writeLabelSnapshot('u1', 'b1', [
    { id: 'cached', boardId: 'b1', name: 'Cached', dotColor: '#dc2626', position: 2 },
  ])
  h.capture.rows = []

  const { result } = renderHook(() => useLabels('u1', 'b1', false))
  await waitFor(() => expect(result.current.loading).toBe(false))

  expect(result.current.labels).toEqual([])
  expect(readLabelSnapshot('u1', 'b1')?.labels.map((label) => label.id)).toEqual(['cached'])
})

test('reloads labels when the browser comes back online', async () => {
  const { result } = renderHook(() => useLabels('u1', 'b1', true))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(h.from).toHaveBeenCalledTimes(1)

  h.capture.rows = [row('l2')]
  await act(() => {
    window.dispatchEvent(new Event('online'))
    return Promise.resolve()
  })
  await waitFor(() => expect(result.current.labels[0]?.id).toBe('l2'))
  expect(h.from).toHaveBeenCalledTimes(2)
})
