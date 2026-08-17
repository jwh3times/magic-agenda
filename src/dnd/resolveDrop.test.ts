import { describe, it, expect } from 'vitest'
import {
  beginDrag,
  containerOf,
  insertionIndex,
  isBelowOver,
  modeForView,
  resolveDrop,
  type DragSession,
  type DropInput,
} from './resolveDrop'
import { NO_RECUR, type Task } from '../types/task'

function t(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: '',
    labelId: null,
    color: 'yellow',
    checklist: [],
    status: 'todo',
    done: false,
    day: 'inbox',
    atTime: null,
    pinned: false,
    order: 0,
    korder: 0,
    ...NO_RECUR,
    ...over,
  }
}

const rect = (top: number, height = 20) => ({ top, height })
const dayIds = (tasks: Task[], day: string) =>
  tasks
    .filter((x) => x.day === day)
    .sort((a, b) => a.order - b.order)
    .map((x) => x.id)

/** A hover/drop over `overId`, with the dragged card's centre below the target's by default. */
const input = (overId: string | null, over: Partial<DropInput> = {}): DropInput => ({
  phase: 'hover',
  overId,
  activeRect: rect(100),
  overRect: rect(0),
  ...over,
})

describe('modeForView', () => {
  it('drags by status in kanban and by day everywhere else', () => {
    expect(modeForView('kanban')).toBe('status')
    expect(modeForView('calendar')).toBe('day')
    expect(modeForView('week')).toBe('day')
  })

  it('maps agenda to day even though AgendaView renders no drop lane', () => {
    // The hook is fully wired for agenda and completely inert there, which reads like a bug
    // unless it is written down. If AgendaView ever gains lanes, this is already correct.
    expect(modeForView('agenda')).toBe('day')
  })
})

describe('containerOf', () => {
  const tasks = [t('a', { day: '2026-06-29', status: 'doing' }), t('b', { day: 'inbox' })]

  it('returns the lane a task lives in', () => {
    expect(containerOf(tasks, 'a', 'day')).toBe('2026-06-29')
    expect(containerOf(tasks, 'b', 'day')).toBe('inbox')
    expect(containerOf(tasks, 'a', 'status')).toBe('doing')
  })

  it('treats an id that matches no task as a lane id', () => {
    // This is how a drop onto an EMPTY lane resolves: dnd-kit registers the lane itself as a
    // droppable whose id is the lane. The deleted `findContainer` returned undefined here, which
    // is why it could never have shipped — dropping into an empty day would have done nothing.
    expect(containerOf(tasks, '2026-07-04', 'day')).toBe('2026-07-04')
    expect(containerOf(tasks, 'inbox', 'day')).toBe('inbox')
    expect(containerOf(tasks, 'done', 'status')).toBe('done')
  })
})

describe('isBelowOver', () => {
  it('compares centres, not edges', () => {
    expect(isBelowOver(rect(100), rect(0))).toBe(true) // centre 110 vs 10
    expect(isBelowOver(rect(0), rect(100))).toBe(false)
    // Overlapping rects: tops differ but centres decide.
    expect(isBelowOver(rect(11, 20), rect(0, 20))).toBe(true)
  })

  it('answers "above" when the drag has not been measured yet', () => {
    // dnd-kit leaves `translated` null until it measures, so this is a real state at drag start
    // rather than a defensive branch. "Above" matches where the placeholder already sits.
    expect(isBelowOver(null, rect(0))).toBe(false)
    expect(isBelowOver(rect(100), null)).toBe(false)
  })
})

describe('insertionIndex', () => {
  const tasks = [
    t('a', { day: 'D', order: 0 }),
    t('b', { day: 'D', order: 1 }),
    t('c', { day: 'D', order: 2 }),
    t('drag', { day: 'OTHER', order: 0 }),
  ]

  it('inserts above or below the hovered card', () => {
    expect(insertionIndex(tasks, 'day', 'D', 'b', false, 'drag')).toBe(1)
    expect(insertionIndex(tasks, 'day', 'D', 'b', true, 'drag')).toBe(2)
  })

  it('appends when the pointer is over the lane itself rather than a card', () => {
    expect(insertionIndex(tasks, 'day', 'D', 'D', false, 'drag')).toBe(3)
  })

  it('appends when the hovered id is not in this lane', () => {
    // Happens mid-flight, between an optimistic move and the next measure.
    expect(insertionIndex(tasks, 'day', 'D', 'nowhere', false, 'drag')).toBe(3)
  })

  it('excludes the dragged task, so the index is stable once it has already moved in', () => {
    const moved = [t('a', { day: 'D', order: 0 }), t('drag', { day: 'D', order: 1 })]
    // Without the exclusion the list would be length 2 and appending would give 2, not 1.
    expect(insertionIndex(moved, 'day', 'D', 'D', false, 'drag')).toBe(1)
  })

  it('works by korder in status mode', () => {
    const kanban = [t('a', { status: 'doing', korder: 0 }), t('b', { status: 'doing', korder: 1 })]
    expect(insertionIndex(kanban, 'status', 'doing', 'a', true, 'drag')).toBe(1)
    expect(insertionIndex(kanban, 'status', 'doing', 'doing', false, 'drag')).toBe(2)
  })
})

describe('beginDrag', () => {
  it('counts the starting lane as touched so a within-lane reorder persists it', () => {
    const tasks = [t('a', { day: 'D' })]
    const session = beginDrag(tasks, 'a', 'day')
    expect([...session.touched]).toEqual(['D'])
    expect(session.didMove).toBe(false)
    expect(session.activeId).toBe('a')
  })
})

describe('resolveDrop', () => {
  const board = () => [
    t('a', { day: 'A', order: 0 }),
    t('b', { day: 'B', order: 0 }),
    t('c', { day: 'B', order: 1 }),
  ]
  const start = (tasks: Task[], id = 'a') => beginDrag(tasks, id, 'day')

  it('does nothing without a drop target', () => {
    const tasks = board()
    expect(resolveDrop(start(tasks), tasks, input(null))).toBeNull()
  })

  it('does nothing when the target is the dragged item itself', () => {
    const tasks = board()
    expect(resolveDrop(start(tasks), tasks, input('a'))).toBeNull()
  })

  it('ignores a same-lane hover', () => {
    // Reordering within a lane on every mouse move would fight the sortable animation, so the
    // within-lane case is deliberately deferred to the drop.
    const tasks = board()
    const session = start(tasks, 'b')
    expect(resolveDrop(session, tasks, input('c'))).toBeNull()
  })

  it('relocates across lanes on hover and records both lanes', () => {
    const tasks = board()
    const step = resolveDrop(start(tasks), tasks, input('b', { activeRect: rect(0) }))!
    expect(step).not.toBeNull()
    expect(dayIds(step.tasks, 'B')).toEqual(['a', 'b', 'c']) // inserted above b
    expect(dayIds(step.tasks, 'A')).toEqual([])
    expect([...step.session.touched].sort()).toEqual(['A', 'B'])
    expect(step.session.didMove).toBe(true)
  })

  it('honours below-the-centre placement', () => {
    const tasks = board()
    const step = resolveDrop(start(tasks), tasks, input('b', { activeRect: rect(100) }))!
    expect(dayIds(step.tasks, 'B')).toEqual(['b', 'a', 'c'])
  })

  it('settles a within-lane reorder on drop', () => {
    // Previously the only path through onDragEnd that no test exercised.
    const tasks = board()
    const session = start(tasks, 'b')
    const step = resolveDrop(session, tasks, {
      phase: 'drop',
      overId: 'c',
      activeRect: rect(100),
      overRect: rect(0),
    })!
    expect(dayIds(step.tasks, 'B')).toEqual(['c', 'b'])
    expect([...step.session.touched]).toEqual(['B'])
    expect(step.session.didMove).toBe(true)
  })

  it('accumulates every lane a multi-hop drag passes through', () => {
    // A drag crossing three lanes must persist all three, or the lane it merely passed over
    // keeps a stale order. No test covered more than one hop before.
    let tasks = board()
    let session = start(tasks)

    let step = resolveDrop(session, tasks, input('b'))!
    ;({ session, tasks } = step)
    step = resolveDrop(session, tasks, input('2026-07-04'))!
    ;({ session, tasks } = step)

    expect([...session.touched].sort()).toEqual(['2026-07-04', 'A', 'B'])
    expect(containerOf(tasks, 'a', 'day')).toBe('2026-07-04')
  })

  it('drops into an empty lane addressed by its own id', () => {
    const tasks = board()
    const step = resolveDrop(start(tasks), tasks, input('2026-07-04'))!
    expect(dayIds(step.tasks, '2026-07-04')).toEqual(['a'])
  })

  it('keeps didMove set once a move has happened, even if later events resolve to nothing', () => {
    // The AGENTS.md invariant, now expressible without dnd-kit fixtures: after an optimistic
    // cross-lane move the card sits under the cursor as its own drop target, so the final drop
    // resolves to null — and persistence must still fire off `didMove`.
    const tasks = board()
    const moved = resolveDrop(start(tasks), tasks, input('b'))!
    const settle = resolveDrop(moved.session, moved.tasks, {
      phase: 'drop',
      overId: 'a', // its own id
      activeRect: rect(100),
      overRect: rect(0),
    })
    expect(settle).toBeNull()
    expect(moved.session.didMove).toBe(true)
    expect([...moved.session.touched].sort()).toEqual(['A', 'B'])
  })

  it('moves by status and updates done in kanban mode', () => {
    const tasks = [t('a', { status: 'todo', korder: 0 }), t('z', { status: 'done', korder: 0 })]
    const session: DragSession = beginDrag(tasks, 'a', 'status')
    const step = resolveDrop(session, tasks, { ...input('z'), phase: 'drop' })!
    const moved = step.tasks.find((x) => x.id === 'a')!
    expect(moved.status).toBe('done')
    expect(moved.done).toBe(true)
    expect([...step.session.touched].sort()).toEqual(['done', 'todo'])
  })

  it('does not mutate the session or the tasks it is given', () => {
    const tasks = board()
    const session = start(tasks)
    const before = [...session.touched]
    resolveDrop(session, tasks, input('b'))
    expect([...session.touched]).toEqual(before)
    expect(session.didMove).toBe(false)
    expect(tasks.find((x) => x.id === 'a')!.day).toBe('A')
  })
})
