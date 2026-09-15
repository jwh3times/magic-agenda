import { describe, expect, test } from 'vitest'
import { asTask, NO_RECUR, type Task, type TaskDraft } from '../types/task'
import { dueMoment, isOverdue, nextOverdueChangeAt } from './dueMoment'

function task(over: Partial<TaskDraft> = {}): Task {
  return asTask({
    id: 'task-1',
    title: 'Task',
    description: '',
    labelId: null,
    color: 'yellow',
    checklist: [],
    status: 'todo',
    completedAt: null,
    reopenStatus: 'todo',
    archivedAt: null,
    day: '2026-07-10',
    atTime: null,
    pinned: false,
    order: 0,
    korder: 0,
    ...NO_RECUR,
    ...over,
  })
}

describe('dueMoment', () => {
  test('maps a Due Time to an instant in the Account Timezone', () => {
    const timed = task({ atTime: '09:30' })
    expect(dueMoment(timed, 'UTC')).toEqual({
      kind: 'timed',
      instantMs: Date.parse('2026-07-10T09:30:00.000Z'),
      overdueAtMs: Date.parse('2026-07-10T09:30:00.001Z'),
    })
    expect(dueMoment(timed, 'America/New_York')?.instantMs).toBe(
      Date.parse('2026-07-10T13:30:00.000Z'),
    )
    expect(dueMoment(timed, 'America/Los_Angeles')?.instantMs).toBe(
      Date.parse('2026-07-10T16:30:00.000Z'),
    )
    expect(dueMoment(timed, null)).toEqual(
      dueMoment(timed, Intl.DateTimeFormat().resolvedOptions().timeZone),
    )
  })

  test('uses the next local midnight as an untimed Due Moment', () => {
    expect(dueMoment(task(), 'America/New_York')).toEqual({
      kind: 'untimed',
      instantMs: Date.parse('2026-07-11T04:00:00.000Z'),
      overdueAtMs: Date.parse('2026-07-11T04:00:00.000Z'),
    })
  })

  test('uses compatible disambiguation across daylight-saving transitions', () => {
    // Fall-back 01:30 occurs twice. Compatible disambiguation chooses the first occurrence.
    expect(
      dueMoment(task({ day: '2026-11-01', atTime: '01:30' }), 'America/New_York')?.instantMs,
    ).toBe(Date.parse('2026-11-01T05:30:00.000Z'))

    // Spring-forward 02:30 does not exist. Compatible disambiguation moves it forward by the gap.
    expect(
      dueMoment(task({ day: '2026-03-08', atTime: '02:30' }), 'America/New_York')?.instantMs,
    ).toBe(Date.parse('2026-03-08T07:30:00.000Z'))
  })

  test('Inbox has no Due Moment and an invalid Due Time falls back to the day boundary', () => {
    expect(dueMoment(task({ day: 'inbox', atTime: null }), 'UTC')).toBeNull()
    expect(dueMoment(task({ atTime: 'not-a-time' }), 'UTC')).toEqual({
      kind: 'untimed',
      instantMs: Date.parse('2026-07-11T00:00:00.000Z'),
      overdueAtMs: Date.parse('2026-07-11T00:00:00.000Z'),
    })
  })
})

describe('isOverdue', () => {
  test('uses exact timed and untimed boundaries while excluding Completed and Inbox Tasks', () => {
    const timed = task({ atTime: '09:00' })
    expect(isOverdue(timed, Date.parse('2026-07-10T09:00:00.000Z'), 'UTC')).toBe(false)
    expect(isOverdue(timed, Date.parse('2026-07-10T09:00:00.001Z'), 'UTC')).toBe(true)

    const untimed = task()
    expect(isOverdue(untimed, Date.parse('2026-07-10T23:59:59.999Z'), 'UTC')).toBe(false)
    expect(isOverdue(untimed, Date.parse('2026-07-11T00:00:00.000Z'), 'UTC')).toBe(true)
    expect(
      isOverdue(
        task({ status: 'completed', completedAt: '2026-07-10T08:00:00.000Z' }),
        Date.parse('2026-07-11T00:00:00.000Z'),
        'UTC',
      ),
    ).toBe(false)
    expect(isOverdue(task({ day: 'inbox' }), Date.parse('2026-07-11T00:00:00.000Z'), 'UTC')).toBe(
      false,
    )
  })
})

test('nextOverdueChangeAt returns the first future instant that can change derived state', () => {
  const now = Date.parse('2026-07-10T08:00:00.000Z')
  expect(
    nextOverdueChangeAt(
      [
        task({ id: 'later', atTime: '10:00' }),
        task({ id: 'first', atTime: '09:00' }),
        task({ id: 'completed', atTime: '08:30', status: 'completed' }),
        task({ id: 'inbox', day: 'inbox' }),
      ],
      now,
      'UTC',
    ),
  ).toBe(Date.parse('2026-07-10T09:00:00.001Z'))
})
