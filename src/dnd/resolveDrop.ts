import type { Task, ViewName, WorkflowStatus } from '../types/task'
import { notesForDay, tasksForStatus } from '../data/selectors'
import { moveToDay, moveToStatus, type Mode } from './reorder'

/**
 * Every decision a drag makes, as pure functions over plain data.
 *
 * This module exists because the previous seam was drawn at "pure vs impure" rather than at
 * "hard vs easy": `reorder.ts` was 88 lines with 17 tests (two of its four exports never called
 * in production), while the 147-line dnd-kit wiring held the container-id overloading, the
 * above/below geometry, the insertion arithmetic, and the touched-lane accumulation behind a
 * single test. The splice math was thoroughly covered; every decision that chooses *what* to
 * splice was not.
 *
 * Nothing here imports `@dnd-kit/core`. `useBoardDnd` is now only an adapter: it maps dnd-kit
 * events onto `DropInput` and pushes results into React state.
 */

/** The bit of a DOMRect this module needs. Keeps dnd-kit's `ClientRect` out of the interface. */
export interface RectLike {
  top: number
  height: number
}

export type DragPhase =
  /** Dragging over a target. Only cross-lane moves happen here — see `resolveDrop`. */
  | 'hover'
  /** Released. A within-lane reorder settles here. */
  | 'drop'

export interface DropInput {
  phase: DragPhase
  /** dnd-kit's `over.id`, or null when the pointer is over nothing droppable. */
  overId: string | null
  /** The dragged item's rect in its *translated* position. Null before dnd-kit has measured it. */
  activeRect: RectLike | null
  overRect: RectLike | null
  /** Timestamp used only if this drop enters Completed. Injected by the dnd-kit adapter. */
  now: string
}

/**
 * State that has to survive across the many events of one drag.
 *
 * `touched` and `didMove` are the two things a drag accumulates, and both are load-bearing:
 * `touched` decides which lanes get written back, and `didMove` is why persistence fires even
 * when the final drop target is the dragged card's own slot (after an optimistic cross-lane move
 * the card sits under the cursor as its own drop target — see `AGENTS.md`).
 */
export interface DragSession {
  readonly mode: Mode
  readonly activeId: string
  /** Lanes this drag reindexed, and therefore the lanes that must be persisted. */
  readonly touched: ReadonlySet<string>
  /** Whether any move happened at all. Persist on this, never on the final over-target. */
  readonly didMove: boolean
}

export interface DragStep {
  session: DragSession
  tasks: Task[]
}

/**
 * Which ordering a view drags in.
 *
 * `agenda` maps to `'day'` even though `AgendaView` renders no `DropLane` at all, so the hook is
 * fully wired and completely inert there. That is intentional but easy to mistake for a bug, so
 * it is asserted rather than left implicit.
 */
export function modeForView(view: ViewName): Mode {
  return view === 'kanban' ? 'status' : 'day'
}

/**
 * The lane an id belongs to.
 *
 * **The fallback is the interesting half.** dnd-kit droppable ids are overloaded: a card's id
 * identifies a task, but an empty lane registers a droppable whose id *is* the lane
 * (`'inbox'`, `'2026-07-02'`, `'doing'`). So an id that matches no task is taken to be a lane id
 * — that is how a drop onto an empty lane resolves at all.
 *
 * `reorder.ts` used to export a `findContainer` that returned `undefined` here, was tested four
 * ways, and was never called; the wiring had this version inline and untested. Two rules, one
 * shipped, the other verified. This is the one that ships.
 */
export function containerOf(tasks: Task[], id: string, mode: Mode): string {
  const task = tasks.find((t) => t.id === id)
  if (task) return mode === 'day' ? task.day : task.status
  return id
}

/**
 * Is the dragged item's centre below the centre of the thing it is over? Decides whether the
 * card lands above or below the hovered card.
 *
 * A missing rect answers `false` ("insert above"). dnd-kit leaves `translated` null until it has
 * measured the drag, so this is a real state at the start of a drag rather than a defensive
 * branch — and "above" is the safer default because it matches where the placeholder already is.
 */
export function isBelowOver(activeRect: RectLike | null, overRect: RectLike | null): boolean {
  if (!activeRect || !overRect) return false
  return activeRect.top + activeRect.height / 2 > overRect.top + overRect.height / 2
}

/**
 * Where in `container` the dragged task should land.
 *
 * `excludeId` is the dragged task itself: it is filtered out so the index is computed against the
 * list *without* it, which is what makes the arithmetic stable whether or not the optimistic move
 * has already placed it there.
 *
 * Two append cases collapse to the same answer: `overId === container` means the pointer is over
 * the lane's empty space rather than any card, and `idx < 0` means the hovered card is not in
 * this lane (which happens mid-flight, between the optimistic move and the next measure).
 */
export function insertionIndex(
  tasks: Task[],
  mode: Mode,
  container: string,
  overId: string,
  below: boolean,
  excludeId: string,
): number {
  const list =
    mode === 'day'
      ? notesForDay(tasks, container, excludeId)
      : tasksForStatus(tasks, container as WorkflowStatus, excludeId)
  if (overId === container) return list.length
  const idx = list.findIndex((t) => t.id === overId)
  if (idx < 0) return list.length
  return below ? idx + 1 : idx
}

/** Opens a drag. The starting lane counts as touched: a within-lane reorder must persist it. */
export function beginDrag(tasks: Task[], activeId: string, mode: Mode): DragSession {
  return {
    mode,
    activeId,
    touched: new Set([containerOf(tasks, activeId, mode)]),
    didMove: false,
  }
}

/**
 * Advance a drag by one event. Returns `null` when nothing should change — the caller then skips
 * its `setTasks` entirely rather than re-rendering with an identical array.
 *
 * The phase distinction is the rule that used to live in two separate handlers: **a hover only
 * relocates across lanes**, because reordering within a lane on every mouse move would fight the
 * sortable animation; a **drop** settles any move, including a within-lane one.
 */
export function resolveDrop(
  session: DragSession,
  tasks: Task[],
  input: DropInput,
): DragStep | null {
  const { overId } = input
  if (!overId) return null
  // Dropping on itself is not a move. Note this is *not* the same as "no move happened" — see
  // `didMove`, which is what makes persistence still fire in exactly this case.
  if (overId === session.activeId) return null

  const { mode, activeId } = session
  const from = containerOf(tasks, activeId, mode)
  const to = containerOf(tasks, overId, mode)
  if (input.phase === 'hover' && to === from) return null

  const below = isBelowOver(input.activeRect, input.overRect)
  const index = insertionIndex(tasks, mode, to, overId, below, activeId)
  const next =
    mode === 'day'
      ? moveToDay(tasks, activeId, to, index)
      : moveToStatus(tasks, activeId, to as WorkflowStatus, index, input.now)

  const touched = new Set(session.touched)
  touched.add(from)
  touched.add(to)

  return { session: { ...session, touched, didMove: true }, tasks: next }
}
