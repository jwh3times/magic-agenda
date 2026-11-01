/** The element ids of a Settings section and its heading. */
export const sectionId = (id: string) => `section-${id}`
export const sectionHeadingId = (id: string) => `settings-${id}`

/**
 * Take someone to a Settings section. This scrolls in place rather than following a fragment:
 * `public/`'s auth bootstrap reads `location.hash` on load, so the URL never carries one it did not
 * put there. Focus moves to the heading so keyboard and screen-reader users land where sighted
 * users do.
 */
export function goToSection(id: string) {
  document.getElementById(sectionId(id))?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  document.getElementById(sectionHeadingId(id))?.focus({ preventScroll: true })
}
