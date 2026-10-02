import type { CSSProperties } from 'react'

/**
 * A native `<select>` drawn by the theme instead of the browser (#483, #484).
 *
 * The control stays a real `<select>`, so the keyboard, screen readers, and the platform's option
 * picker behave exactly as before. Only its box is restyled: `appearance: none` removes the
 * browser's own arrow and chrome, and an inline-SVG chevron in the control's text colour replaces
 * it, so the arrow meets the same contrast as the text beside it.
 *
 * `background` and `padding` are written as whole shorthands, never as longhands layered over a
 * caller's shorthand, because React warns when the two conflict across renders.
 */

/** A 10×6 downward chevron in `color`, as a CSS `url(...)`. */
export function chevron(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/** How much wider the right padding is than the left, to leave room for the chevron. */
const CHEVRON_ROOM = 16

/**
 * The style that turns a select into a themed one. Spread it AFTER the control's own style:
 * it replaces `background` (the chevron layered over `fill`) and `padding` (`y`/`x` as the
 * control had them, plus room on the right for the chevron).
 */
export function chevronSelect(
  fill: string,
  color: string,
  { y, x }: { y: number; x: number },
): CSSProperties {
  return {
    appearance: 'none',
    WebkitAppearance: 'none',
    background: `${chevron(color)} no-repeat right ${x}px center / 10px 6px, ${fill}`,
    padding: `${y}px ${x + CHEVRON_ROOM}px ${y}px ${x}px`,
    cursor: 'pointer',
  }
}
