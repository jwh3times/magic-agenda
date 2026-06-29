import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useBoardDnd } from './useBoardDnd'
import type { Task } from '../types/task'
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'

function inboxTask(): Task {
  return {
    id: 't1',
    title: 'T',
    description: '',
    category: 'work',
    color: 'yellow',
    checklist: [],
    status: 'todo',
    done: false,
    day: 'inbox',
    order: 0,
    korder: 0,
  }
}

const rect = (top: number) => ({ top, left: 0, right: 100, bottom: top + 20, width: 100, height: 20 })
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
        useBoardDnd('calendar', tasks, setTasks as React.Dispatch<React.SetStateAction<Task[]>>, persistReorder),
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
