/**
 * How far below the top of the window, in px, a section's top must reach to become the current
 * one in a section nav (#464).
 *
 * Just below where a nav jump puts a section (its `scroll-margin-top`, 28px on Settings), and no
 * lower. The first cut used a third of the window, about 360px at 1440p, which a short section's
 * successor had already crossed by the time the jump finished, so the nav marked the section
 * after the one the user chose.
 */
export const SPY_LINE = 80

/**
 * Which of `ids` a section nav marks as current, given each section's top relative to the window
 * (`null` for one not on the page). The last section whose top has reached `SPY_LINE`, or the
 * first before any has. At the bottom of the page it is the last section, because a short final
 * section can never scroll up to the line.
 */
export function currentSection(
  ids: readonly string[],
  tops: readonly (number | null)[],
  { atBottom }: { atBottom: boolean },
): string {
  if (atBottom) return ids[ids.length - 1]
  let current = ids[0]
  ids.forEach((id, i) => {
    const top = tops[i]
    if (top !== null && top <= SPY_LINE) current = id
  })
  return current
}
