import { describe, expect, test } from 'vitest'
import { fakeLabel } from './fakeLabelDirectory'
import {
  changedPositions,
  checkColor,
  checkName,
  explainProblem,
  isLastLabel,
  labelProblemFromError,
  moveLabel,
  NAME_MAX_LENGTH,
  nextPosition,
  normalizeName,
} from './labelIntent'

const vocabulary = [
  fakeLabel({ id: 'a', name: 'Work', position: 0 }),
  fakeLabel({ id: 'b', name: 'Personal', position: 1 }),
  fakeLabel({ id: 'c', name: 'Errands', position: 2 }),
]

describe('normalizeName', () => {
  test('trims to match the labels_name_trimmed constraint', () => {
    expect(normalizeName('  Work  ')).toBe('Work')
  })

  test('preserves internal spacing and casing', () => {
    expect(normalizeName('  Deep  Work ')).toBe('Deep  Work')
  })
})

describe('checkName', () => {
  test('accepts a fresh name', () => {
    expect(checkName('Chores', vocabulary)).toBeNull()
  })

  test('rejects blank and whitespace-only names', () => {
    expect(checkName('', vocabulary)).toEqual({ reason: 'empty' })
    expect(checkName('   ', vocabulary)).toEqual({ reason: 'empty' })
  })

  test('rejects a name past the database maximum', () => {
    expect(checkName('x'.repeat(NAME_MAX_LENGTH + 1), vocabulary)).toEqual({
      reason: 'too-long',
      max: NAME_MAX_LENGTH,
    })
    expect(checkName('x'.repeat(NAME_MAX_LENGTH), vocabulary)).toBeNull()
  })

  test('detects a conflict case-insensitively, like labels_board_name_ci_uniq', () => {
    expect(checkName('work', vocabulary)).toEqual({ reason: 'duplicate-name', existing: 'Work' })
    expect(checkName('  WORK  ', vocabulary)).toEqual({
      reason: 'duplicate-name',
      existing: 'Work',
    })
  })

  test('a Label does not conflict with itself when renaming', () => {
    expect(checkName('work', vocabulary, 'a')).toBeNull()
    // ...but it still conflicts with a sibling.
    expect(checkName('Personal', vocabulary, 'a')).toEqual({
      reason: 'duplicate-name',
      existing: 'Personal',
    })
  })
})

describe('checkColor', () => {
  test('accepts six-digit hex in either case', () => {
    expect(checkColor('#2563eb')).toBeNull()
    expect(checkColor('#2563EB')).toBeNull()
  })

  test('rejects anything the labels_dot_color_hex constraint would', () => {
    for (const bad of ['2563eb', '#fff', '#2563e', '#2563ebb', 'red', '']) {
      expect(checkColor(bad)).toEqual({ reason: 'bad-color' })
    }
  })
})

describe('nextPosition', () => {
  test('appends after a dense vocabulary', () => {
    expect(nextPosition(vocabulary)).toBe(3)
  })

  test('is zero for the first Label on a Board', () => {
    expect(nextPosition([])).toBe(0)
  })
})

describe('moveLabel', () => {
  test('moves one place down and renumbers densely', () => {
    const next = moveLabel(vocabulary, 'a', 1)
    expect(next?.map((l) => [l.id, l.position])).toEqual([
      ['b', 0],
      ['a', 1],
      ['c', 2],
    ])
  })

  test('moves one place up', () => {
    const next = moveLabel(vocabulary, 'c', -1)
    expect(next?.map((l) => l.id)).toEqual(['a', 'c', 'b'])
  })

  test('returns null at either end rather than writing nothing', () => {
    expect(moveLabel(vocabulary, 'a', -1)).toBeNull()
    expect(moveLabel(vocabulary, 'c', 1)).toBeNull()
  })

  test('returns null for a zero move and for an unknown id', () => {
    expect(moveLabel(vocabulary, 'a', 0)).toBeNull()
    expect(moveLabel(vocabulary, 'nope', 1)).toBeNull()
  })

  test('repairs sparse or duplicated positions while moving', () => {
    const sparse = [
      fakeLabel({ id: 'a', position: 5 }),
      fakeLabel({ id: 'b', position: 5 }),
      fakeLabel({ id: 'c', position: 90 }),
    ]
    // Ties break by id, so the incoming order is a, b, c.
    expect(moveLabel(sparse, 'c', -1)?.map((l) => [l.id, l.position])).toEqual([
      ['a', 0],
      ['c', 1],
      ['b', 2],
    ])
  })

  test('does not mutate the input', () => {
    const before = vocabulary.map((l) => ({ ...l }))
    moveLabel(vocabulary, 'a', 1)
    expect(vocabulary).toEqual(before)
  })
})

describe('changedPositions', () => {
  test('returns only the rows a one-place swap actually moved', () => {
    const after = moveLabel(vocabulary, 'a', 1)
    expect(after).not.toBeNull()
    expect(
      changedPositions(vocabulary, after ?? [])
        .map((l) => l.id)
        .sort(),
    ).toEqual(['a', 'b'])
  })

  test('is empty when nothing moved', () => {
    expect(changedPositions(vocabulary, vocabulary)).toEqual([])
  })

  test('includes every row when a sparse vocabulary is renumbered', () => {
    const sparse = [fakeLabel({ id: 'a', position: 4 }), fakeLabel({ id: 'b', position: 9 })]
    const after = moveLabel(sparse, 'a', 1) ?? []
    expect(
      changedPositions(sparse, after)
        .map((l) => l.id)
        .sort(),
    ).toEqual(['a', 'b'])
  })
})

describe('isLastLabel', () => {
  test('is true only for the sole remaining Label', () => {
    expect(isLastLabel([vocabulary[0]], 'a')).toBe(true)
    expect(isLastLabel(vocabulary, 'a')).toBe(false)
    expect(isLastLabel([vocabulary[0]], 'b')).toBe(false)
    expect(isLastLabel([], 'a')).toBe(false)
  })
})

describe('labelProblemFromError', () => {
  test('maps the case-insensitive unique index to a duplicate name', () => {
    expect(
      labelProblemFromError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "labels_board_name_ci_uniq"',
      }),
    ).toEqual({ reason: 'duplicate-name', existing: '' })
  })

  test('a different unique violation is not silently called a duplicate name', () => {
    const problem = labelProblemFromError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "labels_board_legacy_category_uniq"',
    })
    expect(problem.reason).toBe('unknown')
  })

  test('maps each check constraint to its own reason', () => {
    expect(
      labelProblemFromError({ code: '23514', message: 'violates ... "labels_dot_color_hex"' }),
    ).toEqual({ reason: 'bad-color' })
    expect(
      labelProblemFromError({ code: '23514', message: 'violates ... "labels_name_trimmed"' }),
    ).toEqual({ reason: 'empty' })
  })

  test('a grant or RLS refusal reads as not-allowed', () => {
    expect(labelProblemFromError({ code: '42501', message: 'permission denied' })).toEqual({
      reason: 'not-allowed',
    })
    expect(labelProblemFromError({ code: 'PGRST116', message: 'no rows' })).toEqual({
      reason: 'not-allowed',
    })
  })

  test('an unmapped code keeps the vendor text rather than going silent', () => {
    expect(labelProblemFromError({ code: '08006', message: 'connection failure' })).toEqual({
      reason: 'unknown',
      message: 'connection failure',
    })
  })

  test('a missing error still yields a renderable sentence', () => {
    expect(explainProblem(labelProblemFromError(null))).toBe('Could not save the label.')
  })
})

describe('explainProblem', () => {
  test('names the conflicting Label when the client caught it', () => {
    expect(explainProblem({ reason: 'duplicate-name', existing: 'Work' })).toContain('Work')
  })

  test('falls back to a general sentence when the database caught it', () => {
    expect(explainProblem({ reason: 'duplicate-name', existing: '' })).toBe(
      'Another label already uses that name.',
    )
  })

  test('every reason produces non-empty text', () => {
    const all = [
      { reason: 'empty' },
      { reason: 'too-long', max: 80 },
      { reason: 'duplicate-name', existing: 'x' },
      { reason: 'bad-color' },
      { reason: 'not-allowed' },
      { reason: 'unknown', message: 'boom' },
    ] as const
    for (const problem of all) expect(explainProblem(problem).length).toBeGreaterThan(0)
  })
})
