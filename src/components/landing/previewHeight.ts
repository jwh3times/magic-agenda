/**
 * The height the landing page reserves for the live board preview, shared by the placeholder in
 * `Landing.tsx` and the preview itself so the lazy swap does not move the page (#499).
 *
 * Its own module, deliberately: `Landing.tsx` must not import `BoardPreview` statically, or the
 * preview's ~30 kB would land back in the entry chunk it was split out of.
 *
 * Reserved, not measured. The preview's natural height depends on the theme, on how its card text
 * wraps at the viewport's width, and on whether the web fonts have arrived — measured in Chromium
 * between 225 and 270 px at widths of 360 px and up, with the fallback font the tallest case. Each
 * value is the tallest of those at its breakpoint plus a little margin, and the preview's day cells
 * stretch to fill it, so loading, a font swap, and a theme switch all leave the page where it was.
 * Narrower phones (320 px) wrap enough to grow past it; the preview then grows rather than crop.
 *
 * If a change makes the preview taller — a new card, larger card text — re-measure and raise these.
 * `tests/e2e/smoke.spec.ts` fails when the cork preview outgrows its reservation.
 */
export const PREVIEW_HEIGHT = { mobile: 272, desktop: 252 } as const

export function previewHeight(isMobile: boolean): number {
  return isMobile ? PREVIEW_HEIGHT.mobile : PREVIEW_HEIGHT.desktop
}
