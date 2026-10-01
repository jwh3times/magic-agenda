import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  updateSelect: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      h.from(table)
      return {
        select: () => ({
          eq: (column: string, value: string) => {
            h.eq(column, value)
            return { maybeSingle: h.maybeSingle }
          },
        }),
        update: (patch: unknown) => {
          h.update(patch)
          return {
            eq: (column: string, value: string) => {
              h.eq(column, value)
              return { select: h.updateSelect }
            },
          }
        },
      }
    },
  },
}))

import {
  DISPLAY_NAME_MAX,
  displayNameError,
  loadDisplayName,
  normalizeDisplayName,
  saveDisplayName,
} from './accountProfile'

beforeEach(() => vi.resetAllMocks())

test('a name is trimmed, and its limit counts code points like PostgreSQL char_length', () => {
  expect(normalizeDisplayName('  Ada Lovelace \n')).toBe('Ada Lovelace')
  expect(displayNameError('a'.repeat(DISPLAY_NAME_MAX))).toBeNull()
  expect(displayNameError('a'.repeat(DISPLAY_NAME_MAX + 1))).toMatch(/at most 80/)
  // Each emoji is two UTF-16 units but one code point, so 80 of them still fit.
  expect(displayNameError('😀'.repeat(DISPLAY_NAME_MAX))).toBeNull()
  expect(displayNameError('')).toBeNull()
})

test('loads the caller’s own row, and reads a missing row as unset', async () => {
  h.maybeSingle.mockResolvedValueOnce({ data: { display_name: 'Ada' }, error: null })
  expect(await loadDisplayName('acct-1')).toEqual({ ok: true, data: 'Ada' })
  expect(h.from).toHaveBeenCalledWith('account_profiles')
  expect(h.eq).toHaveBeenCalledWith('account_id', 'acct-1')

  h.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
  expect(await loadDisplayName('acct-1')).toEqual({ ok: true, data: '' })

  h.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
  expect(await loadDisplayName('acct-1')).toEqual({ ok: false, message: 'boom' })
})

test('saves the trimmed name and returns it as stored', async () => {
  h.updateSelect.mockResolvedValue({ data: [{ display_name: 'Ada' }], error: null })
  expect(await saveDisplayName('acct-1', '  Ada  ')).toEqual({ ok: true, data: 'Ada' })
  expect(h.update).toHaveBeenCalledWith({ display_name: 'Ada' })
  expect(h.eq).toHaveBeenCalledWith('account_id', 'acct-1')
})

test('an over-length name is refused before any write', async () => {
  const result = await saveDisplayName('acct-1', 'x'.repeat(DISPLAY_NAME_MAX + 1))
  expect(result.ok).toBe(false)
  expect(h.update).not.toHaveBeenCalled()
})

test('a write that matched no row is a failure, not a silent success', async () => {
  // PostgREST answers an UPDATE that RLS filtered out with zero rows and no error.
  h.updateSelect.mockResolvedValue({ data: [], error: null })
  const result = await saveDisplayName('acct-1', 'Ada')
  expect(result.ok).toBe(false)
  expect(!result.ok && result.message).toMatch(/not saved/)
})

test('a database error is passed through', async () => {
  h.updateSelect.mockResolvedValue({ data: null, error: { message: 'violates check' } })
  expect(await saveDisplayName('acct-1', 'Ada')).toEqual({ ok: false, message: 'violates check' })
})
