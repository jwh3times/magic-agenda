import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  baselineFor,
  EXPECTED_LABELS,
  formatContrast,
  formatFindings,
  parseBaseline,
  parseScanCallSites,
  tally,
  toBaseline,
  type Finding,
} from './a11y-baseline'

const LABELS = ['landing', 'login', 'board-cork'] as const

const f = (label: string, ruleId: string, target: string): Finding => ({ label, ruleId, target })

describe('parseBaseline', () => {
  it('accepts a well-formed baseline', () => {
    const raw = JSON.stringify([{ label: 'landing', ruleId: 'color-contrast', count: 1 }])
    expect(parseBaseline(raw, LABELS)).toEqual([
      { label: 'landing', ruleId: 'color-contrast', count: 1 },
    ])
  })

  // Under the old increases-only scheme an empty baseline was the STRICTEST possible state, so
  // swallowing a read error was survivable. Under equality it is a passing state, so every
  // malformed input must throw instead.
  it('throws on invalid JSON rather than returning an empty baseline', () => {
    expect(() => parseBaseline('<<<<<<< HEAD', LABELS)).toThrow(/not valid JSON/)
  })

  it('throws when the top level is not an array', () => {
    expect(() => parseBaseline('{}', LABELS)).toThrow(/must be a JSON array/)
  })

  it('throws on a label no test scans', () => {
    const raw = JSON.stringify([{ label: 'board-corK', ruleId: 'region', count: 1 }])
    expect(() => parseBaseline(raw, LABELS)).toThrow(/which no test scans/)
  })

  it('throws on a duplicate label+rule pair', () => {
    const raw = JSON.stringify([
      { label: 'login', ruleId: 'region', count: 1 },
      { label: 'login', ruleId: 'region', count: 2 },
    ])
    expect(() => parseBaseline(raw, LABELS)).toThrow(/duplicate entries/)
  })

  it('throws on count: 0 instead of tolerating it', () => {
    const raw = JSON.stringify([{ label: 'login', ruleId: 'region', count: 0 }])
    expect(() => parseBaseline(raw, LABELS)).toThrow(/integer count >= 1/)
  })

  it('throws on a non-integer count', () => {
    const raw = JSON.stringify([{ label: 'login', ruleId: 'region', count: 1.5 }])
    expect(() => parseBaseline(raw, LABELS)).toThrow(/integer count >= 1/)
  })

  it('throws on a missing ruleId', () => {
    const raw = JSON.stringify([{ label: 'login', count: 1 }])
    expect(() => parseBaseline(raw, LABELS)).toThrow(/has no ruleId/)
  })
})

describe('tally', () => {
  it('counts findings per rule', () => {
    const found = [
      f('login', 'region', 'p'),
      f('login', 'region', 'img'),
      f('login', 'color-contrast', 'button'),
    ]
    expect(tally(found)).toEqual({ region: 2, 'color-contrast': 1 })
  })

  it('returns an empty object for a clean surface', () => {
    expect(tally([])).toEqual({})
  })
})

describe('baselineFor', () => {
  const entries = [
    { label: 'login', ruleId: 'color-contrast', count: 1 },
    { label: 'landing', ruleId: 'color-contrast', count: 4 },
  ]

  it('selects only the requested label', () => {
    expect(baselineFor(entries, 'login')).toEqual({ 'color-contrast': 1 })
  })

  // An absent label means "expect zero violations", which is what makes a cleared surface assert
  // that it stays cleared.
  it('returns an empty object for a label with no entries', () => {
    expect(baselineFor(entries, 'board-cork')).toEqual({})
  })
})

describe('toBaseline', () => {
  it('groups by label and rule, sorted, with no zero entries', () => {
    const found = [
      f('login', 'region', 'p'),
      f('landing', 'color-contrast', 'a'),
      f('login', 'region', 'img'),
    ]
    expect(toBaseline(found)).toEqual([
      { label: 'landing', ruleId: 'color-contrast', count: 1 },
      { label: 'login', ruleId: 'region', count: 2 },
    ])
  })

  // toBaseline() must agree with tally(): both count every finding, with no de-duplication. If axe
  // ever emits two nodes with the same joined target under one rule, de-duplicating only here would
  // record N-1 while the asserter (tally()) computes N — a permanent, unfixable red.
  it('counts every finding, even with an identical label+rule+target triple', () => {
    const found = [f('login', 'region', 'p'), f('login', 'region', 'p')]
    expect(toBaseline(found)).toEqual([{ label: 'login', ruleId: 'region', count: 2 }])
  })
})

describe('formatFindings', () => {
  it('lists rule and target one per line, sorted', () => {
    const found = [f('login', 'region', 'p'), f('login', 'color-contrast', 'button')]
    expect(formatFindings(found)).toBe('  color-contrast  button\n  region  p')
  })

  it('says so explicitly when there is nothing to list', () => {
    expect(formatFindings([])).toBe('  (no violations)')
  })
})

describe('formatContrast', () => {
  it('renders the colours, the ratio and the threshold', () => {
    expect(
      formatContrast({
        fgColor: '#8a8a8a',
        bgColor: '#f4e4c1',
        contrastRatio: 2.9,
        expectedContrastRatio: '4.5:1',
      }),
    ).toBe('#8a8a8a on #f4e4c1 — 2.9:1 (needs 4.5:1)')
  })

  // axe omits the colours whenever it could not resolve them — a background image in the element
  // stack, an unparseable colour. That path yields an INCOMPLETE rather than a violation so it
  // should never reach here, but printing "undefined on undefined" into a CI log would be worse
  // than printing nothing.
  it('returns undefined when either colour is missing', () => {
    expect(formatContrast({ bgColor: '#fff', contrastRatio: 2 })).toBeUndefined()
    expect(formatContrast({ fgColor: '#000', contrastRatio: 2 })).toBeUndefined()
    expect(formatContrast(undefined)).toBeUndefined()
  })

  it('degrades gracefully when the ratio or threshold is missing', () => {
    expect(formatContrast({ fgColor: '#000', bgColor: '#fff' })).toBe(
      '#000 on #fff — unknown ratio',
    )
  })
})

describe('formatFindings with detail', () => {
  it('prints the detail on its own indented line', () => {
    const found = [
      { label: 'board-cork', ruleId: 'color-contrast', target: 'span', detail: '#a on #b — 2:1' },
    ]
    expect(formatFindings(found)).toBe('  color-contrast  span\n                  #a on #b — 2:1')
  })

  it('prints one line for a finding with no detail', () => {
    const found = [{ label: 'board-cork', ruleId: 'nested-interactive', target: 'div' }]
    expect(formatFindings(found)).toBe('  nested-interactive  div')
  })
})

describe('the committed baseline', () => {
  // The validator itself only runs inside tests/e2e/a11y.spec.ts, which needs a deployed preview
  // and the E2E account's credentials. Without this, a malformed baseline is discovered by a red
  // required check on a PR rather than by `npm test` on a laptop.
  //
  // The length assertion is deliberate and load-bearing, not a sanity check left over from
  // scaffolding: under count equality `[]` is a legitimate PASSING baseline ("expect zero
  // violations everywhere"), so a deleted or truncated file is otherwise indistinguishable from
  // total success. When the last baselined violation is genuinely cleared, whoever deletes the
  // final entry SHOULD be forced to touch this line and think about whether that's really what
  // happened. Do not weaken or remove it.
  it('parses, and names only labels the suite scans', () => {
    const raw = readFileSync(path.join('tests', 'e2e', 'a11y-baseline.json'), 'utf8')
    const entries = parseBaseline(raw, EXPECTED_LABELS)
    expect(entries.length).toBeGreaterThan(0)
  })
})

describe('parseScanCallSites', () => {
  it('reads plain string-literal call sites', () => {
    const src = `
      await scanAndAssert(page, 'landing')
      await scanAndAssert(page, 'login')
    `
    expect(parseScanCallSites(src)).toEqual(['landing', 'login'])
  })

  it('expands the board template against the theme literals in the same source', () => {
    const src = `
      for (const theme of ['cork', 'brutal', 'glass'] as Theme[]) {
        await scanAndAssert(page, \`board-\${theme}\`)
      }
    `
    expect(parseScanCallSites(src)).toEqual(['board-cork', 'board-brutal', 'board-glass'])
  })

  // The whole risk of a text-parsing check: if the regex stops matching after a rename or a
  // refactor, it would report "no labels", compare equal to nothing, and pass vacuously. That is
  // the exact silent rot this check exists to prevent, so finding nothing must be an ERROR.
  it('throws rather than returning an empty list when nothing matches', () => {
    expect(() => parseScanCallSites('const x = 1')).toThrow(/found no scanAndAssert/)
  })

  it('throws when the board template has no theme literals to expand', () => {
    expect(() => parseScanCallSites('await scanAndAssert(page, `board-${theme}`)')).toThrow(
      /no theme literals/,
    )
  })

  it('throws on an argument shape it cannot resolve', () => {
    expect(() => parseScanCallSites('await scanAndAssert(page, someVariable)')).toThrow(
      /cannot resolve/,
    )
  })

  it('matches the committed spec exactly against EXPECTED_LABELS', () => {
    const src = readFileSync(path.join('tests', 'e2e', 'a11y.spec.ts'), 'utf8')
    expect([...parseScanCallSites(src)].sort()).toEqual([...EXPECTED_LABELS].sort())
  })
})
