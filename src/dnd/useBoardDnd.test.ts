import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useBoardDnd } from './useBoardDnd'
import { dropTargetId } from './resolveDrop'
import { NO_RECUR, type Task } from '../types/task'
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'

function inboxTask(): Task {
  return {
    id: 't1',
    title: 'T',
    description: '',
    labelId: null,
    assigneeId: null,
    color: 'yellow',
    checklist: [],
    status: 'todo',
    completedAt: null,
    reopenStatus: 'todo',
    archivedAt: null,
    day: 'inbox',
    atTime: null,
    pinned: false,
    order: 0,
    korder: 0,
    ...NO_RECUR,
  }
}

const rect = (top: number) => ({
  top,
  left: 0,
  right: 100,
  bottom: top + 20,
  width: 100,
  height: 20,
})
const startEvt = {
  active: { id: 't1', rect: { current: { initial: { width: 100 }, translated: null } } },
} as unknown as DragStartEvent
const overEvt = (overId: string) =>
  ({
    active: { id: 't1', rect: { current: { translated: rect(100) } } },
    over: { id: overId, rect: rect(0) },
  }) as unknown as DragOverEvent
const endEvt = (overId: string) =>
  ({
    active: { id: 't1', rect: { current: { translated: rect(100) } } },
    over: { id: overId, rect: rect(0) },
  }) as unknown as DragEndEvent

describe('useBoardDnd persistence', () => {
  it('persists a cross-lane move even when the drop target is the dragged item itself', () => {
    let tasks: Task[] = [inboxTask()]
    const setTasks = vi.fn((u: Task[] | ((p: Task[]) => Task[])) => {
      tasks = typeof u === 'function' ? u(tasks) : u
    })
    const persistReorder = vi.fn()

    const { result, rerender } = renderHook(
      ({ tasks }: { tasks: Task[] }) =>
        useBoardDnd(
          'calendar',
          tasks,
          setTasks as React.Dispatch<React.SetStateAction<Task[]>>,
          persistReorder,
        ),
      { initialProps: { tasks } },
    )

    act(() => result.current.onDragStart(startEvt))
    act(() => result.current.onDragOver(overEvt('2026-07-02'))) // moves t1 to July 2
    rerender({ tasks }) // parent re-renders with t1 now on July 2
    act(() => result.current.onDragEnd(endEvt('t1'))) // dropped on its own slot

    expect(persistReorder).toHaveBeenCalledTimes(1)
    const [next, containers] = persistReorder.mock.calls[0] as [Task[], string[], string]
    expect(next.find((t) => t.id === 't1')?.day).toBe('2026-07-02')
    expect(containers).toContain('2026-07-02')
  })
})

describe('useBoardDnd over a phone grid cell or the Inbox tab', () => {
  const DAY = '2026-11-12'

  function renderBoardDnd(tasks: Task[]) {
    const previewReorder = vi.fn()
    const persistReorder = vi.fn()
    const hook = renderHook(() =>
      useBoardDnd('calendar', tasks, previewReorder, persistReorder, true),
    )
    act(() => hook.result.current.onDragStart(startEvt))
    return { ...hook, previewReorder, persistReorder }
  }

  it('reports the lane under the finger and moves nothing while hovering', () => {
    const { result, previewReorder, persistReorder } = renderBoardDnd([inboxTask()])
    act(() => result.current.onDragOver(overEvt(dropTargetId(DAY))))
    expect(result.current.overTargetLane).toBe(DAY)
    expect(previewReorder).not.toHaveBeenCalled()
    expect(persistReorder).not.toHaveBeenCalled()
  })

  it('stops reporting a lane once the finger leaves the target', () => {
    const { result } = renderBoardDnd([inboxTask()])
    act(() => result.current.onDragOver(overEvt(dropTargetId(DAY))))
    act(() => result.current.onDragOver(overEvt('inbox')))
    expect(result.current.overTargetLane).toBeNull()
  })

  it('persists both lanes on drop, addressed by plain lane ids', () => {
    const { result, persistReorder } = renderBoardDnd([inboxTask()])
    act(() => result.current.onDragOver(overEvt(dropTargetId(DAY))))
    act(() => result.current.onDragEnd(endEvt(dropTargetId(DAY))))

    expect(persistReorder).toHaveBeenCalledTimes(1)
    const [next, containers] = persistReorder.mock.calls[0] as [Task[], string[], string]
    expect(next.find((t) => t.id === 't1')?.day).toBe(DAY)
    expect([...containers].sort()).toEqual([DAY, 'inbox'].sort())
    expect(result.current.overTargetLane).toBeNull()
  })

  it('leaves the Task where it was when cancelled over a target', () => {
    const { result, persistReorder, previewReorder } = renderBoardDnd([inboxTask()])
    act(() => result.current.onDragOver(overEvt(dropTargetId(DAY))))
    act(() => result.current.onDragCancel())
    expect(persistReorder).not.toHaveBeenCalled()
    expect(previewReorder).not.toHaveBeenCalled()
    expect(result.current.overTargetLane).toBeNull()
  })

  it('leaves the Task where it was when released over nothing', () => {
    const { result, persistReorder } = renderBoardDnd([inboxTask()])
    act(() => result.current.onDragOver(overEvt(dropTargetId(DAY))))
    act(() =>
      result.current.onDragEnd({
        active: { id: 't1', rect: { current: { translated: rect(100) } } },
        over: null,
      } as unknown as DragEndEvent),
    )
    expect(persistReorder).not.toHaveBeenCalled()
  })

  it('arms Undo with the pre-drag board before persisting a drop', () => {
    const calls: string[] = []
    const previewReorder = vi.fn(() => calls.push('preview'))
    const persistReorder = vi.fn(() => {
      calls.push('persist')
    })
    const { result } = renderHook(() =>
      useBoardDnd('calendar', [inboxTask()], previewReorder, persistReorder, true),
    )
    act(() => result.current.onDragStart(startEvt))
    act(() => result.current.onDragEnd(endEvt(dropTargetId(DAY))))
    expect(calls).toEqual(['preview', 'persist'])
  })
})
