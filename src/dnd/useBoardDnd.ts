import { useState, type Dispatch, type SetStateAction } from 'react'
import {
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type Active,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Over,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { Status, Task, ViewName } from '../types/task'
import { notesForDay, tasksForStatus } from '../data/selectors'
import { moveToDay, moveToStatus, type Mode } from './reorder'

/** Is the dragged item's centre below the centre of the item it's over? */
function isBelowOver(active: Active, over: Over): boolean {
  const translated = active.rect.current.translated
  if (!translated) return false
  const activeCenterY = translated.top + translated.height / 2
  const overCenterY = over.rect.top + over.rect.height / 2
  return activeCenterY > overCenterY
}

export interface BoardDnd {
  sensors: ReturnType<typeof useSensors>
  collisionDetection: typeof closestCorners
  activeTask: Task | null
  activeWidth: number | undefined
  onDragStart: (e: DragStartEvent) => void
  onDragOver: (e: DragOverEvent) => void
  onDragEnd: (e: DragEndEvent) => void
  onDragCancel: () => void
}

export function useBoardDnd(
  view: ViewName,
  tasks: Task[],
  setTasks: Dispatch<SetStateAction<Task[]>>,
): BoardDnd {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeWidth, setActiveWidth] = useState<number | undefined>(undefined)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const mode: Mode = view === 'kanban' ? 'status' : 'day'
  const activeTask = tasks.find((t) => t.id === activeId) ?? null

  /** The container an id belongs to: a task's day/status, or the id itself if it's a container. */
  const containerOf = (id: string): string => {
    const task = tasks.find((t) => t.id === id)
    if (task) return mode === 'day' ? task.day : task.status
    return id
  }

  /** Insertion index within a container given the over target. Excludes the active task. */
  const insertionIndex = (container: string, overId: string, below: boolean): number => {
    const list =
      mode === 'day'
        ? notesForDay(tasks, container, activeId ?? undefined)
        : tasksForStatus(tasks, container as Status, activeId ?? undefined)
    if (overId === container) return list.length
    const idx = list.findIndex((t) => t.id === overId)
    if (idx < 0) return list.length
    return below ? idx + 1 : idx
  }

  const applyMove = (id: string, container: string, index: number) => {
    setTasks((prev) =>
      mode === 'day'
        ? moveToDay(prev, id, container, index)
        : moveToStatus(prev, id, container as Status, index),
    )
  }

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id))
    setActiveWidth(e.active.rect.current.initial?.width)
  }

  // Cross-container relocation happens live as you hover a different lane.
  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e
    if (!over) return
    const activeIdStr = String(active.id)
    const overId = String(over.id)
    if (overId === activeIdStr) return
    const from = containerOf(activeIdStr)
    const to = containerOf(overId)
    if (to !== from) applyMove(activeIdStr, to, insertionIndex(to, overId, isBelowOver(active, over)))
  }

  // Final placement (within-lane ordering) settles on drop.
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    const activeIdStr = String(active.id)
    if (over && String(over.id) !== activeIdStr) {
      const to = containerOf(String(over.id))
      applyMove(activeIdStr, to, insertionIndex(to, String(over.id), isBelowOver(active, over)))
    }
    setActiveId(null)
    setActiveWidth(undefined)
  }

  const onDragCancel = () => {
    setActiveId(null)
    setActiveWidth(undefined)
  }

  return {
    sensors,
    collisionDetection: closestCorners,
    activeTask,
    activeWidth,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel,
  }
}
