import { useState } from 'react'
import {
  closestCorners,
  pointerWithin,
  useDndMonitor,
  useDroppable,
  type CollisionDetection,
  type Modifier,
} from '@dnd-kit/core'
import { getEventCoordinates, isKeyboardEvent } from '@dnd-kit/utilities'
import { dropTargetId, isDropTarget } from './resolveDrop'

/**
 * dnd-kit's half of a drag on the phone Calendar (#566), where a full-width card is dragged onto a
 * day's small cell. The decisions about what a drop does stay in `resolveDrop.ts`.
 */

/** Makes a grid cell or the Inbox tab a drop target for `lane`, under its own droppable id. */
export function useDropTarget(lane: string, disabled: boolean) {
  return useDroppable({ id: dropTargetId(lane), disabled })
}

/**
 * What the panel needs to hold still for a drag.
 *
 * - `day` is the given day, frozen for the whole gesture. With no day tapped the panel follows today,
 *   so midnight would swap its lane under a held card, and hovering that new lane would relocate the
 *   Task to it.
 * - `dropsDisabled` is for a keyboard drag. The arrow keys step between enabled droppables, so a cell
 *   would let them walk the card out of the panel and across the month. A keyboard drag reorders, and
 *   the editor moves a Task.
 */
export function usePanelDragHold(day: string) {
  const [live, setLive] = useState<{ day: string; keyboard: boolean } | null>(null)
  useDndMonitor({
    onDragStart: ({ activatorEvent }) =>
      setLive({ day, keyboard: isKeyboardEvent(activatorEvent) }),
    onDragEnd: () => setLive(null),
    onDragCancel: () => setLive(null),
  })
  return { day: live?.day ?? day, dropsDisabled: live?.keyboard === true }
}

/**
 * Which droppable the finger is on.
 *
 * - **A grid cell or the Inbox tab wins outright.** `closestCorners` compares the dragged card's
 *   corners, which would pick the wrong day. A card scrolled out of the panel keeps a rect behind the
 *   grid, so these are looked for first rather than ranked against it.
 * - **Anywhere in the panel keeps `closestCorners`**, so a reorder behaves as it does elsewhere. The
 *   panel's lane is its scroller, so its rect is what's visible, unlike its cards' rects. The pointer
 *   alone would turn the gap between two cards into a drop on the lane, which sends a card to the end.
 * - **Anywhere else is nothing**, so letting go there leaves the Task where it was.
 * - **A keyboard drag has no pointer**, and stays with `closestCorners` among the panel's droppables.
 */
export const phoneCalendarCollision: CollisionDetection = (args) => {
  const panel = args.droppableContainers.filter((c) => !isDropTarget(String(c.id)))
  if (!args.pointerCoordinates) return closestCorners({ ...args, droppableContainers: panel })

  const targets = args.droppableContainers.filter((c) => isDropTarget(String(c.id)))
  const onTarget = pointerWithin({ ...args, droppableContainers: targets })
  if (onTarget.length > 0) return onTarget

  const lanes = panel.filter((c) => !c.data.current?.sortable)
  if (pointerWithin({ ...args, droppableContainers: lanes }).length === 0) return []
  return closestCorners({ ...args, droppableContainers: panel })
}

const FINGER_CLEARANCE = 28
const SCREEN_MARGIN = 8

/**
 * Holds the compact overlay above the finger, which would otherwise cover the target date it shows.
 * A `DragOverlay` modifier, so it moves only the picture: the collision rect still follows the card.
 *
 * Measured from the overlay's own rect, which ignores this transform and so stays where the drag
 * began. The card's rect would not do: it moves if the panel scrolls or a row arrives mid-drag.
 */
export const aboveFinger: Modifier = ({
  activatorEvent,
  overlayNodeRect,
  transform,
  windowRect,
}) => {
  const start = activatorEvent && getEventCoordinates(activatorEvent)
  if (!start || !overlayNodeRect || !windowRect) return transform

  const left = start.x + transform.x - overlayNodeRect.width / 2
  const top = start.y + transform.y - overlayNodeRect.height - FINGER_CLEARANCE
  const rightmost = windowRect.width - overlayNodeRect.width - SCREEN_MARGIN
  return {
    ...transform,
    x: Math.min(Math.max(left, SCREEN_MARGIN), rightmost) - overlayNodeRect.left,
    y: Math.max(top, SCREEN_MARGIN) - overlayNodeRect.top,
  }
}
