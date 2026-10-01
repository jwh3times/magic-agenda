/**
 * Scale helpers for Admin's 30-day history (#468). Pure, so the arithmetic a chart can get wrong —
 * an all-zero month, a single spike — is tested without a DOM.
 */

/**
 * The smallest clean axis maximum (1, 2, or 5 times a power of ten) at or above `max`. An empty or
 * all-zero series still gets 1, so a bar height is never a division by zero.
 */
export function niceCeiling(max: number): number {
  if (!(max > 0)) return 1
  const power = 10 ** Math.floor(Math.log10(max))
  for (const step of [1, 2, 5, 10]) {
    if (step * power >= max) return step * power
  }
  return 10 * power
}

/** A bar's height as a percentage of the axis. A non-zero count never rounds away to nothing. */
export function barPercent(count: number, axisMax: number): number {
  if (count <= 0 || axisMax <= 0) return 0
  return Math.max((count / axisMax) * 100, 2)
}

const SHORT_DAY = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

/** A `YYYY-MM-DD` UTC bucket as "Sep 16". The buckets are UTC days, so they are formatted in UTC. */
export function shortUtcDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? day : SHORT_DAY.format(date)
}
