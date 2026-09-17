import { useContext, useState, type KeyboardEvent } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { TaskCard } from '../components/TaskCard'
import { useBoardActions } from '../components/boardActionContext'
import { useTheme } from '../theme/ThemeProvider'
import { DragDisabledContext } from './dragContext'
import type { Task } from '../types/task'
import type { CardVariant } from '../theme/cardStyles'

export interface SortableCardProps {
  task: Task
  variant: CardVariant
}

/**
 * Wraps TaskCard as a dnd-kit sortable item. We intentionally do NOT apply the sortable
 * transform — the prototype dims the source card in place and shows a floating ghost rather
 * than shuffling neighbours. The dragged card dims via TaskCard's `dragging` flag.
 *
 * This wrapper is the card's only tab stop, and it carries two actions rather than one: Space
 * picks the card up (dnd-kit), Enter opens the editor (here). Before #281 the sensor claimed both
 * keys, so a keyboard user could reorder the board but could not open a single task — the pointer
 * path went through `TaskCard`'s `onClick`, which a keyboard never reaches. See `KEYBOARD_CODES`
 * in `useBoardDnd.ts` for why Enter was the key to take back.
 */
export function SortableCard({ task, variant }: SortableCardProps) {
  const disabled = useContext(DragDisabledContext)
  const { setNodeRef, attributes, listeners, isDragging } = useSortable({ id: task.id, disabled })
  const actions = useBoardActions()
  const onOpen = actions?.onOpen
  const selectedIds = actions?.selectedIds
  const { conf } = useTheme()
  const [focused, setFocused] = useState(false)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // dnd-kit first: it owns Space, and while a drag is live it owns the arrows, Escape and the
    // drop keys too. It calls preventDefault whenever it acts, which is what `defaultPrevented`
    // below reads — so this never has to know which phase the sensor is in.
    listeners?.onKeyDown?.(e)
    // `isDragging` is checked as well as `defaultPrevented`, and it is deliberately defensive.
    // Enter is still a DROP key (`KEYBOARD_CODES.end`), and dnd-kit listens for the drop on the
    // ownerDocument while React dispatches this from the root container — so on that ordering this
    // handler runs FIRST, with `defaultPrevented` still false, and only the drag state itself
    // separates "Enter, to open this card" from "Enter, to drop the card I am carrying".
    //
    // **No test covers this clause, and one cannot.** Measured: once a keyboard drag starts, the
    // Enter that ends it never reaches this handler under jsdom at all — the sensor moves focus,
    // so the keypress is dispatched elsewhere. `Board.test.tsx` asserts the outcome (the editor
    // stays shut) but passes through that path, not this guard. Keep the clause: whether focus
    // moves the same way in every real browser is not something this suite can answer.
    if (isDragging || e.defaultPrevented || e.key !== 'Enter') return
    // Enter on the pin or completion button bubbles up here as well. Those are separate controls
    // with their own actions, and opening the editor on top of one would be a second, unasked-for
    // action per keystroke — so only a keypress aimed at the card itself counts.
    if (e.target !== e.currentTarget) return
    e.preventDefault()
    onOpen?.(task)
  }

  return (
    <div
      ref={setNodeRef}
      // 'manipulation' (not 'none') so touch-scrolling over a card still works; the TouchSensor's
      // long-press activation takes over the gesture only once a drag actually starts.
      style={{ touchAction: 'manipulation' }}
      onFocus={(e) => setFocused(e.currentTarget.matches(':focus-visible'))}
      onBlur={() => setFocused(false)}
      {...attributes}
      {...listeners}
      // In selection mode Enter toggles instead of opening (Board decides), and the button reports
      // whether this card is selected. Outside it, no pressed state is claimed at all.
      aria-pressed={selectedIds ? selectedIds.has(task.id) : undefined}
      onKeyDown={onKeyDown}
    >
      <TaskCard
        task={task}
        variant={variant}
        dragging={isDragging}
        // The focus ring is drawn on the CARD, not on this wrapper (#361), and inside its edge.
        //
        // - On the card, because that element carries the card's rotation, radius, and border: an
        //   outline there tilts with the paper and follows its corners, where one on this unrotated
        //   wrapper is a straight rectangle that slides off a tilted card's corners.
        // - Inside the edge (a negative offset, per theme — see `focusRingInset` in themeConf),
        //   because the calendar cell's card container is `overflow: auto` with no padding. Drawn
        //   outside the card, as it was until #361, the ring was clipped out of sight in every
        //   theme — rendered, asserted, and invisible.
        // - Straight while focused, because a tilted card's corners poke past that same unpadded
        //   container and cut the ring near them; the overhang grows with card width, so no inset
        //   alone can clear it.
        //
        // Focus is still tracked in state rather than expressed as `:focus-visible`, because the
        // theming layer is inline style objects and a pseudo-class cannot reach them (see
        // docs/agents/ui.md). The `:focus-visible` MATCH decides it, so a mouse click does not
        // light the ring — only the keyboard focus it exists to serve.
        //
        // **This ring cannot be asserted in the unit suite.** jsdom implements the selector well
        // enough not to throw but always answers false — measured, not assumed — so `focused` never
        // becomes true under vitest and any test of it would pass for the wrong reason. It is
        // verified in a real browser by the visual canaries (#359).
        wrapStyle={
          focused
            ? {
                outline: `3px solid ${conf.focusRing}`,
                outlineOffset: -conf.focusRingInset,
                // Straightened while focused (#361). Cork tilts cards up to 3° and brutal 1°, and a
                // tilted card's corners overhang the unpadded calendar cell by (width / 2) *
                // sin(tilt) — ~2px on a narrow card, ~5.5px on a wide monitor's cell — which clips
                // even an inset ring, and no fixed inset clears every width. Untilted, the card
                // lines up with its container. The card's own `transform .12s` transition animates
                // the change.
                transform: 'none',
              }
            : undefined
        }
      />
    </div>
  )
}
