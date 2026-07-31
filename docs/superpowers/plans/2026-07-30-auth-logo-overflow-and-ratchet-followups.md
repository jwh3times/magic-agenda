# Auth Logo Overflow + Ratchet Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the auth-card logo overflowing its container at every viewport width, and close two follow-ups left by the a11y-ratchet work — log the colours behind `color-contrast` findings, and check that `EXPECTED_LABELS` matches the spec's actual scan call sites.

**Architecture:** The overflow fix is two lines of shared style plus six call sites adopting them — one new `authLogo` export makes the logo fluid, and an explicit `grid-template-columns` on `authPage` stops the card sizing itself to the logo. The two ratchet follow-ups both land as pure functions in `scripts/a11y-baseline.ts`, unit-tested by `npm test`, because the Playwright spec that consumes them cannot run without a deployed preview and credentials.

**Tech Stack:** React 19 + TypeScript, Vitest (jsdom), Playwright 1.62 + `@axe-core/playwright` 4.12.1, axe-core 4.12.1.

**Spec:** `docs/superpowers/specs/2026-07-30-auth-logo-overflow-and-ratchet-followups-design.md` — read it before starting. It records the measurements behind the overflow diagnosis and why each choice was made.

## Global Constraints

- **Theming is inline style objects, never CSS.** `AGENTS.md` forbids refactoring it to CSS or CSS variables. `authChrome.ts` is the existing home for shared auth-page style objects; add to it rather than introducing a stylesheet or class names.
- **Do not change `tests/e2e/a11y-baseline.json`, or the count-equality semantics of the ratchet.** This plan adds output and a coverage check; it moves no baseline numbers and no assertion logic.
- **Do not touch `src/dnd/` or `src/theme/themeConf.ts`.** The 16 `color-contrast` and 9 `nested-interactive` violations stay baselined and out of scope.
- **`design/Task Board.dc.html` is reference-only and must never be edited.**
- **`npm test` is hermetic by contract** — never Docker, a database, or a network. `tests/**` stays excluded from it (`vite.config.ts`); pure logic belongs in `scripts/`, which it does collect.
- **The Playwright E2E suite cannot be run on this machine.** It needs `E2E_BASE_URL` pointed at a deployed Cloudflare Pages preview plus `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD`, which exist only as GitHub repository secrets. Do not attempt it and do not install anything.
- **`main` is PR-only.** Work on `fix/auth-logo-overflow`, which already exists and carries the spec commit.
- Every commit message ends with these two lines exactly:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013hHaNZxiiDYHhzeoRbCUgp
  ```

## File Structure

| File | Responsibility |
| --- | --- |
| `src/pages/authChrome.ts` | Gains `gridTemplateColumns` on `authPage` and a new `authLogo` export. Already the shared home for auth-page style objects. |
| `src/pages/Login.tsx`, `ResetPassword.tsx`, `AuthConfirm.tsx` | Six `<img>` call sites adopt `authLogo`. |
| `src/pages/Login.test.tsx`, `ResetPassword.test.tsx`, `AuthConfirm.test.tsx` | One assertion each that the logo carries the fluid style. |
| `tests/e2e/smoke.spec.ts` | **New describe block:** no horizontal overflow at 390px across the six public routes. Belongs here, not in `a11y.spec.ts` — it is a layout assertion, not an axe scan. |
| `scripts/a11y-baseline.ts` | Gains `Finding.detail`, `ContrastData`, `formatContrast()`, `parseScanCallSites()`; `formatFindings()` learns to print a detail line. All pure. |
| `scripts/a11y-baseline.test.ts` | Unit tests for the three new/changed functions. |
| `tests/e2e/a11y.spec.ts` | `scan()` populates `detail` for `color-contrast` findings. No other change. |
| `CHANGELOG.md` | A section for the version this merge mints. |

---

### Task 1: Make the auth logo fluid

**Files:**
- Modify: `src/pages/authChrome.ts:4-13` (`authPage`) and a new export after it
- Modify: `src/pages/Login.tsx:7,123`
- Modify: `src/pages/ResetPassword.tsx:7,53,74,117`
- Modify: `src/pages/AuthConfirm.tsx:7,55,73`
- Test: `src/pages/Login.test.tsx`, `src/pages/ResetPassword.test.tsx`, `src/pages/AuthConfirm.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `export const authLogo: CSSProperties` in `src/pages/authChrome.ts`.

> **Why the fixed height has to go.** The logo source is 900×260. With `height: 110` and no `max-width`, its used width is 381px and cannot shrink — 37px wider than the card's 344px content box at *every* viewport width. Keeping the fixed height and merely clamping the width would squash the image, because `object-fit` defaults to `fill`.

- [ ] **Step 1: Write the failing tests**

Append to `src/pages/Login.test.tsx`:

```tsx
test('the logo is fluid so it cannot overflow the card', () => {
  renderLogin()
  const logo = screen.getByAltText('Magic Agenda')
  // Asserted on the inline style, not getComputedStyle: jsdom has no layout engine, so this is a
  // shape test. It catches a call site missed during the edit, which is the realistic regression —
  // the actual overflow is measured by the 390px check in tests/e2e/smoke.spec.ts.
  expect(logo.style.maxWidth).toBe('100%')
  expect(logo.style.height).toBe('auto')
})
```

Append to `src/pages/ResetPassword.test.tsx` (its helper is `renderPage()`):

```tsx
test('the logo is fluid so it cannot overflow the card', () => {
  // Default beforeEach state (a live recovery session, no token) renders the form directly.
  renderPage()
  const logo = screen.getByAltText('Magic Agenda')
  expect(logo.style.maxWidth).toBe('100%')
  expect(logo.style.height).toBe('auto')
})
```

Append to `src/pages/AuthConfirm.test.tsx` (it renders via `render(pageTree())`):

```tsx
test('the logo is fluid so it cannot overflow the card', () => {
  // Default beforeEach state (no session, no token) renders the invalid-link card directly.
  render(pageTree())
  const logo = screen.getByAltText('Magic Agenda')
  expect(logo.style.maxWidth).toBe('100%')
  expect(logo.style.height).toBe('auto')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/pages/Login.test.tsx src/pages/ResetPassword.test.tsx src/pages/AuthConfirm.test.tsx`
Expected: FAIL — three failures, each `expected '' to be '100%'` (the img carries `height: 110px` and no `max-width`).

- [ ] **Step 3: Add the shared style and cap the grid column**

In `src/pages/authChrome.ts`, add `gridTemplateColumns` to `authPage` and append the new export directly after it:

```ts
export const authPage: CSSProperties = {
  minHeight: '100%',
  display: 'grid',
  // Without an explicit column the implicit one is `auto`, which sizes to the item's max-content —
  // and that is driven by the logo. authCard's `width: min(400px, 100%)` then resolves its 100%
  // against that inflated column instead of the viewport, which is how a 390px phone ended up with
  // a 400px card and 59px of horizontal page overflow. minmax(0, 1fr) caps the column at the
  // container, so the percentage means what it looks like it means.
  gridTemplateColumns: 'minmax(0, 1fr)',
  placeItems: 'center',
  padding: 20,
  background:
    'radial-gradient(1200px 600px at 70% -10%, rgba(124,92,255,.25), transparent 60%), #0b0f1f',
  fontFamily: 'system-ui, sans-serif',
  color: '#eaf0ff',
}

/**
 * The wordmark on every auth card.
 *
 * `height: auto` is load-bearing, not a default. The source is 900×260, so a fixed `height: 110`
 * gives a used width of 381px with no way to shrink — 37px past the card's 344px content box at
 * every viewport width, and 59px past the viewport itself below ~450px. Clamping the width while
 * keeping the fixed height would squash the image instead, because `object-fit` defaults to `fill`.
 */
export const authLogo: CSSProperties = {
  maxWidth: '100%',
  height: 'auto',
  display: 'block',
}
```

- [ ] **Step 4: Adopt it at all six call sites**

Each of the six is currently byte-identical:

```tsx
<img src={logoDark} alt="Magic Agenda" style={{ height: 110, display: 'block' }} />
```

Replace each with:

```tsx
<img src={logoDark} alt="Magic Agenda" style={authLogo} />
```

at `src/pages/Login.tsx:123`, `src/pages/ResetPassword.tsx:53,74,117`, and `src/pages/AuthConfirm.tsx:55,73`. Add `authLogo` to each file's existing named import from `'./authChrome'` (line 7 in all three). Leave the surrounding `<h1 style={{ margin: '0 0 6px' }}>` untouched.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/pages/Login.test.tsx src/pages/ResetPassword.test.tsx src/pages/AuthConfirm.test.tsx`
Expected: PASS, including every pre-existing test in the three files.

- [ ] **Step 6: Run the full gate**

Run: `npm run format && npm run lint && npm run build && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/pages/authChrome.ts src/pages/Login.tsx src/pages/ResetPassword.tsx src/pages/AuthConfirm.tsx src/pages/Login.test.tsx src/pages/ResetPassword.test.tsx src/pages/AuthConfirm.test.tsx
git commit -m "fix: stop the auth logo overflowing its card at every width

The 900x260 wordmark pinned to height:110 is 381px wide and cannot
shrink, 37px past the card's content box. authPage's implicit grid
column is auto-sized, so it expanded to the logo and authCard's
min(400px,100%) resolved against that instead of the viewport --
pushing /login, /auth/reset and /auth/confirm 59px past a 390px screen.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013hHaNZxiiDYHhzeoRbCUgp"
```

---

### Task 2: Guard horizontal overflow at phone width

**Files:**
- Modify: `tests/e2e/smoke.spec.ts` (append a new `test.describe` at the end)

**Interfaces:**
- Consumes: the fluid logo from Task 1. Without it, three of these six routes fail.
- Produces: nothing consumed by later tasks.

> This is the test that would actually have caught the bug. Nothing else in the suite measures layout — the axe scan does not, because axe has no rule for "wider than the viewport". It goes in `smoke.spec.ts` rather than `a11y.spec.ts` deliberately: it is a layout assertion, and putting it in the a11y spec would entangle it with `EXPECTED_LABELS` and the baseline machinery for no reason.

- [ ] **Step 1: Add the test**

Append to `tests/e2e/smoke.spec.ts`:

```ts
/**
 * No horizontal overflow on a phone, on every route a signed-out visitor can reach.
 *
 * The bug this guards was live in production and invisible to every other layer: a 900×260 logo
 * pinned to `height: 110` is 381px wide and cannot shrink, so /login, /auth/reset and /auth/confirm
 * each pushed the document 59px past a 390px viewport. The a11y scan cannot see it — axe has no
 * rule for "wider than the viewport" — and jsdom cannot, having no layout engine.
 *
 * The h1 wait is not decoration. Several of these routes render a full-screen `<Spinner/>` while
 * loading, and a fixed-position overlay does NOT overflow horizontally — so scanning too early
 * would pass vacuously against a loading screen. Every one of the six routes has exactly one
 * level-one heading once it has rendered.
 */
test.describe('phone-width layout', () => {
  test.use({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 390, height: 844 },
  })

  const PUBLIC_ROUTES = ['/', '/login', '/privacy', '/terms', '/auth/reset', '/auth/confirm']

  for (const route of PUBLIC_ROUTES) {
    test(`${route} does not overflow horizontally at 390px`, async ({ page }) => {
      await page.goto(route)
      await page.getByRole('heading', { level: 1 }).first().waitFor()
      await page.evaluate(async () => {
        await document.fonts.ready
      })
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(
        scrollWidth,
        `${route} is ${scrollWidth - clientWidth}px wider than the 390px viewport. Something in ` +
          'the page cannot shrink — check for a fixed-width or intrinsically-sized element.',
      ).toBeLessThanOrEqual(clientWidth)
    })
  }
})
```

- [ ] **Step 2: Verify it typechecks and lints**

Run: `npm run format && npm run lint && npm run build`
Expected: all pass. There is no way to execute this suite locally — see Global Constraints — so these are the only gates until CI runs it against the PR's preview.

- [ ] **Step 3: Sanity-check the route list against the router**

Open `src/App.tsx` and confirm all six paths in `PUBLIC_ROUTES` are real routes reachable without a session. A typo'd path would render the app's not-found or redirect behaviour, and the test would likely still pass — a vacuous green. Record what you checked in your report.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/smoke.spec.ts
git commit -m "test(e2e): assert no horizontal overflow at 390px on public routes

Nothing else in the suite measures layout: axe has no rule for 'wider
than the viewport' and jsdom has no layout engine. Three of these six
routes were 59px over before the previous commit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013hHaNZxiiDYHhzeoRbCUgp"
```

---

### Task 3: Log the colours behind `color-contrast` findings

**Files:**
- Modify: `scripts/a11y-baseline.ts` (the `Finding` interface, `formatFindings()`, plus two new exports)
- Modify: `scripts/a11y-baseline.test.ts`
- Modify: `tests/e2e/a11y.spec.ts` (the `scan()` function only)

**Interfaces:**
- Consumes: the existing `Finding`, `formatFindings()`.
- Produces:
  - `Finding` gains an optional `detail?: string`
  - `export interface ContrastData { fgColor?: string; bgColor?: string; contrastRatio?: number; expectedContrastRatio?: string }`
  - `export function formatContrast(data: ContrastData | undefined): string | undefined`

> **The baseline format does not change.** `detail` is deliberately not part of the count key, so `tally()`, `baselineFor()`, `toBaseline()` and `a11y-baseline.json` are all untouched. It reaches only the log line and the assertion message.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/a11y-baseline.test.ts` (add `formatContrast` to the existing import from `'./a11y-baseline'`):

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/a11y-baseline.test.ts`
Expected: FAIL — `formatContrast` is not exported, and the detail-line test fails on the one-line output.

- [ ] **Step 3: Implement in the module**

In `scripts/a11y-baseline.ts`, add `detail` to `Finding`:

```ts
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
```

Add the new type and formatter (place them next to `formatFindings`):

```ts
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
```

Replace `formatFindings`'s `.map(...)` with a `.flatMap(...)` so a finding can emit two lines:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/a11y-baseline.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Populate `detail` in the spec**

In `tests/e2e/a11y.spec.ts`, add `formatContrast` and `type ContrastData` to the existing import from `'../../scripts/a11y-baseline'`, then change the `found` construction inside `scan()`:

```ts
  const found = results.violations.flatMap((violation) =>
    violation.nodes.map((node) => ({
      label,
      ruleId: violation.id,
      target: node.target.join(' '),
      // Only color-contrast carries colour data, and it is the only family where knowing WHICH
      // colours failed saves work later — see this file's header note on the deferred redesign.
      detail:
        violation.id === 'color-contrast'
          ? formatContrast(
              node.any.find((check) => check.id === 'color-contrast')?.data as
                | ContrastData
                | undefined,
            )
          : undefined,
    })),
  )
```

Change nothing else in that function — the `scanned.add(label)` call, the `console.log`, and the return all stay exactly as they are.

- [ ] **Step 6: Run the full gate**

Run: `npm run format && npm run lint && npm run build && npm test`
Expected: all pass. `tsc -b` is what confirms the `node.any` / `CheckResult.data` cast typechecks against the installed axe-core types.

- [ ] **Step 7: Commit**

```bash
git add scripts/a11y-baseline.ts scripts/a11y-baseline.test.ts tests/e2e/a11y.spec.ts
git commit -m "test(e2e): log the colours behind color-contrast findings

The count-keyed baseline cannot tell one contrast failure from another
at equal count. Rather than rekey it -- which would put two key schemes
in one file for rules that are out of scope -- put the colours axe
already returns into the CI log.

Baseline format unchanged: detail is not part of the count key.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013hHaNZxiiDYHhzeoRbCUgp"
```

---

### Task 4: Check `EXPECTED_LABELS` against the real call sites

**Files:**
- Modify: `scripts/a11y-baseline.ts` (one new export)
- Modify: `scripts/a11y-baseline.test.ts`

**Interfaces:**
- Consumes: `EXPECTED_LABELS`.
- Produces: `export function parseScanCallSites(specSource: string): string[]`

> **The gap.** `parseBaseline()` rejects a baseline entry whose label is not in `EXPECTED_LABELS`. Nothing checks the other direction — a label in `EXPECTED_LABELS` with no test scans nothing, asserts nothing, and emits no signal. The `afterAll` guard only runs in update mode, and it cannot be moved: Playwright discards a worker after a failure, so a coverage check there would re-fire spuriously in every restarted worker.
>
> Verified against the current spec before writing this task: there are exactly four `scanAndAssert` call sites (three string literals, one `` `board-${theme}` `` template) and the three theme literals each appear exactly once, on the loop line.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/a11y-baseline.test.ts` (add `parseScanCallSites` to the existing import):

```ts
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
```

`readFileSync`, `path` and `EXPECTED_LABELS` are already imported by this file for the committed-baseline test.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/a11y-baseline.test.ts`
Expected: FAIL — `parseScanCallSites is not a function` / not exported.

- [ ] **Step 3: Implement it**

Append to `scripts/a11y-baseline.ts`:

```ts
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
```

`fail()` is the existing module-private helper that throws; it returns `never`, so TypeScript narrows correctly after each call.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/a11y-baseline.test.ts`
Expected: PASS, including every pre-existing test.

- [ ] **Step 5: Prove the check actually bites**

Temporarily add a seventh entry to `EXPECTED_LABELS` in `scripts/a11y-baseline.ts` (e.g. `'board-neon'`), run `npx vitest run scripts/a11y-baseline.test.ts`, and confirm the "matches the committed spec exactly" test FAILS. Then remove it and confirm the suite is green again. Record both outputs in your report — a coverage check nobody has seen fail is not yet known to work.

- [ ] **Step 6: Run the full gate**

Run: `npm run format && npm run lint && npm run build && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/a11y-baseline.ts scripts/a11y-baseline.test.ts
git commit -m "test(e2e): assert EXPECTED_LABELS matches the real scan call sites

parseBaseline already rejects a baseline entry under an unknown label.
This is the other direction: a label with no test asserts nothing and
says nothing. Throws when it matches no call sites, so a rename cannot
turn the check into a vacuous pass.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013hHaNZxiiDYHhzeoRbCUgp"
```

---

### Task 5: Changelog

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Get the target version**

Run: `node scripts/next-version.mjs`
It printed `1.2.46` when this plan was written. Use whatever it prints now — another merge may have landed since.

- [ ] **Step 2: Add the section**

Insert under the existing `## [Unreleased]` heading in `CHANGELOG.md`, matching the format of the sections below it (including the ` - YYYY-MM-DD` date, which every other section carries — today is **2026-07-30**):

```markdown
## [1.2.46] - 2026-07-30

### Fixed

- **The sign-in, password-reset and confirm-email pages no longer overflow sideways on a phone.**
  The wordmark was pinned to a fixed height with no way to shrink, so it was wider than its own card
  at every screen size and pushed the page 59px past a 390px viewport. The logo is now fluid; it
  renders about 10% smaller on a desktop, where it had been overflowing its card.

### Changed

- `color-contrast` findings now log the colours behind them (`#8a8a8a on #f4e4c1 — 2.9:1`), so a
  failure says which colours to fix rather than only where. The a11y baseline format is unchanged.
- The a11y suite now checks that every surface it claims to scan has a real test, and asserts that
  no public route overflows horizontally at phone width.
```

Also add the `[1.2.46]` compare link in the reference-link block at the bottom of the file, following the form of its neighbours, and repoint `[Unreleased]` at `compare/v1.2.46...HEAD`.

- [ ] **Step 3: Verify the required guard passes**

Run: `node scripts/check-changelog.mjs`
Expected: passes, reporting that the changelog names the version this merge will mint. If it reports a missing section for an already-released tag, backfill it — that is the guard working as designed.

- [ ] **Step 4: Run the remaining required checks**

Run: `npm run format:check && npm run lint && npm run codex:check`
Expected: all pass. (`codex:check` verifies the generated Codex agent config is in sync and is a required CI job.)

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for the auth logo overflow fix and ratchet follow-ups

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013hHaNZxiiDYHhzeoRbCUgp"
```

---

### Task 6: Open the PR and verify against the preview

**Files:** none.

**Interfaces:**
- Consumes: everything above.
- Produces: a green PR.

- [ ] **Step 1: Run the whole local gate**

Run: `npm run format:check && npm run lint && npm run build && npm test && npm run codex:check && node scripts/check-changelog.mjs`
Expected: all pass.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin fix/auth-logo-overflow
gh pr create --fill
```

- [ ] **Step 3: Wait for CI**

```bash
gh pr checks --watch
```
All of Format, Test, Build, Functions, Changelog, Agents, Config, RLS and E2E must pass. **Unlike the previous branch, no check is expected to be red here** — this plan moves no baseline numbers. An `E2E` failure means something real: most likely a public route that overflows for a reason Task 1 did not address, in which case the failure message names the route and the pixel delta.

- [ ] **Step 4: Confirm the a11y counts did not move**

```bash
gh run view --log | grep '^\[a11y\]'
```
Expected, unchanged from the previous branch — the colour detail is additive and no count should differ:
```
[a11y] landing {"color-contrast":1}
[a11y] login {"color-contrast":1}
[a11y] settings {}
[a11y] board-cork {"color-contrast":3,"nested-interactive":3}
[a11y] board-brutal {"color-contrast":9,"nested-interactive":3}
[a11y] board-glass {"color-contrast":2,"nested-interactive":3}
```
The `color-contrast` lines should now be followed by indented `#fg on #bg — R:1 (needs E:1)` lines. If a **count** changed, stop and diagnose — this plan should not have moved one. A changed count on `login` specifically would mean the logo resize altered a contrast result.

- [ ] **Step 5: Look at the preview**

Get the URL from the PR's `Cloudflare Pages` check, or:
```bash
GITHUB_REPOSITORY=jwh3times/magic-agenda node scripts/preview-url.mjs $(git rev-parse HEAD)
```
Open `/login` at desktop and phone widths. Confirm the logo sits inside the card with even padding on both sides, and that the page does not scroll sideways on the phone width. **The desktop logo is intentionally about 10% smaller than production** — confirm it still looks right rather than assuming the smaller size is a bug.

---

## Self-Review

**Spec coverage.** §1 (auth logo) → Tasks 1 and 2; §2 (colour logging) → Task 3; §3 (coverage check) → Task 4; §4 testing → the test steps inside Tasks 1–4 plus Task 6 Step 5's manual check; §5 out-of-scope items are named in Global Constraints; §6 documentation → Task 5. The spec's explicit "`AGENTS.md` needs no change" is honoured — no task touches it.

**Type consistency.** `Finding.detail`, `ContrastData`, `formatContrast()` and `parseScanCallSites()` are named identically in Task 3's and Task 4's implementations, their tests, and the consuming change in `a11y.spec.ts`. `formatContrast` returns `string | undefined`, which is exactly what `Finding.detail` accepts.

**Known gaps, stated rather than hidden.** Task 2 cannot be executed locally, so `tsc -b` and `eslint` are its only gates until CI; Task 2 Step 3's manual route check exists because a typo'd path would produce a vacuous pass. The unit tests in Task 1 assert style shape, not layout — jsdom has no layout engine, so the actual overflow is only measured by Task 2 in CI.
