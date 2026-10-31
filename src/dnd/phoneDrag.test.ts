import { describe, expect, it } from 'vitest'
import type { Active, ClientRect, DroppableContainer } from '@dnd-kit/core'
import { aboveFinger, phoneCalendarCollision } from './phoneDrag'
import { dropTargetId } from './resolveDrop'

const box = (left: number, top: number, width: number, height: number): ClientRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
})

const DAY = '2026-11-10'
const SOURCE = '2026-11-12'

/** One cell of the grid, the Inbox tab, then the panel's lane and two cards in it. */
const RECTS: [string, ClientRect, boolean][] = [
  [dropTargetId(DAY), box(0, 100, 53, 46), false],
  [dropTargetId('inbox'), box(100, 400, 80, 40), false],
  [SOURCE, box(0, 450, 390, 300), false],
  ['card-a', box(0, 460, 390, 70), true],
  // Scrolled out of the lane's top, so its rect sits behind the grid.
  ['card-hidden', box(0, 90, 390, 70), true],
]

function args(pointer: { x: number; y: number } | null) {
  return {
    active: { id: 'card-a' } as unknown as Active,
    collisionRect: box(0, 470, 200, 60),
    droppableRects: new Map(RECTS.map(([id, rect]) => [id, rect])),
    droppableContainers: RECTS.map(
      ([id, , sortable]) =>
        ({
          id,
          data: { current: sortable ? { sortable: {} } : {} },
        }) as unknown as DroppableContainer,
    ),
    pointerCoordinates: pointer,
  }
}

const ids = (pointer: { x: number; y: number } | null) =>
  phoneCalendarCollision(args(pointer)).map((c) => c.id)

describe('phoneCalendarCollision', () => {
  it('follows the finger onto a day, even with a scrolled-away card behind it', () => {
    expect(ids({ x: 20, y: 120 })).toEqual([dropTargetId(DAY)])
  })

  it('follows the finger onto the Inbox tab', () => {
    expect(ids({ x: 120, y: 420 })).toEqual([dropTargetId('inbox')])
  })

  it('finds nothing when the finger is on neither a target nor the panel', () => {
    expect(ids({ x: 300, y: 10 })).toEqual([])
  })

  it('finds nothing in a gap of the grid, where only a scrolled-away card lies', () => {
    expect(ids({ x: 200, y: 120 })).toEqual([])
  })

  it('reorders by the dragged card while the finger is in the panel', () => {
    const inPanel = ids({ x: 20, y: 500 })
    expect(inPanel[0]).toBe('card-a')
    expect(inPanel).not.toContain(dropTargetId(DAY))
    expect(inPanel).not.toContain(dropTargetId('inbox'))
  })

  it('never offers a target to a keyboard drag, which has no finger', () => {
    const keyboard = ids(null)
    expect(keyboard).not.toContain(dropTargetId(DAY))
    expect(keyboard).not.toContain(dropTargetId('inbox'))
    expect(keyboard.length).toBeGreaterThan(0)
  })
})

describe('aboveFinger', () => {
  const place = (
    pointer: { x: number; y: number },
    activatorEvent: Event = new MouseEvent('mousedown', {
      clientX: pointer.x,
      clientY: pointer.y,
    }),
  ) =>
    aboveFinger({
      activatorEvent,
      // Where the card has got to, which the overlay must not follow.
      activeNodeRect: box(10, 260, 370, 70),
      overlayNodeRect: box(10, 500, 200, 50),
      windowRect: box(0, 0, 390, 844),
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
    } as unknown as Parameters<typeof aboveFinger>[0])

  it('centres the overlay above the finger, so the finger does not cover it', () => {
    const { x, y } = place({ x: 195, y: 500 })
    expect(10 + x + 100).toBe(195)
    expect(500 + y + 50).toBeLessThan(500)
  })

  it('keeps the overlay on screen at the edges', () => {
    expect(10 + place({ x: 5, y: 500 }).x).toBeGreaterThanOrEqual(0)
    expect(10 + place({ x: 388, y: 500 }).x + 200).toBeLessThanOrEqual(390)
    expect(500 + place({ x: 195, y: 10 }).y).toBeGreaterThanOrEqual(0)
  })

  it('leaves a keyboard drag where the sensor put it', () => {
    expect(place({ x: 195, y: 500 }, new KeyboardEvent('keydown'))).toMatchObject({ x: 0, y: 0 })
  })
})
