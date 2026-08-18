# A11y Landmarks + Counts-Based Ratchet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the 177 structural accessibility violations (landmarks, page headings, control names) and replace the Playwright a11y baseline's brittle CSS-target keys with per-surface, per-rule counts that survive DOM changes.

**Architecture:** The pure baseline logic moves into `scripts/a11y-baseline.ts` so it can be unit-tested by `npm test` — the E2E spec itself cannot run without a deployed preview and the E2E account's credentials, so anything asserted only inside it is untested in practice. This mirrors `src/sw/policy.ts` (split from `src/sw.ts`) and `tests/rls/reloptions.ts` (split from its test). The app changes are eight small edits that add native HTML landmark elements and one `<h1>` per page, each keeping its existing inline style object.

**Tech Stack:** React 19 + TypeScript, Vitest (jsdom), Playwright 1.62 + `@axe-core/playwright` 4.12.1, axe-core 4.12.1.

**Spec:** `docs/superpowers/specs/2026-07-30-a11y-landmarks-design.md` — read it before starting. It records _why_ each of these changes is shaped the way it is, and several are non-obvious.

## Global Constraints

- **Theming is inline style objects, never CSS.** Every structural edit renames an element and keeps its existing inline `style={...}` verbatim. Do not extract anything to a CSS class or CSS variable. (`AGENTS.md`, "Theming is an inline-style-object model, not CSS".)
- **`src/dnd` is not touched by this plan.** The 9 `nested-interactive` violations stay baselined.
- **`src/theme/themeConf.ts` is not touched by this plan.** The 16 `color-contrast` violations stay baselined.
- **`design/Task Board.dc.html` is reference-only and must not be edited.**
- **`tests/**` stays excluded from `npm test`** (`vite.config.ts:56`). That is why the pure logic lands in `scripts/`, which `npm test` does collect.
- **The service-role key must never be used or added anywhere.** E2E drives one dedicated account with the anon key plus that account's own credentials.
- **`main` is PR-only.** Work on a branch; `feat/a11y-landmarks` already exists and carries the spec commits.
- Every step's `git commit` must end with the two trailer lines used elsewhere in this branch:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013hHaNZxiiDYHhzeoRbCUgp
  ```

## File Structure

| File                                      | Responsibility                                                                                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/a11y-baseline.ts`                | **New.** Pure baseline logic: parse + validate, tally findings, look up a label's expected counts, build a baseline from findings, format findings for a failure message. No I/O, no Playwright. |
| `scripts/a11y-baseline.test.ts`           | **New.** Vitest unit tests for the above. Runs in `npm test`.                                                                                                                                    |
| `tsconfig.node.json`                      | Gains the two new files in `include` (explicit file list, matching `tsconfig.worker.json`'s pattern).                                                                                            |
| `package.json`                            | `format` / `format:check` globs gain `scripts/*.ts`.                                                                                                                                             |
| `tests/e2e/a11y.spec.ts`                  | Rewired to the module; gains animation freeze, the settings heading wait, the third seeded-card wait, the unconditional log line, and a corrected `page.clock` rationale.                        |
| `tests/e2e/a11y-baseline.json`            | Replaced: 810 lines of `{ruleId, target}` → 8 entries of `{label, ruleId, count}`.                                                                                                               |
| `src/components/Board.tsx`                | The view/Inbox flex wrapper becomes `<main>`.                                                                                                                                                    |
| `src/components/Toolbar.tsx`              | Both branches: root becomes `<header>`; logo `<img>` gains an `<h1>` wrapper.                                                                                                                    |
| `src/components/SearchFilterBar.tsx`      | Root becomes `<search>`; the two selects and the input gain `aria-label`s.                                                                                                                       |
| `src/components/Inbox.tsx`                | Root becomes `<aside aria-label="Inbox">`.                                                                                                                                                       |
| `src/pages/Login.tsx`                     | Card becomes `<main>`; logo `<img>` gains an `<h1>` wrapper.                                                                                                                                     |
| `src/pages/SettingsPage.tsx`              | Sections wrapped in a **styled** `<main>`.                                                                                                                                                       |
| `src/pages/Landing.tsx`                   | The two unnamed `<section>`s gain distinct `aria-label`s.                                                                                                                                        |
| `src/components/LegalLayout.tsx`          | `<header>` around the logo link, `<main>` from the `<h1>` through the contact block.                                                                                                             |
| `.github/dependabot.yml`                  | `@axe-core/playwright` + `@playwright/test` move to their own group.                                                                                                                             |
| `AGENTS.md`, `ROADMAP.md`, `CHANGELOG.md` | Realigned.                                                                                                                                                                                       |

---

### Task 1: Pure baseline module + unit tests

**Files:**

- Create: `scripts/a11y-baseline.ts`
- Create: `scripts/a11y-baseline.test.ts`
- Modify: `tsconfig.node.json:31` (the `include` array)
- Modify: `package.json` (`format` and `format:check` scripts)

**Interfaces:**

- Consumes: nothing.
- Produces, all imported by Task 2:
  - `interface BaselineEntry { label: string; ruleId: string; count: number }`
  - `interface Finding { label: string; ruleId: string; target: string }`
  - `type RuleCounts = Record<string, number>`
  - `parseBaseline(raw: string, expectedLabels: readonly string[]): BaselineEntry[]` — throws on anything malformed
  - `tally(findings: readonly Finding[]): RuleCounts`
  - `baselineFor(entries: readonly BaselineEntry[], label: string): RuleCounts`
  - `toBaseline(findings: readonly Finding[]): BaselineEntry[]`
  - `formatFindings(findings: readonly Finding[]): string`

- [ ] **Step 1: Write the failing test**

Create `scripts/a11y-baseline.test.ts`. Note the explicit `vitest` imports — `tsconfig.node.json` does not carry `vitest/globals`, and `src/sw/policy.test.ts` sets the same precedent.

```ts
import { describe, expect, it } from 'vitest'
import {
  baselineFor,
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

  it('de-duplicates identical label+rule+target triples', () => {
    const found = [f('login', 'region', 'p'), f('login', 'region', 'p')]
    expect(toBaseline(found)).toEqual([{ label: 'login', ruleId: 'region', count: 1 }])
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run scripts/a11y-baseline.test.ts`
Expected: FAIL — `Failed to resolve import "./a11y-baseline"`.

- [ ] **Step 3: Write the implementation**

Create `scripts/a11y-baseline.ts`:

```ts
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

export interface Finding {
  /** Its own field, deliberately NOT parsed back out of `target`: axe targets are full of colons. */
  label: string
  ruleId: string
  target: string
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

/** Builds a baseline from raw findings — the `E2E_A11Y_UPDATE_BASELINE=1` writer path. */
export function toBaseline(findings: readonly Finding[]): BaselineEntry[] {
  const unique = new Map<string, Finding>()
  for (const finding of findings) {
    unique.set(`${finding.label} ${finding.ruleId} ${finding.target}`, finding)
  }
  const entries = new Map<string, BaselineEntry>()
  for (const finding of unique.values()) {
    const key = `${finding.label} ${finding.ruleId}`
    const existing = entries.get(key)
    if (existing) existing.count += 1
    else entries.set(key, { label: finding.label, ruleId: finding.ruleId, count: 1 })
  }
  return [...entries.values()].sort(
    (a, b) => a.label.localeCompare(b.label) || a.ruleId.localeCompare(b.ruleId),
  )
}

/**
 * Counts alone do not say WHICH node regressed. This goes into the assertion's message argument and
 * into the unconditional log line, so the precision the count format drops is still on screen.
 */
export function formatFindings(findings: readonly Finding[]): string {
  if (!findings.length) return '  (no violations)'
  return [...findings]
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.target.localeCompare(b.target))
    .map((finding) => `  ${finding.ruleId}  ${finding.target}`)
    .join('\n')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run scripts/a11y-baseline.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Put both files under `tsc -b` and prettier**

In `tsconfig.node.json`, replace the `include` line:

```json
  "include": [
    "vite.config.ts",
    "vitest.rls.config.ts",
    "scripts/a11y-baseline.ts",
    "scripts/a11y-baseline.test.ts"
  ]
```

An explicit file list, not `"scripts"` — the same reasoning as `tsconfig.worker.json`'s comment: a glob would sweep in the `.mjs` scripts, which are deliberately untyped.

In `package.json`, add `"scripts/*.ts"` to both format scripts:

```json
    "format": "prettier --write \"src/**/*.{ts,tsx,css}\" \"tests/**/*.ts\" \"scripts/*.ts\" playwright.config.ts vitest.rls.config.ts",
    "format:check": "prettier --check \"src/**/*.{ts,tsx,css}\" \"tests/**/*.ts\" \"scripts/*.ts\" playwright.config.ts vitest.rls.config.ts",
```

- [ ] **Step 6: Run the full gate**

Run: `npm run format && npm run lint && npm run build && npm test`
Expected: all four pass. `npm run build` runs `tsc -b`, which now typechecks the two new files.

- [ ] **Step 7: Commit**

```bash
git add scripts/a11y-baseline.ts scripts/a11y-baseline.test.ts tsconfig.node.json package.json
git commit -m "test(e2e): extract the a11y baseline logic and unit-test it

The spec that uses it cannot run without a deployed preview and the E2E
account's credentials, so validation asserted only inside it would never
execute. Same split as src/sw/policy.ts and tests/rls/reloptions.ts.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013hHaNZxiiDYHhzeoRbCUgp"
```

---

### Task 2: Rewire the a11y spec to counts

**Files:**

- Modify: `tests/e2e/a11y.spec.ts` (full rewrite)
- Modify: `tests/e2e/a11y-baseline.json` (full replacement)

**Interfaces:**

- Consumes: everything Task 1 produces.
- Produces: the new `a11y-baseline.json` format, which Task 9 updates with real numbers.

> This task cannot be verified by running the E2E suite locally — that needs `E2E_BASE_URL` pointed at a deployed preview plus `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD`, which exist only as repository secrets. `tsc -b`, `eslint` and `prettier` are the gates here; CI is the gate in Task 9. **`E2E` will be red from this commit until Task 9 — that is expected and planned for.**

- [ ] **Step 1: Replace the baseline file**

Overwrite `tests/e2e/a11y-baseline.json` with exactly:

```json
[
  {
    "label": "board-brutal",
    "ruleId": "color-contrast",
    "count": 9
  },
  {
    "label": "board-brutal",
    "ruleId": "nested-interactive",
    "count": 3
  },
  {
    "label": "board-cork",
    "ruleId": "color-contrast",
    "count": 3
  },
  {
    "label": "board-cork",
    "ruleId": "nested-interactive",
    "count": 3
  },
  {
    "label": "board-glass",
    "ruleId": "color-contrast",
    "count": 2
  },
  {
    "label": "board-glass",
    "ruleId": "nested-interactive",
    "count": 3
  },
  {
    "label": "landing",
    "ruleId": "color-contrast",
    "count": 1
  },
  {
    "label": "login",
    "ruleId": "color-contrast",
    "count": 1
  }
]
```

These are the `color-contrast` and `nested-interactive` tallies of the old file, which are the two families this work does not touch. `settings` is deliberately absent — it predicts to zero. Every other pair is expected to clear.

- [ ] **Step 2: Rewrite the spec**

Overwrite `tests/e2e/a11y.spec.ts` with:

```ts
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { seedBoard, SEEDED_TITLES, type Theme } from './fixtures/seedBoard'
import {
  baselineFor,
  formatFindings,
  parseBaseline,
  tally,
  toBaseline,
  type BaselineEntry,
  type Finding,
} from '../../scripts/a11y-baseline'

// Fixing what this finds is IN scope for the structural rules — landmarks, page headings, control
// names — and OUT of scope for the two families still baselined:
//
//   color-contrast      lives in src/theme/themeConf.ts, a deliberate verbatim port of
//                       design/Task Board.dc.html. Clearing it is a contrast redesign of three
//                       themes, which is a different project with a different risk profile.
//   nested-interactive  src/dnd/SortableCard.tsx spreads dnd-kit's attributes (including
//                       role="button") onto the wrapper around TaskCard's pin and done buttons.
//                       Clearing it means changing how the activator is attached — editing src/dnd.
//
// The baseline is JSON and takes no comments, which is why this note lives here.
const BASELINE = path.join('tests', 'e2e', 'a11y-baseline.json')

// Every surface this file scans. parseBaseline() rejects any baseline entry whose label is not in
// this list, and the afterAll writer refuses to run unless all of them scanned in THIS worker.
const EXPECTED_LABELS = [
  'landing',
  'login',
  'settings',
  'board-cork',
  'board-brutal',
  'board-glass',
] as const

/**
 * page.clock does NOT freeze CSS animations — they run on the compositor's own timeline. The glass
 * theme's three blobs (src/theme/chrome.ts, @keyframes blobFloat in src/index.css) are therefore at
 * an arbitrary phase when axe runs, a function of how long seeding and the waits took on that runner.
 *
 * That moves a COUNT, not just a selector path. axe's getBackgroundColor walks elementsFromPoint and
 * bails to `bgColor: 'bgGradient'` the moment a background-image is in the stack, which makes the
 * node INCOMPLETE — and incompletes are not in results.violations. Glass is exactly where axe has to
 * walk deep, because every background above #0b0f1f is translucent, so a blob drifting over the
 * ViewSwitcher silently converts a color-contrast violation into an incomplete.
 *
 * The old ratchet keyed on {ruleId, target} and failed only on NEW pairs, so it tolerated that. This
 * one asserts counts by equality, so it does not. Do not remove this.
 */
const FREEZE_ANIMATION = `*, *::before, *::after {
  animation: none !important;
  transition: none !important;
}`

/** Everything every surface needs between "content is on screen" and "scan it". */
async function settle(page: Page): Promise<void> {
  await page.addStyleTag({ content: FREEZE_ANIMATION })
  await page.evaluate(async () => {
    await document.fonts.ready
  })
}

/**
 * No try/catch, on purpose.
 *
 * This is only reached in asserting mode, where a missing, truncated or conflict-markered baseline
 * must be an error. Under the old increases-only scheme an empty baseline was the STRICTEST possible
 * state — every finding is new — so swallowing a read error was survivable. Under equality, an empty
 * baseline means "expect zero violations everywhere", which is a legitimate PASSING state. The moment
 * the last baselined violation is fixed, a deleted baseline becomes indistinguishable from success.
 */
function readBaseline(): BaselineEntry[] {
  return parseBaseline(readFileSync(BASELINE, 'utf8'), EXPECTED_LABELS)
}

/** Set E2E_A11Y_UPDATE_BASELINE=1 to rewrite the baseline instead of asserting against it. */
const UPDATING = process.env.E2E_A11Y_UPDATE_BASELINE === '1'
const collected: Finding[] = []
const scanned = new Set<string>()

async function scan(page: Page, label: string): Promise<Finding[]> {
  const results = await new AxeBuilder({ page }).analyze()
  // Recorded separately from the findings: a clean surface yields zero findings, so its label would
  // otherwise be indistinguishable from a surface that never ran at all.
  scanned.add(label)
  const found = results.violations.flatMap((violation) =>
    violation.nodes.map((node) => ({
      label,
      ruleId: violation.id,
      target: node.target.join(' '),
    })),
  )
  // Unconditional, and BEFORE the assertion. In practice a baseline is produced by reading numbers
  // out of a CI log — the update mode needs the E2E account's credentials, which exist only as
  // repository secrets. Logging after the assert would skip every surface that fails, costing
  // another serialised run on a required check that also holds the single e2e-prod-account
  // concurrency slot.
  console.log(`[a11y] ${label} ${JSON.stringify(tally(found))}\n${formatFindings(found)}`)
  return found
}

test.afterAll(() => {
  if (!UPDATING) return

  // Refuse to write a partial baseline.
  //
  // `collected` and `scanned` are module state and afterAll runs PER WORKER. Playwright discards a
  // worker after a test failure and continues in a fresh process, so a mid-run failure would
  // otherwise write a baseline holding only what the surviving worker saw -- silently dropping every
  // entry for the surfaces that ran before it. A filtered regeneration (`-g "landing"`) does the
  // same thing. Both look like success, and both quietly disarm the ratchet.
  const missing = EXPECTED_LABELS.filter((label) => !scanned.has(label))
  if (missing.length) {
    throw new Error(
      `Refusing to write a partial a11y baseline: ${missing.join(', ')} did not scan in this worker.\n` +
        'Regenerate with a full, unfiltered run:\n' +
        '  E2E_A11Y_UPDATE_BASELINE=1 npm run test:e2e -- a11y.spec.ts',
    )
  }

  writeFileSync(BASELINE, `${JSON.stringify(toBaseline(collected), null, 2)}\n`)
})

/**
 * Strict equality, in both directions.
 *
 * A count that ROSE is a regression. A count that FELL means the baseline is stale — which is a
 * failure on purpose: tolerating it is what lets a ratchet's ceiling drift above reality and stop
 * being a ratchet.
 */
async function scanAndAssert(page: Page, label: string): Promise<void> {
  const found = await scan(page, label)
  if (UPDATING) {
    collected.push(...found)
    return
  }
  expect(
    tally(found),
    `a11y violation counts changed on "${label}".\n` +
      'A count that ROSE is a regression — fix it.\n' +
      'A count that FELL means the baseline is stale — commit the lower number.\n' +
      'Observed violations:\n' +
      formatFindings(found),
  ).toEqual(baselineFor(readBaseline(), label))
}

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('landing matches the a11y baseline', async ({ page }) => {
    await page.goto('/')
    await settle(page)
    await scanAndAssert(page, 'landing')
  })

  test('login matches the a11y baseline', async ({ page }) => {
    await page.goto('/login')
    await settle(page)
    await scanAndAssert(page, 'login')
  })
})

/**
 * The board's shape is a function of today's date, and it must not drift between runs. Pinning the
 * browser clock and seeding to the SAME day is what makes the calendar grid identical every time.
 *
 * This used to be justified by the baseline keying on axe's CSS target paths. It no longer keys on
 * paths — but the pinning is still load-bearing, for a different reason: `brutal` flags the trailing
 * OUT-OF-MONTH cells, and how many of those the fixed 42-cell grid carries is a function of the
 * month. Unpin the clock and the color-contrast count moves.
 *
 * The two must agree: `page.clock` moves only the browser, while `seedBoard` runs in the test
 * process in real time. Pinning the clock without passing the matching `anchor` puts the seeded rows
 * outside the rendered month -- see the header comment in fixtures/seedBoard.ts.
 */
const PINNED_DAY = '2026-06-15'
const PINNED_TIME = `${PINNED_DAY}T12:00:00Z`

test.describe('signed in', () => {
  test('settings matches the a11y baseline', async ({ page }) => {
    await page.clock.setFixedTime(new Date(PINNED_TIME))
    await seedBoard({ anchor: PINNED_DAY })
    await page.goto('/settings')
    // NOT a redundant wait. SettingsPage renders <Spinner/> until the settings load resolves, and
    // Spinner is `position: fixed; inset: 0` — which axe's isModalOpen() heuristic reads as an open
    // modal (any absolute/fixed element covering >=75% of the viewport whose pointer-events is not
    // 'none'). Both page-level rules carry passForModal: true and short-circuit through
    // has-descendant-evaluate, so scanning the loading state makes landmark-one-main AND
    // page-has-heading-one pass for free. That is exactly how the pre-2026-07-30 baseline came to
    // hold one `region: #root` entry for this surface and nothing else: it never scanned the
    // settings page at all. A scan that races a loading state does not merely miss content — a
    // full-screen loader actively suppresses the page-level rules and scores clean.
    await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
    await settle(page)
    await scanAndAssert(page, 'settings')
  })

  // Contrast risk is per-theme, so each theme is its own scan. Themes are seeded into
  // user_settings and the page reloaded, rather than driven through the settings UI.
  for (const theme of ['cork', 'brutal', 'glass'] as Theme[]) {
    test(`board (${theme}) matches the a11y baseline`, async ({ page }) => {
      await page.clock.setFixedTime(new Date(PINNED_TIME))
      await seedBoard({ theme, anchor: PINNED_DAY })
      await page.goto('/')
      await page.getByRole('button', { name: '+ New task' }).waitFor()
      // All THREE seeded cards, not just the two dated ones. nested-interactive is exactly one per
      // rendered card, so a board that has painted 2 of 3 yields a count of 2 — which the old
      // increases-only ratchet passed (fewer targets, no new pair) and equality fails as a stale
      // baseline. Scanning a partly-painted board would also miss most of the per-theme CARD
      // contrast this loop exists to measure.
      for (const title of SEEDED_TITLES) await page.getByText(title).waitFor()
      await settle(page)
      await scanAndAssert(page, `board-${theme}`)
    })
  }
})
```

- [ ] **Step 3: Verify it typechecks and lints**

Run: `npm run format && npm run lint && npm run build`
Expected: all pass. If `tsc` cannot resolve `../../scripts/a11y-baseline`, confirm Task 1 Step 5 added both files to `tsconfig.node.json`.

- [ ] **Step 4: Add a permanent guard that the committed baseline is well-formed**

Nothing else checks this without credentials: the validator only runs inside the E2E spec, which needs a deployed preview. Append to `scripts/a11y-baseline.test.ts` (it must go in _this_ task, not Task 1 — before Step 1 above the committed file is still the old format and this would fail):

```ts
describe('the committed baseline', () => {
  // The validator itself only runs inside tests/e2e/a11y.spec.ts, which needs a deployed preview
  // and the E2E account's credentials. Without this, a malformed baseline is discovered by a red
  // required check on a PR rather than by `npm test` on a laptop.
  it('parses, and names only labels the suite scans', () => {
    const raw = readFileSync(path.join('tests', 'e2e', 'a11y-baseline.json'), 'utf8')
    const entries = parseBaseline(raw, [
      'landing',
      'login',
      'settings',
      'board-cork',
      'board-brutal',
      'board-glass',
    ])
    expect(entries.length).toBeGreaterThan(0)
  })
})
```

Add the two imports this needs at the top of the file:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
```

Run: `npx vitest run scripts/a11y-baseline.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/a11y.spec.ts tests/e2e/a11y-baseline.json
git commit -m "test(e2e): key the a11y ratchet on counts, not CSS target paths

Positional targets are invalidated by any DOM change, so adding
landmarks would register 21 of 25 surviving entries as new violations.
Counts survive it.

Also fixes three determinism gaps that equality (unlike increases-only)
cannot tolerate: the glass blobs animate through page.clock, the board
scan never waited for the third seeded card, and the settings scan
raced the load and was scanning the Spinner.

E2E is expected red until the structural fixes land.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013hHaNZxiiDYHhzeoRbCUgp"
```

---

### Task 3: Board chrome landmarks

**Files:**

- Modify: `src/components/Board.tsx:253-263`
- Modify: `src/components/Toolbar.tsx:49-58` and `:60-72` and `:135` and `:137-141`
- Modify: `src/components/SearchFilterBar.tsx:33-43`, `:44-49`, `:50-54`, `:62-66`
- Modify: `src/components/Inbox.tsx:30-35`
- Test: `src/components/Board.test.tsx`, `src/components/Toolbar.test.tsx`, `src/components/SearchFilterBar.test.tsx`

**Interfaces:**

- Consumes: nothing.
- Produces: the board surface exposes `banner`, `search`, `main`, `complementary` (named "Inbox") landmarks and one `<h1>` named "Magic Agenda".

- [ ] **Step 1: Write the failing tests**

Append to `src/components/Toolbar.test.tsx`:

```ts
test('the toolbar is a banner landmark carrying the page heading', () => {
  renderToolbar()
  expect(screen.getByRole('banner')).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1, name: 'Magic Agenda' })).toBeInTheDocument()
})

// jsdom has no matchMedia, so the test above renders the desktop branch. The mobile branch is a
// separate JSX tree and needs the same treatment or the phone layout keeps failing both rules.
test('the mobile toolbar is a banner landmark carrying the page heading', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })),
  )
  try {
    renderToolbar()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Magic Agenda' })).toBeInTheDocument()
  } finally {
    vi.unstubAllGlobals()
  }
})
```

Append to `src/components/SearchFilterBar.test.tsx`:

```ts
test('the filter bar is a search landmark and every control has an accessible name', () => {
  renderBar(EMPTY_FILTER, vi.fn())
  expect(screen.getByRole('search')).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Filter by category' })).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Filter by status' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Search tasks' })).toBeInTheDocument()
})
```

Append to `src/components/Board.test.tsx`, outside the `describe('mobile layout')` block, using the file's existing helper (`const renderBoard = () => render(<Harness />)`, line 41):

```ts
test('the board exposes the landmarks a screen reader navigates by', () => {
  renderBoard()
  expect(screen.getByRole('banner')).toBeInTheDocument()
  expect(screen.getByRole('search')).toBeInTheDocument()
  expect(screen.getByRole('main')).toBeInTheDocument()
  expect(screen.getByRole('complementary', { name: 'Inbox' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/Toolbar.test.tsx src/components/SearchFilterBar.test.tsx src/components/Board.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "banner"` and similar for each new assertion.

- [ ] **Step 3: Make the board's view wrapper a `<main>`**

In `src/components/Board.tsx`, the flex `<div>` opening at line 253 becomes `<main>`. Change only the tag — the style object stays byte-for-byte identical — and change the matching closing tag at line 308 from `</div>` to `</main>`.

```tsx
          <main
            style={{
              display: 'flex',
              gap: isMobile ? 10 : 18,
              flex: 1,
              minHeight: 0,
              padding: isMobile ? '10px 10px 12px' : '18px 22px 22px',
              position: 'relative',
              zIndex: 1,
            }}
          >
```

`DragOverlay` and `TaskEditor` stay outside it — neither is page content.

- [ ] **Step 4: Make both toolbar branches a `<header>` with an `<h1>`**

In `src/components/Toolbar.tsx`, the **mobile** branch: change the opening tag at line 49 from `<div` to `<header` and its matching closing tag (line 130) to `</header>`, keeping the style spread unchanged. Then wrap the logo at lines 60-72:

```tsx
<h1 style={{ margin: 0, flex: '0 1 auto', minWidth: 0 }}>
  <img
    src={logoDark}
    alt="Magic Agenda"
    style={{
      height: 44,
      display: 'block',
      // Shrinkable (unlike the buttons) so the row always fits the viewport. The flex
      // properties moved to the <h1> when it became the flex item; maxWidth keeps the
      // image itself shrinking with it.
      maxWidth: '100%',
      objectFit: 'contain',
      objectPosition: 'left center',
    }}
  />
</h1>
```

The **desktop** branch: change line 135 from `<div style={c.toolbar}>` to `<header style={c.toolbar}>` and its matching closing tag at line 185 to `</header>`. Then wrap the logo at lines 137-141:

```tsx
<h1 style={{ margin: 0, flex: 'none' }}>
  <img src={logoDark} alt="Magic Agenda" style={{ height: 80, display: 'block' }} />
</h1>
```

No `lineHeight: 0` is needed at either site: the `<img>` keeps `display: block`, so the `<h1>` contains no inline-level content and generates no line box. Zeroing the UA margin is required.

- [ ] **Step 5: Make the filter bar a `<search>` and name its controls**

In `src/components/SearchFilterBar.tsx`, change the opening tag at line 33 from `<div` to `<search` and the closing tag at line 102 to `</search>`, keeping the style object unchanged. Then add names to the three controls:

```tsx
      <input
        aria-label="Search tasks"
        value={query.text}
        onChange={(e) => onChange({ ...query, text: e.target.value })}
        placeholder="Search tasks…"
        style={{ ...control, flex: '1 1 220px', minWidth: 160 }}
      />
      <select
        aria-label="Filter by category"
        value={query.category}
        onChange={(e) => onChange({ ...query, category: e.target.value as Category | 'all' })}
        style={{ ...control, ...(isMobile && { flex: '1 1 40%', minWidth: 0 }) }}
      >
```

and the same `aria-label="Filter by status"` on the second `<select>` at line 62.

`<search>` is typed — `@types/react` 19.2.17 declares it in `JSX.IntrinsicElements` — and axe-core 4.12.1 maps the element to the `search` landmark role.

- [ ] **Step 6: Make the Inbox an `<aside>`**

In `src/components/Inbox.tsx`, change the opening tag at line 30 from `<div` to `<aside`, add the label, and change the matching closing tag at line 98 to `</aside>`:

```tsx
    <aside
      aria-label="Inbox"
      style={{
        ...c.inbox,
        ...(isMobile && { width: '100%', flex: 'none', maxHeight: collapsed ? undefined : '34vh' }),
      }}
    >
```

`<aside>` inside `<main>` is fine: `landmark-complementary-is-top-level` is disabled and deprecated in axe 4.12.1, and `landmarkIsTopLevelEvaluate` carries an explicit `!(role === 'main' && nodeRole === 'complementary')` carve-out.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/components/Toolbar.test.tsx src/components/SearchFilterBar.test.tsx src/components/Board.test.tsx`
Expected: PASS, including the pre-existing tests in all three files.

- [ ] **Step 8: Run the full gate**

Run: `npm run format && npm run lint && npm run build && npm test`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/components/Board.tsx src/components/Toolbar.tsx src/components/SearchFilterBar.tsx src/components/Inbox.tsx src/components/Board.test.tsx src/components/Toolbar.test.tsx src/components/SearchFilterBar.test.tsx
git commit -m "fix(a11y): give the board banner, search, main and complementary landmarks

Also names the two filter selects and the search input, and promotes the
toolbar logo to the page's level-one heading. Every edit renames an
element and keeps its inline style object verbatim.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013hHaNZxiiDYHhzeoRbCUgp"
```

---

### Task 4: Login landmark and heading

**Files:**

- Modify: `src/pages/Login.tsx:121-126`
- Test: `src/pages/Login.test.tsx`

**Interfaces:**

- Consumes: nothing.
- Produces: `/login` exposes a `main` landmark and one `<h1>` named "Magic Agenda".

- [ ] **Step 1: Write the failing test**

Append to `src/pages/Login.test.tsx`:

```ts
test('the sign-in card is a main landmark with the page heading', () => {
  renderLogin()
  expect(screen.getByRole('main')).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1, name: 'Magic Agenda' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/pages/Login.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "main"`.

- [ ] **Step 3: Write the implementation**

In `src/pages/Login.tsx`, change line 121 from `<div style={authCard}>` to `<main style={authCard}>`, change the matching closing tag at line 275 to `</main>`, and wrap the logo:

```tsx
<h1 style={{ margin: '0 0 6px' }}>
  <img src={logoDark} alt="Magic Agenda" style={{ height: 110, display: 'block' }} />
</h1>
```

The `<h1>` takes over the `margin: '0 0 6px'` the `<img>` carried; the img keeps `height` and `display: 'block'`. `authPage` is `display: grid; placeItems: center`, so `<main style={authCard}>` lays out identically to the div it replaces.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/pages/Login.test.tsx`
Expected: PASS, including the pre-existing tests.

- [ ] **Step 5: Verify the E2E sign-in path still resolves**

`tests/e2e/globalSetup.ts` signs in with `getByPlaceholder('you@example.com')`, `getByPlaceholder('Password')` and `getByRole('button', { name: 'Sign in', exact: true })`. None of those are affected by this change — confirm by reading the file, and do not alter them.

- [ ] **Step 6: Run the full gate**

Run: `npm run format && npm run lint && npm run build && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Login.tsx src/pages/Login.test.tsx
git commit -m "fix(a11y): make the login card a main landmark with an h1

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013hHaNZxiiDYHhzeoRbCUgp"
```

---

### Task 5: Settings main landmark

**Files:**

- Modify: `src/pages/SettingsPage.tsx:94-104`
- Test: `src/pages/SettingsPage.test.tsx`

**Interfaces:**

- Consumes: nothing.
- Produces: `/settings` exposes a `main` landmark alongside its existing `banner` and `contentinfo`.

> **This is the only edit in the plan that INSERTS an element rather than renaming one, and it breaks the layout unless the new element is styled.** `SettingsPage.tsx:76-84` is a flex column with `gap: 16` whose six children are `<header>`, four `<section style={card}>`, and `<footer>` — five 16px gaps. Wrapping the sections reduces that to three flex items; the cards become ordinary block children of the `<main>`, and `card` (`:57-62`) sets no margin, so three of the five gaps collapse to zero and the cards render flush against each other. The test below exists specifically to catch that.

- [ ] **Step 1: Write the failing test**

Append to `src/pages/SettingsPage.test.tsx`. The file's render helper is `renderPage()`, defined at line 48:

```ts
test('the settings sections sit in a main landmark that preserves their spacing', async () => {
  renderPage()
  const main = await screen.findByRole('main')
  // Not decoration. The wrapper takes over as the flex item for all four cards, and `card` sets no
  // margin — without these the inter-card gaps collapse to zero and no role-based query notices.
  expect(main).toHaveStyle({ display: 'flex', flexDirection: 'column', gap: '16px' })
  expect(within(main).getByRole('heading', { level: 2, name: 'Appearance' })).toBeInTheDocument()
  // header and footer must stay OUTSIDE main: <header>/<footer> map to banner/contentinfo only
  // while not nested in sectioning content, and <main> is sectioning content.
  expect(screen.getByRole('banner')).toBeInTheDocument()
  expect(screen.getByRole('contentinfo')).toBeInTheDocument()
})
```

Add `within` to the `@testing-library/react` import at the top of the file if it is not already there.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/pages/SettingsPage.test.tsx`
Expected: FAIL — `Unable to find role="main"`.

- [ ] **Step 3: Write the implementation**

In `src/pages/SettingsPage.tsx`, wrap the `SECTIONS.map(...)` block at lines 94-104:

```tsx
<main style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
  {SECTIONS.map((s) => (
    <section key={s.id} aria-labelledby={`settings-${s.id}`} style={card}>
      <h2
        id={`settings-${s.id}`}
        style={{ margin: '0 0 12px', fontSize: 17, fontFamily: conf.title }}
      >
        {s.title}
      </h2>
      {s.render({ defaultView, onChangeView })}
    </section>
  ))}
</main>
```

Leave `<header>` (line 85) and `<footer>` (line 106) exactly where they are, as siblings of the new `<main>`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/pages/SettingsPage.test.tsx`
Expected: PASS, including the pre-existing tests.

- [ ] **Step 5: Run the full gate**

Run: `npm run format && npm run lint && npm run build && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx
git commit -m "fix(a11y): wrap the settings sections in a main landmark

The wrapper carries display:flex + gap:16 explicitly: it becomes the
flex item for all four cards, and \`card\` sets no margin, so an unstyled
<main> would collapse three of the five inter-card gaps.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013hHaNZxiiDYHhzeoRbCUgp"
```

---

### Task 6: Landing section names and the legal-page shell

**Files:**

- Modify: `src/pages/Landing.tsx:155`, `:210`
- Modify: `src/components/LegalLayout.tsx:26-52`
- Test: `src/pages/Landing.test.tsx`, `src/pages/legal.test.tsx`

**Interfaces:**

- Consumes: nothing.
- Produces: both landing `<section>`s are named `region` landmarks; `/privacy` and `/terms` expose `banner` + `main`.

- [ ] **Step 1: Write the failing tests**

Append to `src/pages/Landing.test.tsx`:

```ts
// An unnamed <section> is not a landmark, so everything inside it fails axe's `region` rule. The two
// names must DIFFER — identical role+name pairs would fail `landmark-unique` instead.
test('both content sections are named landmarks', () => {
  renderLanding()
  expect(screen.getByRole('region', { name: 'Live board preview' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Features' })).toBeInTheDocument()
})
```

Append to `src/pages/legal.test.tsx`:

```ts
test('the legal shell wraps its content in banner and main landmarks', () => {
  render(<Privacy />)
  expect(screen.getByRole('banner')).toBeInTheDocument()
  const main = screen.getByRole('main')
  // The heading and the "last updated" line must be INSIDE main. Wrapping only {children} would
  // leave them, the logo link and the contact block outside every landmark — and no test in this
  // repo scans /privacy, so nothing else would report it.
  expect(within(main).getByRole('heading', { level: 1, name: /privacy policy/i })).toBeInTheDocument()
  expect(within(main).getByText(/Last updated:/)).toBeInTheDocument()
  expect(within(main).getByRole('link', { name: 'jerryholland00@gmail.com' })).toBeInTheDocument()
})
```

Change the import at the top of `src/pages/legal.test.tsx` to `import { render, screen, within } from '@testing-library/react'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/pages/Landing.test.tsx src/pages/legal.test.tsx`
Expected: FAIL — no `region` named "Live board preview", no `banner` on the legal page.

- [ ] **Step 3: Name the landing sections**

In `src/pages/Landing.tsx`, line 155:

```tsx
        <section aria-label="Live board preview" style={{ marginTop: isMobile ? 32 : 44 }}>
```

and line 210:

```tsx
        <section
          aria-label="Features"
          style={{
```

- [ ] **Step 4: Restructure the legal shell**

In `src/components/LegalLayout.tsx`, replace lines 26-52 (the inner `maxWidth: 760` div and its contents) with:

```tsx
<div style={{ maxWidth: 760, margin: '0 auto' }}>
  <header>
    <a href="/" aria-label="Magic Agenda home" style={{ display: 'inline-block' }}>
      <img src={logoDark} alt="Magic Agenda" style={{ height: 30, display: 'block' }} />
    </a>
  </header>
  <main>
    <h1 style={{ fontFamily: "'Caveat', cursive", fontSize: 44, margin: '18px 0 2px' }}>{title}</h1>
    <p style={{ opacity: 0.5, fontSize: 13, margin: '0 0 28px' }}>Last updated: {lastUpdated}</p>
    <div style={{ fontSize: 15, lineHeight: 1.65 }}>{children}</div>
    <div
      style={{
        marginTop: 40,
        paddingTop: 18,
        borderTop: '1px solid rgba(255,255,255,.1)',
        fontSize: 13,
        opacity: 0.6,
      }}
    >
      Questions about this policy? Contact{' '}
      <a href="mailto:jerryholland00@gmail.com" style={link}>
        jerryholland00@gmail.com
      </a>
      .
    </div>
  </main>
</div>
```

Both new elements are unstyled on purpose: the outer div is not a flex or grid container (it is `maxWidth` + `margin` only), so block children lay out exactly as they did before. This is _not_ the Task 5 situation — verify that by reading line 17-25 before proceeding.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/pages/Landing.test.tsx src/pages/legal.test.tsx`
Expected: PASS, including the pre-existing tests. `Landing.test.tsx`'s existing `getByRole('heading', { level: 1 })` must still resolve to exactly one heading — `BoardPreview` is `inert aria-hidden="true"`, so its own toolbar `<h1>` is excluded from role queries.

- [ ] **Step 6: Run the full gate**

Run: `npm run format && npm run lint && npm run build && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Landing.tsx src/components/LegalLayout.tsx src/pages/Landing.test.tsx src/pages/legal.test.tsx
git commit -m "fix(a11y): name the landing sections and add landmarks to the legal shell

/privacy and /terms are not in EXPECTED_LABELS, so the a11y ratchet does
not cover them — the tests added here are the only thing that does.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013hHaNZxiiDYHhzeoRbCUgp"
```

---

### Task 7: Isolate the E2E toolchain in Dependabot

**Files:**

- Modify: `.github/dependabot.yml` (the `groups:` block)

**Interfaces:**

- Consumes: nothing.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the group**

In `.github/dependabot.yml`, insert this group immediately **before** the `npm-minor-and-patch` group (a package matches the first group it qualifies for, so it must precede the `"*"` catch-all):

```yaml
# The E2E toolchain, isolated from the daily catch-all — all update types, not just majors.
#
# The `E2E` job CANNOT RUN on a Dependabot PR: GitHub withholds regular repository secrets
# from the `dependabot` actor, so HAS_SECRETS is "false", the gate step takes its
# `!= "true"` branch, and the job reports success having scanned nothing. An axe rule change
# or a bundled-Chromium change therefore merges green and lands red on the NEXT HUMAN PR —
# the same shape as the Changelog-backfill trap in AGENTS.md.
#
# The counts-keyed baseline does not defuse this. Selector-path churn stops mattering, but
# the old ratchet failed only on INCREASES and tolerated a bump that reduced a count; strict
# equality does not. A @playwright/test bump changes the bundled Chromium, which moves
# color-contrast counts in BOTH directions. Grouping makes such a change attributable to one
# obvious PR; it does not make it survivable.
#
# axe-core is transitive under @axe-core/playwright and Dependabot does not open
# indirect-only npm PRs, so naming the two direct packages captures the family.
e2e-toolchain:
  patterns:
    - '@axe-core/playwright'
    - '@playwright/test'
```

- [ ] **Step 2: Verify the YAML parses**

Run: `node -e "const y=require('fs').readFileSync('.github/dependabot.yml','utf8'); console.log(y.includes('e2e-toolchain') ? 'present' : 'MISSING')"`
Expected: `present`. Then confirm indentation matches the sibling groups exactly — `e2e-toolchain:` sits at the same column as `npm-minor-and-patch:`.

- [ ] **Step 3: Commit**

```bash
git add .github/dependabot.yml
git commit -m "ci: isolate @axe-core/playwright and @playwright/test from the daily group

E2E cannot run on a Dependabot PR (secrets are withheld from that actor),
so a bump merges green and breaks the next human PR. Strict count
equality makes that worse, not better: a Chromium change moves contrast
counts in both directions and the old ratchet tolerated decreases.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013hHaNZxiiDYHhzeoRbCUgp"
```

---

### Task 8: Documentation realignment

**Files:**

- Modify: `AGENTS.md:384` and the surrounding bullet list
- Modify: `ROADMAP.md:49`, `:73-74`, `:81`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace the `page.clock` rationale in `AGENTS.md`**

`AGENTS.md:384` currently ends the first bullet of "Three non-obvious constraints on the specs themselves" with:

> Where the a11y baseline needs a stable CSS-target shape, `page.clock` is pinned and the seed anchor pinned to match — the two must move together, because the clock moves only the browser while `seedBoard` runs in the test process in real time.

Replace that sentence with:

```
  The a11y baseline no longer keys on CSS target paths, but `page.clock` is still pinned and the
  seed anchor pinned to match — for a different reason: `brutal` flags the trailing out-of-month
  cells, and how many of those the fixed 42-cell grid carries is a function of the month, so an
  unpinned clock moves a `color-contrast` count. The two must move together, because the clock
  moves only the browser while `seedBoard` runs in the test process in real time.
```

Do **not** delete the sentence outright — the pinning is still load-bearing and an unexplained `page.clock` call is the next thing someone removes as obsolete.

- [ ] **Step 2: Add two constraints to the same list in `AGENTS.md`**

Append these bullets after the `context.setOffline(true)` bullet that closes the list:

```
- **A scan that races a loading state scores clean, it does not merely miss content.** `<Spinner/>`
  is `position: fixed; inset: 0`, and axe's `isModalOpen()` heuristic treats any absolute/fixed
  element covering ≥75% of the viewport as an open modal. `landmark-one-main` and
  `page-has-heading-one` both carry `passForModal: true`, so they pass for free against a loading
  screen. That is how the original baseline came to hold a single `region: #root` entry for
  `settings` and nothing else: it never scanned the settings page. Every scan waits for real
  content, and `FREEZE_ANIMATION` is injected before every scan because `page.clock` does not stop
  CSS animations and a drifting glass blob turns a `color-contrast` violation into an `incomplete`.
- **The a11y baseline asserts counts by strict equality, in both directions.** A count that rose is
  a regression; a count that FELL means the baseline is stale and the lower number must be
  committed. That second direction is deliberate — tolerating it is what lets a ratchet's ceiling
  drift above reality — but it has one confusing consequence: any merge that lands without an E2E
  run (a non-PR event, a fork PR, a Dependabot PR) and incidentally reduces a count leaves the next
  human PR red for a number it did not cause. The fix is always to commit the lower number.
  Regeneration in practice means reading the counts out of the CI log: `E2E_A11Y_UPDATE_BASELINE=1`
  still works but needs the E2E account's credentials, which exist only as repository secrets.
```

- [ ] **Step 3: Strike the two stale `ROADMAP.md` bullets**

Both promotions are already done — ruleset `18273908`'s required contexts are Format, Test, Build, Functions, Changelog, Agents, Config, RLS, E2E. Delete the "Promote the `RLS` CI job to a required check" bullet starting at `ROADMAP.md:49` and the "Promote `E2E` to a required check" bullet at `:73-74`, adjusting the surrounding "Three follow-ups" / "Three follow-ups remain" counts to match the number of bullets that survive.

- [ ] **Step 4: Rewrite the a11y follow-up bullet at `ROADMAP.md:81`**

Replace the bullet recording 202 violations with:

```
  - **A11y remediation has shipped.** The structural rules are cleared — `region`, `landmark-one-main`,
    `page-has-heading-one` and `select-name`, 177 of the 202 originally baselined. What remains is
    `color-contrast` 16 and `nested-interactive` 9, both deliberately deferred: contrast lives in
    `theme/themeConf.ts`, a verbatim port of the prototype, and nested-interactive needs `src/dnd`
    changes. See `docs/superpowers/specs/2026-07-30-a11y-landmarks-design.md`.
```

- [ ] **Step 5: Add the changelog entry**

Run `node scripts/next-version.mjs` to get the exact version this merge will mint (it was `1.2.45` when this plan was written; use whatever the script prints). Add a section under `## [Unreleased]` in `CHANGELOG.md`:

```markdown
## [1.2.45]

### Fixed

- **Accessibility: every page now has landmarks and a level-one heading.** The board exposes
  `banner` / `search` / `main` / `complementary`, the two filter selects and the search box have
  accessible names, and the login, settings and legal pages have a `main` landmark. This clears 177
  of the 202 violations the a11y baseline recorded.
- The settings page was never actually being scanned for accessibility — the check raced the page
  load and measured the loading spinner, which axe treats as an open modal and therefore exempts
  from the page-level rules.

### Changed

- The a11y baseline records per-surface, per-rule counts instead of CSS selector paths, so it is no
  longer invalidated by unrelated UI changes (810 lines to 42). Counts are asserted by strict
  equality: a count that falls means the baseline is stale and the lower number should be committed.
- `@axe-core/playwright` and `@playwright/test` are isolated in their own Dependabot group.
```

- [ ] **Step 6: Verify the changelog guard passes**

Run: `node scripts/check-changelog.mjs`
Expected: passes. If it reports a missing backfill for an already-released tag, add those sections too — that is the guard working as designed.

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md ROADMAP.md CHANGELOG.md
git commit -m "docs: record the a11y remediation and the counts-based ratchet

Replaces the page.clock rationale rather than deleting it — the pinning
is still load-bearing, for a different reason.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013hHaNZxiiDYHhzeoRbCUgp"
```

---

### Task 9: Open the PR and converge the baseline against CI

**Files:**

- Modify: `tests/e2e/a11y-baseline.json` (with the numbers CI reports)

**Interfaces:**

- Consumes: the baseline format from Task 2.
- Produces: a green `E2E` check.

> The counts committed in Task 2 are a prediction. `settings` is a guess (that surface has never been scanned), and the `region` figures depend on details only a real run settles. **One red `E2E` run is expected and is the regeneration mechanism.** All six tests still run after a failure — there is no `maxFailures` — and Task 2's unconditional log line fires before each assertion, so a single run yields every surface's true numbers.

- [ ] **Step 1: Run the full local gate one more time**

Run: `npm run format:check && npm run lint && npm run build && npm test && npm run codex:check`
Expected: all pass. `codex:check` is a required CI job and fails on any stale generated file.

- [ ] **Step 2: Push and open the PR**

Use the `ship` skill ("ship it"), or manually:

```bash
git push -u origin feat/a11y-landmarks
gh pr create --fill
```

- [ ] **Step 3: Wait for `E2E` and read the counts out of the log**

```bash
gh pr checks --watch
gh run view --log | grep '^\[a11y\]' -A 40
```

Each scanned surface prints one `[a11y] <label> {"rule":n,...}` line followed by its violation list. If a surface's assertion failed, its `Received` object in the diff is the same map.

- [ ] **Step 4: Commit the true counts**

Rewrite `tests/e2e/a11y-baseline.json` from those numbers, keeping the format: one `{ label, ruleId, count }` per pair, zero counts omitted, sorted by label then ruleId.

```bash
git add tests/e2e/a11y-baseline.json
git commit -m "test(e2e): record the measured a11y counts

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013hHaNZxiiDYHhzeoRbCUgp"
git push
```

If a count is **higher** than predicted for `color-contrast` or `nested-interactive`, do not just record it — that means a structural edit introduced a violation, and it needs diagnosing first. A `region`, `landmark-one-main`, `page-has-heading-one` or `select-name` count above zero on any surface means a landmark was missed; find it in the logged target list rather than baselining it.

- [ ] **Step 5: Look at the deployed preview**

Get the URL from the PR's `Cloudflare Pages` check, or derive it:

```bash
GITHUB_REPOSITORY=jwh3times/magic-agenda node scripts/preview-url.mjs $(git rev-parse HEAD)
```

Open it at desktop width and at a phone width, signed in, and check three things the test suite cannot:

1. The toolbar logo is unchanged in size and position, on both layouts, and the mobile toolbar row still fits the viewport without overflowing.
2. The login page logo is unchanged.
3. **The settings page cards still have even spacing between them** — this is the regression Task 5's `toHaveStyle` assertion guards, confirmed visually.

- [ ] **Step 6: Confirm all required checks are green**

Run: `gh pr checks`
Expected: Format, Test, Build, Functions, Changelog, Agents, Config, RLS, E2E all passing. Self-merge once green (0 approvals required) and resolve any review threads first.

---

## Self-Review

**Spec coverage.** Every section of the design spec maps to a task: the ratchet rekey and its fail-closed reading → Tasks 1-2; the three determinism fixes (animation freeze, third seeded card, settings heading wait) → Task 2; all eight structural edits → Tasks 3-6; Dependabot → Task 7; the AGENTS/ROADMAP/CHANGELOG realignment including the "replace, don't delete" instruction for the `page.clock` rationale → Task 8; the deliberately red run and the visual check → Task 9. The spec's "option not taken" (keying contrast entries on axe's `fgColor`/`bgColor` data) is intentionally not implemented — it is recorded in the spec as a decision, not a requirement.

**Type consistency.** `Finding` carries `label` as a field in both the module and the spec, never parsed out of `target`. `parseBaseline` / `tally` / `baselineFor` / `toBaseline` / `formatFindings` are named identically in Task 1's implementation, Task 1's tests and Task 2's spec rewrite. `BaselineEntry` is imported as a type in Task 2 because `readBaseline()`'s return type names it.

**Known gaps, stated rather than hidden.** Task 2 cannot be verified locally — no local credentials exist for the E2E account — so `tsc -b` and `eslint` are its only gates and CI is the real one. Task 6's `LegalLayout` change is covered by the unit tests added in that task and by nothing else: `/privacy` and `/terms` are not in `EXPECTED_LABELS`, so a green `E2E` says nothing about them.
