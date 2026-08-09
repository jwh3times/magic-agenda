import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { Task, ViewName } from '../types/task'
import type { Mode } from './reorder'
import {
  beginDrag,
  modeForView,
  resolveDrop,
  type DragPhase,
  type DragSession,
  type DropInput,
} from './resolveDrop'

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

/** Maps a dnd-kit event onto the pure module's input. The only place dnd-kit's shapes are read. */
function dropInput(e: DragOverEvent | DragEndEvent, phase: DragPhase): DropInput {
  return {
    phase,
    overId: e.over ? String(e.over.id) : null,
    activeRect: e.active.rect.current.translated,
    overRect: e.over?.rect ?? null,
  }
}

/**
 * dnd-kit adapter. Sensors, event plumbing, and React state — every decision lives in
 * `resolveDrop.ts`, which knows nothing about dnd-kit and is tested without it.
 *
 * **`tasks` must be the unfiltered board.** Views render `visibleTasks`, and it is tempting to
 * pass the same thing here so the filter coupling stops being implicit. Doing so would corrupt
 * data: `resolveDrop` returns the whole next board, `persistReorder` writes back every task in a
 * touched lane, and a filtered list would hand contiguous 0..n-1 indices to the visible tasks
 * while the hidden ones in that lane kept theirs — colliding orders in the same lane. Dragging
 * under an active filter is prevented one level up, by `DragDisabledContext`, not here.
 */
export function useBoardDnd(
  view: ViewName,
  tasks: Task[],
  setTasks: Dispatch<SetStateAction<Task[]>>,
  persistReorder: PersistReorder,
): BoardDnd {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeWidth, setActiveWidth] = useState<number | undefined>(undefined)
  // A ref, not state: a drag mutates this many times per second and none of it should render.
  const session = useRef<DragSession | null>(null)

  // Mouse drags start after a small movement; touch drags need a long-press so that a plain
  // swipe on a card still scrolls the board (paired with touchAction:'manipulation' on cards).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const mode = modeForView(view)
  const activeTask = tasks.find((t) => t.id === activeId) ?? null

  const reset = () => {
    setActiveId(null)
    setActiveWidth(undefined)
    session.current = null
  }

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id)
    setActiveId(id)
    setActiveWidth(e.active.rect.current.initial?.width)
    session.current = beginDrag(tasks, id, mode)
  }

  // Cross-lane relocation happens live as you hover a different lane.
  const onDragOver = (e: DragOverEvent) => {
    if (!session.current) return
    const step = resolveDrop(session.current, tasks, dropInput(e, 'hover'))
    if (!step) return
    session.current = step.session
    setTasks(step.tasks) // optimistic
  }

  // Settle on drop. A within-lane reorder happens here; cross-lane moves already happened on
  // drag-over. Persist whenever ANY move occurred during the drag — even if the final over-target
  // is the dragged item's own slot, which is the common case since the optimistic move parks it
  // under the cursor.
  const onDragEnd = (e: DragEndEvent) => {
    const current = session.current
    if (current) {
      const step = resolveDrop(current, tasks, dropInput(e, 'drop'))
      const settled = step?.session ?? current
      if (settled.didMove) persistReorder(step?.tasks ?? tasks, [...settled.touched], settled.mode)
    }
    reset()
  }

  return {
    sensors,
    collisionDetection: closestCorners,
    activeTask,
    activeWidth,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel: reset,
  }
}
