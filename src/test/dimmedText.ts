/**
 * Text under `root` dimmed with an inline `opacity`, one readable line per element, so a failing
 * assertion names what slipped back.
 *
 * Secondary text is drawn in the theme's `mutedFg` instead (#624). Opacity multiplies whatever ink
 * sits under it, so its contrast belongs to the place it is used rather than to the theme, and no
 * check can hold it. Cork's translucent card is where that went wrong: hints dimmed to `.7` read
 * 3.6:1. A disabled control may still fade, since WCAG exempts it.
 */
export function dimmedText(root: ParentNode): string[] {
  return [...root.querySelectorAll<HTMLElement>('[style*="opacity"]')]
    .filter((el) => el.style.opacity !== '' && Number(el.style.opacity) < 1)
    .filter((el) => el.textContent?.trim() && !el.closest(':disabled, [aria-disabled="true"]'))
    .map((el) => `<${el.tagName.toLowerCase()}> ${(el.textContent ?? '').trim().slice(0, 48)}`)
}
