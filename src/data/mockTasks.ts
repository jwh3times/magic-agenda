import { NO_RECUR, type Category, type Color, type Status, type Task } from '../types/task'
import { addDays, ymd } from '../lib/dates'

let seq = 1000
const uid = (p: string) => `${p}${seq++}`

interface MkInput {
  t: string
  d?: string
  c: Category
  k: Color
  l?: { t: string; d?: boolean }[]
  s?: Status
  day: string
  o?: number
  ko?: number
}

function mk(o: MkInput): Task {
  const status: Status = o.s ?? 'todo'
  return {
    id: uid('t'),
    title: o.t,
    description: o.d ?? '',
    category: o.c,
    color: o.k,
    checklist: (o.l ?? []).map((x) => ({ id: uid('c'), text: x.t, done: !!x.d })),
    status,
    done: status === 'done',
    day: o.day,
    atTime: null,
    order: o.o ?? 0,
    korder: o.ko ?? o.o ?? 0,
    ...NO_RECUR,
  }
}

/** The prototype's seed board, ported verbatim. Days are relative to today. */
export function makeMockTasks(): Task[] {
  seq = 1000
  const off = (n: number) => ymd(addDays(new Date(), n))
  return [
    mk({
      t: 'Finish Q3 deck',
      d: 'Pull latest numbers, tighten the story.',
      c: 'work',
      k: 'yellow',
      day: off(0),
      o: 0,
      s: 'doing',
      ko: 0,
      l: [
        { t: 'Outline', d: true },
        { t: 'Charts', d: true },
        { t: 'Rehearse', d: false },
      ],
    }),
    mk({ t: 'Call plumber', c: 'errands', k: 'pink', day: off(0), o: 1, s: 'todo', ko: 0 }),
    mk({ t: 'Gym — leg day', c: 'health', k: 'mint', day: off(1), o: 0, s: 'done', ko: 0 }),
    mk({
      t: 'Review pull requests',
      d: 'Two from Sam, one from Dee.',
      c: 'work',
      k: 'blue',
      day: off(1),
      o: 1,
      s: 'doing',
      ko: 1,
      l: [
        { t: 'auth-refactor', d: true },
        { t: 'cal-grid', d: false },
      ],
    }),
    mk({ t: 'Date night 🍝', c: 'personal', k: 'pink', day: off(2), o: 0, s: 'todo', ko: 1 }),
    mk({ t: 'Pay rent', c: 'errands', k: 'orange', day: off(2), o: 1, s: 'done', ko: 1 }),
    mk({
      t: 'Sketch app idea',
      d: 'The thing about offline notes.',
      c: 'ideas',
      k: 'lilac',
      day: off(4),
      o: 0,
      s: 'todo',
      ko: 2,
      l: [
        { t: 'Moodboard', d: false },
        { t: 'User flow', d: false },
        { t: 'Name it', d: false },
      ],
    }),
    mk({ t: 'Dentist 9:00', c: 'health', k: 'blue', day: off(5), o: 0, s: 'done', ko: 2 }),
    mk({
      t: 'Birthday gift for Mom',
      c: 'personal',
      k: 'yellow',
      day: off(7),
      o: 0,
      s: 'todo',
      ko: 3,
    }),
    mk({
      t: 'Read “Shape Up”',
      c: 'ideas',
      k: 'mint',
      day: 'inbox',
      o: 0,
      s: 'doing',
      ko: 2,
      l: [
        { t: 'Part 1', d: true },
        { t: 'Part 2', d: false },
      ],
    }),
    mk({
      t: 'Renew passport',
      d: 'Expires in 4 months.',
      c: 'errands',
      k: 'orange',
      day: 'inbox',
      o: 1,
      s: 'todo',
      ko: 4,
    }),
    mk({ t: 'Plan weekend trip', c: 'personal', k: 'lilac', day: 'inbox', o: 2, s: 'todo', ko: 5 }),
  ]
}
