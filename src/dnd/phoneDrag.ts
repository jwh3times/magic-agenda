import {
  closestCorners,
  pointerWithin,
  type CollisionDetection,
  type Modifier,
} from '@dnd-kit/core'
import { getEventCoordinates } from '@dnd-kit/utilities'
import { isDropTarget } from './resolveDrop'

/**
 * dnd-kit's half of a drag on the phone Calendar (#566), where a full-width card is dragged onto a
 * 53px cell. The decisions about what a drop does stay in `resolveDrop.ts`.
 */

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
 */
export const aboveFinger: Modifier = ({
  activatorEvent,
  activeNodeRect,
  overlayNodeRect,
  transform,
  windowRect,
}) => {
  const start = activatorEvent && getEventCoordinates(activatorEvent)
  if (!start || !activeNodeRect || !overlayNodeRect || !windowRect) return transform

  const left = start.x + transform.x - overlayNodeRect.width / 2
  const top = start.y + transform.y - overlayNodeRect.height - FINGER_CLEARANCE
  const rightmost = windowRect.width - overlayNodeRect.width - SCREEN_MARGIN
  return {
    ...transform,
    x: Math.min(Math.max(left, SCREEN_MARGIN), rightmost) - activeNodeRect.left,
    y: Math.max(top, SCREEN_MARGIN) - activeNodeRect.top,
  }
}
