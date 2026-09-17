import { assertEquals } from 'jsr:@std/assert@1'
import { type CandidateInputs, planReminderCandidates } from './domain.ts'

const inputs = (overrides: Partial<CandidateInputs> = {}): CandidateInputs => ({
  preferences: [
    {
      accountId: 'a1',
      timezone: 'America/New_York',
      leadMinutes: 15,
    },
  ],
  memberships: [{ accountId: 'a1', boardId: 'b1' }],
  tasks: [
    {
      id: 't1',
      boardId: 'b1',
      title: 'Report',
      day: '2026-09-15',
      atTime: '09:00',
      status: 'todo',
      recurFreq: 'none',
      recurParentId: null,
      updatedAtMs: Date.parse('2026-09-14T12:00:00Z'),
    },
  ],
  ...overrides,
})

Deno.test('shared Board members receive Account-specific Due Moments', () => {
  const planned = planReminderCandidates(
    inputs({
      preferences: [
        { accountId: 'ny', timezone: 'America/New_York', leadMinutes: 15 },
        { accountId: 'la', timezone: 'America/Los_Angeles', leadMinutes: 15 },
      ],
      memberships: [
        { accountId: 'ny', boardId: 'b1' },
        { accountId: 'la', boardId: 'b1' },
      ],
    }),
    Date.parse('2026-09-15T12:45:00Z'),
  )
  assertEquals(
    planned.map((candidate) => candidate.accountId),
    ['ny'],
  )
  assertEquals(planned[0].dueMomentMs, Date.parse('2026-09-15T13:00:00Z'))
})

Deno.test('untimed Tasks open relative to next local midnight', () => {
  const planned = planReminderCandidates(
    inputs({
      preferences: [{ accountId: 'a1', timezone: 'UTC', leadMinutes: 60 }],
      tasks: [{ ...inputs().tasks[0], atTime: null }],
    }),
    Date.parse('2026-09-15T23:00:00Z'),
  )
  assertEquals(planned[0].dueMomentMs, Date.parse('2026-09-16T00:00:00Z'))
})

Deno.test('Inbox, Completed, and Series definition rows are never eligible', () => {
  const base = inputs().tasks[0]
  const planned = planReminderCandidates(
    inputs({
      tasks: [
        { ...base, id: 'inbox', day: null },
        { ...base, id: 'done', status: 'done' },
        { ...base, id: 'series', recurFreq: 'daily', recurParentId: null },
      ],
    }),
    Date.parse('2026-09-15T12:45:00Z'),
  )
  assertEquals(planned, [])
})

Deno.test('DST gap and overlap use the client-compatible instant', () => {
  const base = inputs().tasks[0]
  const spring = planReminderCandidates(
    inputs({
      preferences: [
        {
          accountId: 'a1',
          timezone: 'America/New_York',
          leadMinutes: 0,
        },
      ],
      tasks: [{ ...base, day: '2026-03-08', atTime: '02:30' }],
    }),
    Date.parse('2026-03-08T07:30:00Z'),
  )
  const fall = planReminderCandidates(
    inputs({
      preferences: [
        {
          accountId: 'a1',
          timezone: 'America/New_York',
          leadMinutes: 0,
        },
      ],
      tasks: [{ ...base, day: '2026-11-01', atTime: '01:30' }],
    }),
    Date.parse('2026-11-01T05:30:00Z'),
  )
  assertEquals(spring[0].dueMomentMs, Date.parse('2026-03-08T07:30:00Z'))
  assertEquals(fall[0].dueMomentMs, Date.parse('2026-11-01T05:30:00Z'))
})

Deno.test('at-Due-Moment delivery allows one scheduler interval of grace', () => {
  const planned = planReminderCandidates(
    inputs({
      preferences: [{ accountId: 'a1', timezone: 'UTC', leadMinutes: 0 }],
      tasks: [
        {
          ...inputs().tasks[0],
          atTime: '13:00',
        },
      ],
    }),
    Date.parse('2026-09-15T13:04:00Z'),
  )
  assertEquals(planned.length, 1)
})

Deno.test('a Task reopened after its Due Moment does not replay a missed Reminder', () => {
  assertEquals(
    planReminderCandidates(
      inputs({
        preferences: [{ accountId: 'a1', timezone: 'UTC', leadMinutes: 0 }],
        tasks: [
          {
            ...inputs().tasks[0],
            atTime: '13:00',
            updatedAtMs: Date.parse('2026-09-15T13:01:00Z'),
          },
        ],
      }),
      Date.parse('2026-09-15T13:04:00Z'),
    ),
    [],
  )
})
