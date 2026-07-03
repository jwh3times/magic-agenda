import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
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

/** Persists the lanes that a drag reindexed (passed to useTasks.persistReorder). */
type PersistReorder = (next: Task[], containers: string[], mode: Mode) => void

export function useBoardDnd(
  view: ViewName,
  tasks: Task[],
  setTasks: Dispatch<SetStateAction<Task[]>>,
  persistReorder: PersistReorder,
): BoardDnd {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeWidth, setActiveWidth] = useState<number | undefined>(undefined)
  const touched = useRef<Set<string>>(new Set())
  const didMove = useRef(false)

  // Mouse drags start after a small movement; touch drags need a long-press so that a plain
  // swipe on a card still scrolls the board (paired with touchAction:'manipulation' on cards).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const mode: Mode = view === 'kanban' ? 'status' : 'day'
  const activeTask = tasks.find((t) => t.id === activeId) ?? null

  const containerOf = (id: string): string => {
    const task = tasks.find((t) => t.id === id)
    if (task) return mode === 'day' ? task.day : task.status
    return id
  }

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

  const move = (id: string, to: string, index: number): Task[] =>
    mode === 'day' ? moveToDay(tasks, id, to, index) : moveToStatus(tasks, id, to as Status, index)

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id)
    setActiveId(id)
    setActiveWidth(e.active.rect.current.initial?.width)
    touched.current = new Set([containerOf(id)])
    didMove.current = false
  }

  // Cross-lane relocation happens live as you hover a different lane.
  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e
    if (!over) return
    const activeIdStr = String(active.id)
    const overId = String(over.id)
    if (overId === activeIdStr) return
    const from = containerOf(activeIdStr)
    const to = containerOf(overId)
    if (to !== from) {
      touched.current.add(from)
      touched.current.add(to)
      didMove.current = true
      setTasks(move(activeIdStr, to, insertionIndex(to, overId, isBelowOver(active, over)))) // optimistic
    }
  }

  // Settle on drop. A within-lane reorder happens here; cross-lane moves already happened on
  // drag-over. Persist whenever ANY move occurred — even if the final over-target is the dragged
  // item's own slot (a common case, since the optimistic move parks it under the cursor).
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    const activeIdStr = String(active.id)
    let next = tasks
    if (over && String(over.id) !== activeIdStr) {
      const to = containerOf(String(over.id))
      touched.current.add(to)
      next = move(activeIdStr, to, insertionIndex(to, String(over.id), isBelowOver(active, over)))
      didMove.current = true
    }
    if (didMove.current) persistReorder(next, [...touched.current], mode)
    setActiveId(null)
    setActiveWidth(undefined)
    touched.current = new Set()
    didMove.current = false
  }

  const onDragCancel = () => {
    setActiveId(null)
    setActiveWidth(undefined)
    touched.current = new Set()
    didMove.current = false
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
