# A11y remediation: landmarks, page headings, and a durable ratchet — design

**Date:** 2026-07-30
**Status:** approved, ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-07-29-e2e-smoke-a11y-design.md`

Part 2A installed the a11y ratchet and deliberately baselined everything it found: "Installing the
ratchet is in scope; fixing what it finds is NOT." This spec spends that permission. It clears the
**structural** violations — the ones about document semantics rather than visual design — and
replaces the baseline's storage format with one that survives the DOM changes needed to do it.

## Scope

**In:** landmarks (`main` / `header` / `search` / `complementary`), a level-one heading on every
scanned page, accessible names on the two filter selects and the two unnamed landing sections, the
baseline rekey, one test-race fix, and a Dependabot change.

**Out, and staying baselined:**

- **16 `color-contrast`.** These live in `src/theme/themeConf.ts`, which `AGENTS.md` describes as a
  deliberate verbatim port of `design/Task Board.dc.html`. Fixing them is a contrast redesign of
  three themes — a different project, with a different reviewer and a different risk profile.
- **9 `nested-interactive`.** `src/dnd/SortableCard.tsx` spreads dnd-kit's `attributes` (including
  `role="button"`) onto the wrapper around `TaskCard`, which itself contains the pin and done
  `<button>`s. Resolving it means changing how dnd-kit's activator is attached — editing `src/dnd`,
  the one subsystem in this repo with a pure, unit-tested core whose correctness rules `AGENTS.md`
  spells out at length. Not on the way to landmarks.

Both rationales are recorded in the header comment of `tests/e2e/a11y.spec.ts`, because the baseline
file is JSON and takes no comments.

## Two findings that shaped this design

### 1. The `settings` surface has never actually been scanned

`tests/e2e/a11y.spec.ts:120-122` navigates and then waits only for fonts:

```ts
await page.goto('/settings')
await page.evaluate(() => document.fonts.ready)
assertNoNewViolations(await scan(page, 'settings'))
```

`SettingsPage` returns `<Spinner />` until `useSettingsContext()` resolves (`SettingsPage.tsx:44`),
so the scan races the settings load and — on the run that produced the committed baseline — lost.

The proof is in what that produced. `settings` has exactly **one** baseline entry,
`region :: settings:#root`, and **no** `landmark-one-main` and **no** `page-has-heading-one`. Neither
"the real page rendered" nor "the Spinner rendered" explains that on its own: the real
`SettingsShell` puts every node inside `header` / `section[aria-labelledby]` / `footer` landmarks, so
`region` would have nothing to flag, yet it has no `<main>` and so should fail `landmark-one-main`;
the Spinner has neither an `<h1>` nor a `<main>` and should fail both page-level rules.

axe-core resolves it. Both page-level checks carry `passForModal: true`:

```js
// axe-core 4.12.1 — rule landmark-one-main
all: [ { options: { selector: "main:not([role]), [role='main']", passForModal: true },
         id: 'page-has-main' } ]
```

and `isModalOpen()` treats any sufficiently large positioned overlay as a modal:

```js
// axe-core 4.12.1 — isModalOpen(), modalPercent defaults to .75
var modalElement = stacks[_i13].find(function(elm) {
  var style = window.getComputedStyle(elm);
  return parseInt(style.width, 10) >= percentWidth
      && parseInt(style.height, 10) >= percentHeight
      && style.getPropertyValue('pointer-events') !== 'none'
      && (style.position === 'absolute' || style.position === 'fixed');
});
```

`Spinner` renders `position: fixed; inset: 0` (`src/components/Spinner.tsx:4-12`) — 100% × 100% of
the viewport, default `pointer-events`. axe concludes a modal is open, `page-has-main` and
`page-has-heading-one` both pass for free, and `region` — which has no `passForModal` option —
flags `#root`. That is precisely the committed signature.

Two consequences carry into this work. The settings surface's real violations are unknown, which is
the one genuine unknown in the predicted baseline below. And the general lesson is worth stating
where the next person will read it: **a scan that races a loading state does not merely miss
content — a full-screen loader actively suppresses the page-level rules and scores clean.**

For contrast, `landing` legitimately has neither page-level entry: `Landing.tsx:105-106` already
renders a real `<main>` and `<h1>`.

### 2. The surviving baseline targets are positional, so any DOM change invalidates them

The ratchet keys on `` `${ruleId} ${target}` `` where `target` is axe's shortest-unique CSS path. Of
the 25 entries that survive this work, only two are attribute-keyed
(`landing:div > a[href$="login"]`, `login:button[type="submit"]`). The rest are positional and
depth-sensitive:

```
color-contrast      board-cork:.app-root > div:nth-child(1) > div:nth-child(1) > div:nth-child(2) > button:nth-child(2)
color-contrast      board-brutal:div:nth-child(41) > div:nth-child(1) > span
nested-interactive  board-glass:div:nth-child(16) > div:nth-child(2) > div[role="button"][aria-roledescription="sortable"][aria-describedby="DndDescribedBy-0"]
```

Those paths name tags as well as positions, so both inserting a wrapper and swapping a `<div>` for a
`<main>` rewrite them. Adding landmarks would register all 25 survivors as *new* pairs and fail the
now-required `E2E` check.

Regenerating in place is possible but costly: it needs `E2E_A11Y_UPDATE_BASELINE=1` run against a
real deployed preview, which needs `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` locally. Those exist only
as repository secrets — `.env.local` carries just the two `VITE_SUPABASE_*` vars. And it would be
owed again on the next UI change, forever: 810 lines of brittle selectors is a standing tax.

## Decision: rekey the baseline to per-surface, per-rule counts

### Format

`tests/e2e/a11y-baseline.json` becomes a sorted array of `{ label, ruleId, count }`, with zero-count
pairs omitted. Derived arithmetically from the current file — no scan required — the predicted
post-remediation content is **8 entries covering 25 violations, down from 202**:

```json
[
  { "label": "board-brutal", "ruleId": "color-contrast",     "count": 9 },
  { "label": "board-brutal", "ruleId": "nested-interactive", "count": 3 },
  { "label": "board-cork",   "ruleId": "color-contrast",     "count": 3 },
  { "label": "board-cork",   "ruleId": "nested-interactive", "count": 3 },
  { "label": "board-glass",  "ruleId": "color-contrast",     "count": 2 },
  { "label": "board-glass",  "ruleId": "nested-interactive", "count": 3 },
  { "label": "landing",      "ruleId": "color-contrast",     "count": 1 },
  { "label": "login",        "ruleId": "color-contrast",     "count": 1 }
]
```

`settings` predicts to zero entries. That is the one figure in this file that is a guess rather than
arithmetic, because §1 above established the surface has never been scanned.

### Semantics

Each test asserts **strict equality** between the counts observed on its own surface and the
baseline's counts for that label:

- observed **>** baseline → a regression;
- observed **<** baseline → the baseline is stale and must be tightened;
- a pair present in the scan but absent from the baseline → implicit baseline of 0, so a regression;
- a pair present in the baseline but absent from the scan → observed 0 against a positive baseline,
  so stale.

Strict equality is chosen over increases-only deliberately. Increases-only is what the current
target-keyed file does, and it lets the baseline rot: a violation that gets fixed incidentally never
gets recorded as fixed, so the ceiling drifts above reality and stops being a ratchet. Equality
costs a one-line edit with the exact number printed in the failure output, which matches the
`retries: 0` reasoning already in `playwright.config.ts` — a suite that is noisy is a defect to
diagnose, not to tolerate.

The failure must stay actionable. Counts alone do not say *which* node regressed, so the assertion
passes the formatted list of observed `n.target` values as `expect`'s message argument. The
information is not lost, only moved out of the committed file.

### What is given up

Within a single `(label, ruleId)` pair, swapping one violation for another of equal count goes
undetected — e.g. fixing one board contrast failure while introducing a different one. This is a
real reduction in precision and is accepted: the pairs that remain are two rule families both
declared out of scope above, and the alternative is a file that must be regenerated against a
deployed preview on every UI change.

### Preserved unchanged

`EXPECTED_LABELS` and the `afterAll` partial-write guard stay exactly as they are. Their reasoning —
that Playwright discards a worker after a failure, so module state can silently produce a baseline
covering only the surviving worker's surfaces — is unaffected by the storage format. The
`E2E_A11Y_UPDATE_BASELINE=1` regeneration path also stays; it simply writes counts.

### One deliberately red CI run

The counts committed with the code change are a prediction. The board and non-board figures are
arithmetic and should land exactly; `settings` is a guess, and the `region` totals depend on whether
dnd-kit's hidden `DndDescribedBy` / live-region nodes fall inside the new `<main>` — determinable
only by running. CI is the regeneration mechanism: the first `E2E` run reports any mismatch with the
true numbers, and those get committed. This needs no new workflow, no artifact, and no credentials
on the maintainer's machine.

## Structural edits

| File | Change |
| --- | --- |
| `src/components/Board.tsx:253` | the flex wrapper `<div>` → `<main>`. It holds the views and the Inbox; `DragOverlay` and `TaskEditor` stay outside it, which is correct — neither is page content. |
| `src/components/Toolbar.tsx:49` and `:135` | both the mobile and desktop branches: root `<div style={c.toolbar}>` → `<header>`; the `<img alt="Magic Agenda">` wrapped in `<h1>`. |
| `src/components/SearchFilterBar.tsx:33` | `<div>` → `<search>`; `aria-label` on both `<select>`s (`"Filter by category"`, `"Filter by status"`) and on the text input. |
| `src/components/Inbox.tsx:30` | root `<div>` → `<aside aria-label="Inbox">`. |
| `src/pages/Login.tsx:121-126` | `<div style={authCard}>` → `<main>`; the logo `<img>` wrapped in `<h1>`. |
| `src/pages/SettingsPage.tsx:94-104` | the `SECTIONS.map(...)` output wrapped in `<main>`, leaving `<header>` and `<footer>` as siblings. |
| `src/pages/Landing.tsx:155` and `:210` | `aria-label` on the two unnamed `<section>`s. |
| `src/components/LegalLayout.tsx` | `<main>` around the body content. |

### Notes on individual edits

**`<header>` gives `banner`, `<aside>` gives `complementary`, only where not nested.** A `<header>`
mapped to `banner` must not be inside `article` / `aside` / `main` / `nav` / `section`; intervening
plain `<div>`s do not disqualify it. `Board`'s `.app-root` is a `<div>`, so the toolbar qualifies.
On the settings page the `<header>` and `<footer>` must stay *siblings* of the new `<main>` for the
same reason — moving them inside would demote both to generic and re-open `region`.

**`<search>` is safe on both sides.** `@types/react` 19.2.17 declares `search` in
`JSX.IntrinsicElements`, so `tsc -b` accepts it, and axe-core 4.12.1 maps it as
`{ type: 'landmark', superclassRole: ['landmark'] }`. Browser support (Chrome 118+, Safari 17+,
Firefox 118+) is well past this project's floor.

**The `<h1>` wraps are the only visual risk in this spec.** In three of the four call sites the
`<img>` is a flex item, so its flex properties must move to the `<h1>` rather than be dropped:

- `Toolbar.tsx:137-141` (desktop): `<h1 style={{ margin: 0, lineHeight: 0, flex: 'none' }}>` with the
  img keeping `height: 80, display: 'block'`.
- `Toolbar.tsx:60-72` (mobile): `<h1 style={{ margin: 0, lineHeight: 0, flex: '0 1 auto', minWidth: 0 }}>`
  with the img keeping `height: 44, display: 'block', objectFit, objectPosition` and gaining
  `maxWidth: '100%'`. The comment at `Toolbar.tsx:66-67` records that the img is shrinkable *by
  design* so the row always fits the viewport; that behaviour must survive.
- `Login.tsx:122-126`: `<h1 style={{ margin: '0 0 6px', lineHeight: 0 }}>` taking over the img's
  margin, with the img keeping `height: 110, display: 'block'`.

`lineHeight: 0` suppresses the inline box the heading would otherwise add beneath the image. This
wants a look at the deployed preview on both desktop and mobile widths, not just a green check.

**`LegalLayout` is not covered by the ratchet.** `/privacy` and `/terms` are not in
`EXPECTED_LABELS`, so this one line ships unverified by the a11y suite. It is included because it is
the same defect as the others and omitting it would leave two pages inconsistent with the rest of
the app; it is called out here so nobody later mistakes a green `E2E` run for evidence about those
pages.

**No CSS helper is added.** There is no visually-hidden / sr-only class in `src/index.css`, and this
design needs none: every accessible name it adds comes from an `aria-label` or from an existing
`alt`. Adding one would be the first CSS-side styling in a codebase whose theming is deliberately
inline style objects.

## Test-race fix

```ts
await page.goto('/settings')
await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
await page.evaluate(() => document.fonts.ready)
```

This makes the settings scan deterministic and is what surfaces that page's real violations for the
first time. The board scans already wait for `+ New task` and both `SEEDED_TITLES`; `landing` and
`login` render synchronously. A comment on the new wait records *why* it is load-bearing — the
`isModalOpen` mechanism from §1 — so it is not simplified away later as a redundant wait.

## Dependabot

`@axe-core/playwright` and `@playwright/test` currently fall into the `npm-minor-and-patch` catch-all
group in `.github/dependabot.yml`, which opens daily. They move into their own group covering all
update types.

The reason is sharper than ordinary churn: **the `E2E` job cannot run on a Dependabot PR at all.**
GitHub withholds regular repository secrets from the `dependabot` actor, so `HAS_SECRETS`
(`.github/workflows/ci.yml:261`) is empty and the job reports success from inside a step without
scanning anything. An axe bump that changes rule behaviour therefore merges green and breaks the
*next human PR* — the same shape as the Changelog-backfill trap already documented in `AGENTS.md`.
Isolating these two makes such a change attributable to one obvious PR instead of a batch of twenty.

The counts rekey defuses most of this on its own — selector-path churn between axe versions no
longer matters, only rule-count changes do — which is why an outright `ignore` is not warranted.

## Expected outcome

177 of the 202 baselined violations cleared: `region` 163, `landmark-one-main` 4,
`page-has-heading-one` 4, `select-name` 6. The 25 that remain are the two out-of-scope rule families,
recorded with the rationale above. The baseline file goes from 810 lines to about 40 (8 entries at
the writer's existing `JSON.stringify(x, null, 2)` indentation), and stops being invalidated by
unrelated UI work.

## Documentation to realign in the same PR

- `AGENTS.md` — the E2E testing-layers section describes the ratchet's key and regeneration command;
  both change. The `isModalOpen` trap belongs alongside the three existing "non-obvious constraints
  on the specs themselves", each of which is there because it cost a debugging pass.
- `ROADMAP.md` — the a11y follow-up bullet recording 202 violations, and the two bullets asking for
  `RLS` and `E2E` to be promoted to required checks, which are already done (verified against
  ruleset 18273908) and are now stale.
- `CHANGELOG.md` — a `## [x.y.z]` section for the version this merge will mint, per
  `scripts/next-version.mjs`.

## Verification

- `npm run format:check`, `npm run lint`, `npm run build` (`tsc -b` covers the `<search>` typing and
  the worker project).
- `npm test` — `Board.test.tsx` renders `Board` through a stateful harness and includes a mobile
  block that stubs `matchMedia`; the `<header>` / `<main>` / `<aside>` swaps and the `<h1>` wrap may
  break queries there.
- `npm run test:e2e` via CI against the PR's preview — the authoritative check, expected to be red
  once with the true counts.
- A visual look at the preview on desktop and mobile widths, specifically the toolbar and login
  logo, per the `<h1>` note above.
