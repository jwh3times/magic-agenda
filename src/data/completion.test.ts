import { expect, test } from 'vitest'
import { completionDecision } from './completion'

const completedAt = '2026-09-03T14:15:00.000Z'

test('Completing remembers In Progress and establishes Completed At', () => {
  expect(
    completionDecision(
      { status: 'doing', completedAt: null, reopenStatus: null, archivedAt: null },
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

test('quick Reopen falls back to To Do when a legacy Completed Task has no memory', () => {
  expect(
    completionDecision(
      { status: 'completed', completedAt: null, reopenStatus: null, archivedAt: null },
      'toggle',
      completedAt,
    ).status,
  ).toBe('todo')
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
