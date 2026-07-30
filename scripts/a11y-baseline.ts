/**
 * Pure logic behind the Playwright a11y ratchet (tests/e2e/a11y.spec.ts).
 *
 * Split out for the same reason src/sw/policy.ts is split from src/sw.ts and tests/rls/reloptions.ts
 * from its test: a11y.spec.ts cannot run without a deployed preview AND the E2E account's
 * credentials, which exist only as repository secrets — so anything asserted solely inside it is
 * untested in practice. Everything in this file runs in `npm test`.
 */

export interface BaselineEntry {
  label: string
  ruleId: string
  count: number
}

// Every surface tests/e2e/a11y.spec.ts scans. parseBaseline() rejects any baseline entry whose
// label is not in this list, and the afterAll writer refuses to run unless all of them scanned in
// THIS worker. Exported so scripts/a11y-baseline.test.ts's "the committed baseline" test asserts
// against the same list a11y.spec.ts actually uses, rather than a second hard-coded copy that would
// silently accept a stale entry if a surface were renamed or dropped.
export const EXPECTED_LABELS = [
  'landing',
  'login',
  'settings',
  'board-cork',
  'board-brutal',
  'board-glass',
] as const

export interface Finding {
  /** Its own field, deliberately NOT parsed back out of `target`: axe targets are full of colons. */
  label: string
  ruleId: string
  target: string
  /**
   * Human-readable extra context for the log line and the failure message — today, the colours
   * behind a color-contrast violation. Deliberately NOT part of the count key: tally(),
   * baselineFor() and toBaseline() all ignore it, so a11y-baseline.json's format does not move.
   */
  detail?: string
}

export type RuleCounts = Record<string, number>

function fail(message: string): never {
  throw new Error(
    `${message}\n` +
      'Refusing to assert against a baseline this file cannot trust: under count equality an ' +
      'empty baseline is a PASSING state, not the strictest one.',
  )
}

/**
 * Parses and validates the committed baseline. Every failure path throws.
 *
 * `expectedLabels` is checked because the count scheme claims "the baseline cannot rot" — and that
 * claim is false for any entry whose label no test scans. An orphaned or mistyped label is asserted
 * by nobody, can never be tightened, and emits no signal in either direction.
 */
export function parseBaseline(raw: string, expectedLabels: readonly string[]): BaselineEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    fail(`a11y baseline is not valid JSON: ${(err as Error).message}`)
  }
  if (!Array.isArray(parsed)) fail('a11y baseline must be a JSON array')

  const seen = new Set<string>()
  return parsed.map((entry: unknown, i: number): BaselineEntry => {
    if (typeof entry !== 'object' || entry === null) {
      fail(`a11y baseline entry ${i} is not an object`)
    }
    const { label, ruleId, count } = entry as Record<string, unknown>
    if (typeof label !== 'string' || !label) fail(`a11y baseline entry ${i} has no label`)
    if (typeof ruleId !== 'string' || !ruleId) fail(`a11y baseline entry ${i} has no ruleId`)
    // A zero is rejected rather than tolerated: the format omits zeroes, so `"count": 0` means
    // someone recorded a fix instead of deleting the line. Equality would then compare {rule: 0}
    // against an observed map that omits the rule entirely — a permanent red whose fix is not
    // obvious from the diff.
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
      fail(
        `a11y baseline entry ${i} (${label} ${ruleId}) must have an integer count >= 1, got ` +
          `${String(count)}`,
      )
    }
    if (!expectedLabels.includes(label)) {
      fail(
        `a11y baseline entry ${i} has label "${label}", which no test scans. Expected one of: ` +
          `${expectedLabels.join(', ')}.`,
      )
    }
    const key = `${label} ${ruleId}`
    // Harmless under the old Set-keyed scheme; under counts a sloppy merge silently discards a value.
    if (seen.has(key)) fail(`a11y baseline has duplicate entries for "${key}"`)
    seen.add(key)
    return { label, ruleId, count }
  })
}

export function tally(findings: readonly Finding[]): RuleCounts {
  const counts: RuleCounts = {}
  for (const finding of findings) counts[finding.ruleId] = (counts[finding.ruleId] ?? 0) + 1
  return counts
}

/**
 * The expected counts for one surface. A label with no entries yields `{}`, which is what makes a
 * cleared surface assert that it STAYS cleared.
 *
 * Never returns a key with an `undefined` value: Playwright's `toEqual` treats an undefined-valued
 * key as absent, so building this map by indexing a rule list would silently equate "baselined as
 * undefined" with "not baselined".
 */
export function baselineFor(entries: readonly BaselineEntry[], label: string): RuleCounts {
  const counts: RuleCounts = {}
  for (const entry of entries) if (entry.label === label) counts[entry.ruleId] = entry.count
  return counts
}

/**
 * Builds a baseline from raw findings — the `E2E_A11Y_UPDATE_BASELINE=1` writer path.
 *
 * Deliberately counts every finding, with no de-duplication: `tally()` (what the asserting run
 * compares against) doesn't de-dupe either, and the two must agree. If axe ever emits two nodes
 * with the same joined target under one rule, de-duplicating here alone would record N-1 while the
 * asserter computes N — a permanent red that regenerating the baseline could never clear.
 */
export function toBaseline(findings: readonly Finding[]): BaselineEntry[] {
  const entries = new Map<string, BaselineEntry>()
  for (const finding of findings) {
    const key = `${finding.label} ${finding.ruleId}`
    const existing = entries.get(key)
    if (existing) existing.count += 1
    else entries.set(key, { label: finding.label, ruleId: finding.ruleId, count: 1 })
  }
  return [...entries.values()].sort(
    (a, b) => a.label.localeCompare(b.label) || a.ruleId.localeCompare(b.ruleId),
  )
}

/** As much of axe's color-contrast check data as the log needs. */
export interface ContrastData {
  fgColor?: string
  bgColor?: string
  contrastRatio?: number
  expectedContrastRatio?: string
}

/**
 * `#8a8a8a on #f4e4c1 — 2.9:1 (needs 4.5:1)`.
 *
 * The count-keyed baseline cannot distinguish one contrast failure from another at equal count —
 * that trade is recorded in the design spec. This is the compensation: the colours reach the CI log,
 * which is what makes the deferred contrast redesign easy to start, and they cost nothing because
 * axe already returns them.
 */
export function formatContrast(data: ContrastData | undefined): string | undefined {
  if (!data?.fgColor || !data.bgColor) return undefined
  const ratio = typeof data.contrastRatio === 'number' ? `${data.contrastRatio}:1` : 'unknown ratio'
  const needs = data.expectedContrastRatio ? ` (needs ${data.expectedContrastRatio})` : ''
  return `${data.fgColor} on ${data.bgColor} — ${ratio}${needs}`
}

/**
 * Counts alone do not say WHICH node regressed. This goes into the assertion's message argument and
 * into the unconditional log line, so the precision the count format drops is still on screen.
 */
export function formatFindings(findings: readonly Finding[]): string {
  if (!findings.length) return '  (no violations)'
  return [...findings]
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.target.localeCompare(b.target))
    .flatMap((finding) =>
      finding.detail
        ? [`  ${finding.ruleId}  ${finding.target}`, `                  ${finding.detail}`]
        : [`  ${finding.ruleId}  ${finding.target}`],
    )
    .join('\n')
}

/**
 * Every label tests/e2e/a11y.spec.ts actually scans, read out of its source text.
 *
 * parseBaseline() already rejects a baseline entry whose label is not in EXPECTED_LABELS. This is
 * the other direction: a label in EXPECTED_LABELS with no test scans nothing, asserts nothing, and
 * emits no signal in either direction. The afterAll guard cannot cover it — it only runs in update
 * mode, and it cannot move, because Playwright discards a worker after a failure and the check
 * would re-fire spuriously in every restarted worker.
 *
 * THROWS when it finds no call sites, which is the load-bearing part. A text parser whose regex
 * stops matching — after a rename, a reformat, a refactor — would otherwise report "no labels",
 * compare equal to nothing, and pass vacuously. Failing loudly on "found nothing" is the only thing
 * that makes a check like this trustworthy.
 *
 * Does NOT detect a `.skip`'d test: the call site is still in the source.
 */
export function parseScanCallSites(specSource: string): string[] {
  const args = [...specSource.matchAll(/scanAndAssert\(\s*page\s*,\s*([^)]+?)\s*\)/g)].map(
    (match) => match[1],
  )
  if (!args.length) {
    fail(
      'parseScanCallSites found no scanAndAssert(page, …) calls in the spec source. The helper was ' +
        'probably renamed or its call shape changed. Fix this parser rather than deleting it, or ' +
        'the EXPECTED_LABELS coverage check silently passes against an empty set.',
    )
  }
  const themes = [...new Set([...specSource.matchAll(/'(cork|brutal|glass)'/g)].map((m) => m[1]))]
  return args.flatMap((arg) => {
    const literal = /^'([^']+)'$/.exec(arg)
    if (literal) return [literal[1]]
    if (/^`board-\$\{theme\}`$/.test(arg)) {
      if (!themes.length) {
        fail('parseScanCallSites found the board loop but no theme literals to expand it with.')
      }
      return themes.map((theme) => `board-${theme}`)
    }
    return fail(`parseScanCallSites cannot resolve the scanAndAssert argument: ${arg}`)
  })
}
