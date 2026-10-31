import { useRef, useState } from 'react'
import {
  KeyboardCode,
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
import type { TaskBoard } from '../data/taskBoardContext'
import { phoneCalendarCollision } from './phoneDrag'
import {
  beginDrag,
  isDropTarget,
  laneOfDroppable,
  modeForView,
  resolveDrop,
  type DragPhase,
  type DragSession,
  type DropInput,
} from './resolveDrop'

/**
 * Space picks a card up; Enter does not. That single subtraction is what makes a card openable
 * from the keyboard at all (#281) — dnd-kit's default `start` is `[Space, Enter]`, so Enter was
 * consumed by the sensor before it could ever reach the card, and a keyboard user had no way to
 * open the editor.
 *
 * It costs nothing to give up, because Enter was never announced: dnd-kit's own screen-reader
 * instructions say "To pick up a draggable item, press the space bar" and mention no second key.
 * The binding removed here is the one nobody was told about, and the app's spoken contract is now
 * the one the code actually implements.
 *
 * `end` deliberately keeps Enter alongside Space. Mid-drag there is no card to open, so the
 * conflict does not exist, and a user who reached for Enter to drop should not have it ignored.
 */
const KEYBOARD_CODES = {
  start: [KeyboardCode.Space],
  cancel: [KeyboardCode.Esc],
  end: [KeyboardCode.Space, KeyboardCode.Enter, KeyboardCode.Tab],
}

export interface BoardDnd {
  sensors: ReturnType<typeof useSensors>
  collisionDetection: typeof closestCorners
  activeTask: Task | null
  activeWidth: number | undefined
  /** The lane of the phone grid cell or Inbox tab under the finger, or null over anything else. */
  overTargetLane: string | null
  onDragStart: (e: DragStartEvent) => void
  onDragOver: (e: DragOverEvent) => void
  onDragEnd: (e: DragEndEvent) => void
  onDragCancel: () => void
}

/** What a drag does to the board: show a move, save it, or undo what was shown. */
type BoardReorder = Pick<TaskBoard, 'previewReorder' | 'persistReorder' | 'cancelReorder'>

const overIdOf = (e: DragOverEvent | DragEndEvent) => (e.over ? String(e.over.id) : null)

/** Maps a dnd-kit event onto the pure module's input. The only place dnd-kit's shapes are read. */
function dropInput(e: DragOverEvent | DragEndEvent, phase: DragPhase): DropInput {
  const overId = overIdOf(e)
  return {
    phase,
    // The pure module sees only lanes and cards, never a grid cell's or the Inbox tab's own id.
    overId: overId && laneOfDroppable(overId),
    activeRect: e.active.rect.current.translated,
    overRect: e.over?.rect ?? null,
    now: new Date().toISOString(),
    dropOnly: overId !== null && isDropTarget(overId),
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
 *
 * `phoneCalendar` says this is the phone Calendar's layout, where a card is dragged onto a small grid
 * cell and collision follows the finger. See `phoneDrag.ts`.
 */
export function useBoardDnd(
  view: ViewName,
  tasks: Task[],
  { previewReorder, persistReorder, cancelReorder }: BoardReorder,
  phoneCalendar = false,
): BoardDnd {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeWidth, setActiveWidth] = useState<number | undefined>(undefined)
  const [overTargetLane, setOverTargetLane] = useState<string | null>(null)
  // A ref, not state: a drag mutates this many times per second and none of it should render.
  const session = useRef<DragSession | null>(null)

  // Mouse drags start after a small movement; touch drags need a long-press so that a plain
  // swipe on a card still scrolls the board (paired with touchAction:'manipulation' on cards).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: KEYBOARD_CODES,
    }),
  )

  const mode = modeForView(view)
  const activeTask = tasks.find((t) => t.id === activeId) ?? null

  const reset = () => {
    setActiveId(null)
    setActiveWidth(undefined)
    setOverTargetLane(null)
    session.current = null
  }

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id)
    setActiveId(id)
    setActiveWidth(e.active.rect.current.initial?.width)
    session.current = beginDrag(tasks, id, mode)
  }

  // Cross-lane relocation happens live as you hover a different lane, except over a phone grid cell
  // or the Inbox tab, which only report themselves until the drop.
  const onDragOver = (e: DragOverEvent) => {
    if (!session.current) return
    const overId = overIdOf(e)
    setOverTargetLane(overId && isDropTarget(overId) ? laneOfDroppable(overId) : null)
    const step = resolveDrop(session.current, tasks, dropInput(e, 'hover'))
    if (!step) return
    session.current = step.session
    previewReorder(step.tasks)
  }

  // Settle on drop. A within-lane reorder or a drop-only move happens here; other cross-lane moves
  // already happened on drag-over. Persist whenever ANY move occurred during the drag — even if the final over-target
  // is the dragged item's own slot, which is the common case since the optimistic move parks it
  // under the cursor.
  const onDragEnd = (e: DragEndEvent) => {
    const current = session.current
    if (current) {
      const input = dropInput(e, 'drop')
      const step = resolveDrop(current, tasks, input)
      const settled = step?.session ?? current
      // Undo is armed by the first preview of a drag, and a drop-only move has had none. Without this
      // it would be the one cross-lane move that offers no Undo.
      if (step && input.dropOnly) previewReorder(step.tasks)
      if (settled.didMove)
        void persistReorder(step?.tasks ?? tasks, [...settled.touched], settled.mode)
    }
    reset()
  }

  // A hover already put the move on screen, so a cancel has to take it back. Left there, the next
  // drag on that lane would save it, because a write covers the whole lane.
  const onDragCancel = () => {
    if (session.current?.didMove) cancelReorder()
    reset()
  }

  return {
    sensors,
    collisionDetection: phoneCalendar ? phoneCalendarCollision : closestCorners,
    activeTask,
    activeWidth,
    overTargetLane,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel,
  }
}
