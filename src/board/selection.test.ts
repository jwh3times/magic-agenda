import { describe, expect, test } from 'vitest'
import { purgeableBoardIds, resolveSelection, selectedBoard, type BoardSummary } from './selection'

const board = (id: string, over: Partial<BoardSummary> = {}): BoardSummary => ({
  id,
  name: `Board ${id}`,
  role: 'owner',
  defaultView: 'calendar',
  membershipId: `m-${id}`,
  ...over,
})

describe('resolveSelection', () => {
  test('keeps the remembered board when it still exists', () => {
    expect(resolveSelection([board('a'), board('b')], 'b')).toBe('b')
  })

  test('falls back to the first board when nothing is remembered', () => {
    expect(resolveSelection([board('a'), board('b')], null)).toBe('a')
    expect(resolveSelection([board('a'), board('b')], undefined)).toBe('a')
    expect(resolveSelection([board('a'), board('b')], '')).toBe('a')
  })

  test('falls back rather than erroring when the remembered board is gone', () => {
    // What a deleted board, a revoked membership, and a stale device all look like from the client.
    // The server does not distinguish them, so neither can this — and degrading to another board
    // beats an empty screen with no explanation.
    expect(resolveSelection([board('a')], 'deleted-board')).toBe('a')
  })

  test('returns null when there are no boards', () => {
    // A real state the domain model allows, not an error: an account may have zero boards after
    // leaving or deleting its last one. The product offers creating or joining one; it must never
    // silently mint another.
    expect(resolveSelection([], 'anything')).toBeNull()
    expect(resolveSelection([], null)).toBeNull()
  })

  test('is stable across repeated calls with the same input', () => {
    const boards = [board('a'), board('b'), board('c')]
    expect(resolveSelection(boards, null)).toBe(resolveSelection(boards, null))
  })
})

describe('selectedBoard', () => {
  test('returns the whole summary, not just the id', () => {
    const boards = [board('a'), board('b', { name: 'Work', role: 'editor' })]
    expect(selectedBoard(boards, 'b')).toEqual(
      expect.objectContaining({ id: 'b', name: 'Work', role: 'editor' }),
    )
  })

  test('returns null when nothing resolves', () => {
    expect(selectedBoard([], 'a')).toBeNull()
  })
})

describe('purgeableBoardIds', () => {
  test('names cached boards the server no longer returns', () => {
    expect(purgeableBoardIds(['a', 'gone'], [board('a')])).toEqual(['gone'])
  })

  test('purges everything when the server returns no boards', () => {
    // The direction that matters. Computing from the server's list means "you are in no boards"
    // correctly drops every cached board. Computing from the cache and removing what looks gone
    // would preserve all of them here — the exact inversion this function exists to prevent.
    expect(purgeableBoardIds(['a', 'b'], [])).toEqual(['a', 'b'])
  })

  test('purges nothing when the cache is a subset of the server list', () => {
    expect(purgeableBoardIds(['a'], [board('a'), board('b')])).toEqual([])
  })

  test('purges nothing when the cache is empty', () => {
    expect(purgeableBoardIds([], [board('a')])).toEqual([])
  })
})
