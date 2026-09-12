import { expect, test } from 'vitest'
import { archiveDecision, completionDecision, isArchived } from './completion'

const completedAt = '2026-09-03T14:15:00.000Z'

test('Completing remembers In Progress and establishes Completed At', () => {
  expect(
    completionDecision(
      { status: 'doing', completedAt: null, reopenStatus: 'todo', archivedAt: null },
      'toggle',
      completedAt,
    ),
  ).toEqual({
    status: 'completed',
    completedAt,
    reopenStatus: 'doing',
    archivedAt: null,
  })
})

test('quick Reopen returns to the remembered active status and clears Completion and Archive', () => {
  expect(
    completionDecision(
      {
        status: 'completed',
        completedAt: '2026-09-01T09:00:00.000Z',
        reopenStatus: 'doing',
        archivedAt: '2026-09-02T09:00:00.000Z',
      },
      'toggle',
      completedAt,
    ),
  ).toEqual({
    status: 'doing',
    completedAt: null,
    reopenStatus: 'doing',
    archivedAt: null,
  })
})

test.each(['todo', 'doing'] as const)(
  'an explicit Kanban move reopens Completed directly to %s',
  (status) => {
    expect(
      completionDecision(
        {
          status: 'completed',
          completedAt: '2026-09-01T09:00:00.000Z',
          reopenStatus: status === 'todo' ? 'doing' : 'todo',
          archivedAt: '2026-09-02T09:00:00.000Z',
        },
        status,
        completedAt,
      ),
    ).toEqual({ status, completedAt: null, reopenStatus: status, archivedAt: null })
  },
)

test('an ordinary edit that remains Completed preserves its lifecycle timestamps', () => {
  const current = {
    status: 'completed' as const,
    completedAt: '2026-09-01T09:00:00.000Z',
    reopenStatus: 'todo' as const,
    archivedAt: '2026-09-02T09:00:00.000Z',
  }

  expect(completionDecision(current, 'completed', completedAt)).toEqual(current)
})

const archivedAt = '2026-09-04T08:00:00.000Z'
const completed = {
  status: 'completed' as const,
  completedAt: '2026-09-01T09:00:00.000Z',
  reopenStatus: 'doing' as const,
  archivedAt: null,
}

test('Archiving a Completed Task keeps it Completed and preserves Completed At', () => {
  expect(archiveDecision(completed, 'archive', archivedAt)).toEqual({ ...completed, archivedAt })
})

test('Archiving an already-Archived Task keeps the original Archive instant', () => {
  const original = { ...completed, archivedAt: '2026-09-02T08:00:00.000Z' }
  expect(archiveDecision(original, 'archive', archivedAt)).toEqual(original)
})

test('Archiving an active Task is refused: only a Completed Task may be Archived', () => {
  const active = {
    status: 'todo' as const,
    completedAt: null,
    reopenStatus: 'todo' as const,
    archivedAt: null,
  }
  expect(archiveDecision(active, 'archive', archivedAt)).toEqual(active)
})

test('Unarchiving returns the Task still Completed with Completed At unchanged', () => {
  const archived = { ...completed, archivedAt }
  expect(archiveDecision(archived, 'unarchive', archivedAt)).toEqual(completed)
})

test('Reopening an Archived Task unarchives it and restores the remembered active status', () => {
  const archived = { ...completed, archivedAt }
  expect(completionDecision(archived, 'toggle', archivedAt)).toEqual({
    status: 'doing',
    completedAt: null,
    reopenStatus: 'doing',
    archivedAt: null,
  })
})

test('isArchived reads the durable Archive instant', () => {
  expect(isArchived({ archivedAt })).toBe(true)
  expect(isArchived({ archivedAt: null })).toBe(false)
})
