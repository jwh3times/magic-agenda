import { describe, expect, test } from 'vitest'
import {
  completionStreak,
  historyEntries,
  historyWeeks,
  THROUGHPUT_WEEKS,
  throughputWeeks,
  weekStartOf,
} from './history'
import { NO_RECUR, asOccurrence, type Task } from '../types/task'

let seq = 0

/** A Task Completed at `completedAt`, or active when that is null. */
function task(completedAt: string | null, extra: Partial<Task> = {}): Task {
  seq++
  return {
    id: `t${seq}`,
    title: `Task ${seq}`,
    description: '',
    labelId: null,
    color: 'yellow',
    checklist: [],
    status: completedAt ? 'completed' : 'todo',
    completedAt,
    reopenStatus: 'todo',
    archivedAt: null,
    day: '2026-09-01',
    atTime: null,
    pinned: false,
    order: 0,
    korder: 0,
    ...NO_RECUR,
    ...extra,
  } as Task
}

// Noon UTC keeps an instant on one calendar day in every zone these tests name, except where a
// test is specifically about crossing midnight.
const at = (day: string, time = '12:00:00') => `${day}T${time}.000Z`

/** `Array#at` is ES2022; the app project targets ES2020. */
const fromEnd = <T>(list: readonly T[], n: number): T | undefined => list[list.length - n]
const last = <T>(list: readonly T[]): T | undefined => fromEnd(list, 1)

describe('historyEntries', () => {
  test('includes every currently Completed Task, active or Archived, newest first', () => {
    const older = task(at('2026-09-01'))
    const archived = task(at('2026-09-03'), { archivedAt: at('2026-09-04') })
    const newer = task(at('2026-09-05'))
    const entries = historyEntries([older, archived, newer], 'UTC')
    expect(entries.map((e) => e.task.id)).toEqual([newer.id, archived.id, older.id])
    expect(entries.map((e) => e.archived)).toEqual([false, true, false])
  })

  test('excludes Reopened (active) Tasks: history is current state, not a ledger', () => {
    expect(historyEntries([task(null), task(null, { status: 'doing' })], 'UTC')).toEqual([])
  })

  test('drops a Completed row whose instant does not parse rather than inventing a day', () => {
    expect(historyEntries([task('not-a-date')], 'UTC')).toEqual([])
  })

  test("buckets the shared instant into the reader's own timezone", () => {
    // 02:00 UTC on Sep 5 is still the evening of Sep 4 in New York.
    const late = task(at('2026-09-05', '02:00:00'))
    expect(historyEntries([late], 'UTC')[0].day).toBe('2026-09-05')
    expect(historyEntries([late], 'America/New_York')[0].day).toBe('2026-09-04')
  })

  test('orders ties on the same instant deterministically', () => {
    const instant = at('2026-09-05')
    const b = task(instant, { title: 'B' })
    const a = task(instant, { title: 'A' })
    expect(historyEntries([b, a], 'UTC').map((e) => e.task.title)).toEqual(['A', 'B'])
  })
})

describe('weekStartOf', () => {
  // 2026-09-10 is a Thursday.
  test("respects the reader's Week Start", () => {
    expect(weekStartOf('2026-09-10', 0)).toBe('2026-09-06')
    expect(weekStartOf('2026-09-10', 1)).toBe('2026-09-07')
    expect(weekStartOf('2026-09-10', 4)).toBe('2026-09-10')
  })
})

describe('historyWeeks', () => {
  test('groups by Completion week, newest week first, newest Completion first within it', () => {
    const sun = task(at('2026-09-06'))
    const sat = task(at('2026-09-12'))
    const prevWeek = task(at('2026-09-05'))
    const weeks = historyWeeks([sun, prevWeek, sat], 'UTC', 0)
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-09-06', '2026-08-30'])
    expect(weeks[0].entries.map((e) => e.task.id)).toEqual([sat.id, sun.id])
    expect(weeks[1].entries.map((e) => e.task.id)).toEqual([prevWeek.id])
  })

  test('a Monday Week Start moves a Sunday Completion into the previous week', () => {
    const sun = task(at('2026-09-06'))
    expect(historyWeeks([sun], 'UTC', 0)[0].weekStart).toBe('2026-09-06')
    expect(historyWeeks([sun], 'UTC', 1)[0].weekStart).toBe('2026-08-31')
  })

  test('a Completed -> Reopened -> Completed Task appears only in the later period', () => {
    // Recompletion replaces Completed At, so no trace of the first Completion is left to count.
    const recompleted = task(at('2026-09-10'))
    const weeks = historyWeeks([recompleted], 'UTC', 0)
    expect(weeks).toHaveLength(1)
    expect(weeks[0].weekStart).toBe('2026-09-06')
  })
})

describe('throughputWeeks', () => {
  const today = '2026-09-10' // Thursday

  test('always reports exactly THROUGHPUT_WEEKS buckets, oldest first, ending this week', () => {
    const weeks = throughputWeeks([], today, 'UTC', 0)
    expect(weeks).toHaveLength(THROUGHPUT_WEEKS)
    expect(last(weeks)).toEqual({ weekStart: '2026-09-06', count: 0 })
    expect(weeks[0]).toEqual({ weekStart: '2026-07-19', count: 0 })
  })

  test('counts each Task and Occurrence once, and never counts Checklist Steps', () => {
    const withSteps = task(at('2026-09-08'), {
      checklist: [
        { id: 's1', text: 'one', done: true },
        { id: 's2', text: 'two', done: true },
      ],
    })
    const occurrenceA = task(at('2026-09-08'), { ...asOccurrence('series', '2026-09-08') })
    const occurrenceB = task(at('2026-09-09'), { ...asOccurrence('series', '2026-09-09') })
    const weeks = throughputWeeks([withSteps, occurrenceA, occurrenceB], today, 'UTC', 0)
    expect(last(weeks)?.count).toBe(3)
  })

  test('counts Archived Tasks, and not Reopened ones', () => {
    const archived = task(at('2026-09-08'), { archivedAt: at('2026-09-09') })
    const reopened = task(null)
    expect(last(throughputWeeks([archived, reopened], today, 'UTC', 0))?.count).toBe(1)
  })

  test('ignores Completions older than the window', () => {
    const ancient = task(at('2026-01-01'))
    expect(throughputWeeks([ancient], today, 'UTC', 0).every((w) => w.count === 0)).toBe(true)
  })

  test('Week Start moves the bucket boundaries', () => {
    // Sunday Sep 6 opens this week when weeks start Sunday, and closes the previous week when
    // they start Monday.
    const sunday = task(at('2026-09-06'))
    expect(last(throughputWeeks([sunday], today, 'UTC', 0))?.count).toBe(1)
    const monday = throughputWeeks([sunday], today, 'UTC', 1)
    expect(last(monday)).toEqual({ weekStart: '2026-09-07', count: 0 })
    expect(fromEnd(monday, 2)).toEqual({ weekStart: '2026-08-31', count: 1 })
  })

  test("the reader's timezone decides which week a boundary instant lands in", () => {
    // 02:00 UTC Sunday Sep 6 is still Saturday Sep 5 in New York: the previous Sunday-start week.
    const boundary = task(at('2026-09-06', '02:00:00'))
    expect(last(throughputWeeks([boundary], today, 'UTC', 0))?.count).toBe(1)
    const ny = throughputWeeks([boundary], today, 'America/New_York', 0)
    expect(last(ny)?.count).toBe(0)
    expect(fromEnd(ny, 2)?.count).toBe(1)
  })
})

describe('completionStreak', () => {
  const today = '2026-09-12'
  const onDays = (...days: string[]) => days.map((d) => task(at(d)))

  test('is zero with no Completions', () => {
    expect(completionStreak([], today, 'UTC')).toBe(0)
  })

  test('counts the run ending today', () => {
    expect(completionStreak(onDays('2026-09-10', '2026-09-11', '2026-09-12'), today, 'UTC')).toBe(3)
  })

  test('grace: an empty today still counts the run ending yesterday', () => {
    const tasks = onDays('2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11')
    expect(completionStreak(tasks, today, 'UTC')).toBe(4)
  })

  test('breaks after a whole empty day', () => {
    expect(completionStreak(onDays('2026-09-09', '2026-09-10'), today, 'UTC')).toBe(0)
  })

  test('is the current run, not the longest one', () => {
    const tasks = onDays(
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-11',
      '2026-09-12',
    )
    expect(completionStreak(tasks, today, 'UTC')).toBe(2)
  })

  test('several Completions on one day count that day once', () => {
    expect(completionStreak(onDays('2026-09-12', '2026-09-12', '2026-09-12'), today, 'UTC')).toBe(1)
  })

  test('counts Archived Completions and ignores Reopened Tasks', () => {
    const archived = task(at('2026-09-11'), { archivedAt: at('2026-09-12') })
    expect(completionStreak([archived, task(null)], today, 'UTC')).toBe(1)
  })

  test("uses the reader's timezone to decide which day a Completion is on", () => {
    const tasks = [task(at('2026-09-12', '02:00:00')), task(at('2026-09-10', '20:00:00'))]
    // In UTC these land on Sep 12 and Sep 10: a gap, so only today counts.
    expect(completionStreak(tasks, today, 'UTC')).toBe(1)
    // In New York they land on Sep 11 and Sep 10: consecutive, counted back from yesterday.
    expect(completionStreak(tasks, today, 'America/New_York')).toBe(2)
  })
})
