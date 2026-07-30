import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  baselineFor,
  EXPECTED_LABELS,
  formatFindings,
  parseBaseline,
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
