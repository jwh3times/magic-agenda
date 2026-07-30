# A11y remediation: landmarks, page headings, and a durable ratchet — design

**Date:** 2026-07-30
**Status:** approved in outline; revised 2026-07-30 after three independent reviews
**Parent spec:** `docs/superpowers/specs/2026-07-29-e2e-smoke-a11y-design.md`

Part 2A installed the a11y ratchet and deliberately baselined everything it found: "Installing the
ratchet is in scope; fixing what it finds is NOT." This spec spends that permission. It clears the
**structural** violations — the ones about document semantics rather than visual design — and
replaces the baseline's storage format with one that survives the DOM changes needed to do it.

> **Revision note.** The first draft was reviewed by three independent agents: a fact-check against
> the repository, an adversarial design critique, and a review of the ratchet mechanism. Findings
> are folded in below. The material changes are: strict equality collides with a CSS animation the
> app ships (§"Determinism"), `readBaseline()` becomes fail-open under equality and must be fixed
> (§"Fail-closed reading"), the settings `<main>` wrap needs explicit flex styling or it destroys
> the card spacing (§"Structural edits"), and the claim that `region` reaching zero was an
> unverifiable forecast was wrong — it is settled by construction (§"Why region reaches zero").

## Scope

**In:** landmarks (`main` / `header` / `search` / `complementary`), a level-one heading on every
scanned page, accessible names on the two filter selects and the two unnamed landing sections, the
baseline rekey, the determinism fixes the rekey requires, and a Dependabot change.

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
`region :: settings:#root`, and **no** `landmark-one-main` and **no** `page-has-heading-one`. The
real `SettingsShell` puts every node inside `header` / `section[aria-labelledby]` / `footer`
landmarks, so `region` would have nothing to flag, yet it has no `<main>` and so should fail
`landmark-one-main`. The Spinner has no `<main>` either and should fail the same rule.
`page-has-heading-one` does not discriminate — the real page has `<h1>Settings</h1>`
(`SettingsPage.tsx:89`), so it passes legitimately there — but **`landmark-one-main`'s absence has
no innocent explanation under either hypothesis.**

axe-core resolves it. Both page-level checks carry `passForModal: true`:

```js
// axe-core 4.12.1 — rule landmark-one-main, axe.js:32662-32674
all: [ { options: { selector: "main:not([role]), [role='main']", passForModal: true },
         id: 'page-has-main' } ]
```

`page-has-heading-one` (`axe.js:32882-32892`) carries it too, and both route through
`has-descendant-evaluate`, which short-circuits (`axe.js:26565-26567`):

```js
if (options.passForModal && is_modal_open_default()) { return true; }
```

`isModalOpen()` (`axe.js:17660`, `modalPercent` defaults to `.75`) treats any sufficiently large
positioned overlay as a modal:

```js
// axe.js:17696-17699
var modalElement = stacks[_i13].find(function(elm) {
  var style = window.getComputedStyle(elm);
  return parseInt(style.width, 10) >= percentWidth
      && parseInt(style.height, 10) >= percentHeight
      && style.getPropertyValue('pointer-events') !== 'none'
      && (style.position === 'absolute' || style.position === 'fixed');
});
```

`Spinner` renders `position: fixed; inset: 0` (`src/components/Spinner.tsx:5-6`) — 100% × 100% of
the viewport, `pointer-events` unset and therefore not `none`. axe concludes a modal is open,
`page-has-main` passes for free, and `region` — which has no `passForModal` option
(`axe.js:32906-32917`) — flags `#root`. That is precisely the committed signature.

The general lesson belongs where the next person will read it: **a scan that races a loading state
does not merely miss content — a full-screen loader actively suppresses the page-level rules and
scores clean.**

For contrast, `landing` legitimately has neither page-level entry: `Landing.tsx:105-106` already
renders a real `<main>` and `<h1>`.

### 2. The surviving baseline targets are positional, so any DOM change invalidates them

The ratchet keys on `` `${ruleId} ${target}` `` where `target` is axe's shortest-unique CSS path. Of
the 25 entries that survive this work, **four** are attribute-keyed and structure-proof
(`landing:div > a[href$="login"]`, `login:button[type="submit"]`, and the two Inbox foot links
`board-brutal:a[href$="privacy"]` / `board-brutal:a[href$="terms"]`). The other **21** are positional
and depth-sensitive:

```
color-contrast      board-cork:.app-root > div:nth-child(1) > div:nth-child(1) > div:nth-child(2) > button:nth-child(2)
color-contrast      board-brutal:div:nth-child(41) > div:nth-child(1) > span
nested-interactive  board-glass:div:nth-child(16) > div:nth-child(2) > div[role="button"][aria-roledescription="sortable"][aria-describedby="DndDescribedBy-0"]
```

Those paths name tags as well as positions, so both inserting a wrapper and swapping a `<div>` for a
`<main>` rewrite them. Adding landmarks would register 21 of 25 survivors as *new* pairs and fail the
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

`settings` predicts to zero entries. Two reviewers disagreed about how likely that is, and the
disagreement is worth recording because it tells the implementer how to read the first run:

- *Expect nonzero.* Every other themed surface yields contrast findings and `SettingsShell` renders
  through the same `conf` tokens (`SettingsPage.tsx:89, :96`).
- *Expect near-zero.* `SettingsShell`'s outer div carries `backgroundImage: conf.pageImg`, which for
  cork is three radial gradients. axe's `getBackgroundColor` sets `bgColor: 'bgGradient'` and returns
  null the moment a `background-image` is in the element stack (`axe.js:17784-17788`), which makes
  the node **incomplete** rather than a violation — incompletes are not in `results.violations`. This
  is the same reason the cork board's 3 contrast violations all sit in the opaque toolbar.

The second argument is the more mechanical one and is what the prediction follows. Either way this
is the one figure that is a guess rather than arithmetic, because §1 established the surface has
never been scanned.

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
costs a one-line edit with the exact number printed in the failure output.

Equality is only safe if the scan is deterministic, which today it is not. See §"Determinism".

### Fail-closed reading and well-formedness

`readBaseline()` (`a11y.spec.ts:25-31`) currently swallows *every* error — ENOENT, `SyntaxError`, a
file full of merge-conflict markers — and returns `[]`. Under increases-only that is the **strictest
possible** state: every finding is new, so a corrupt file can never go green. That property is what
made the swallow survivable.

Under strict equality with implicit-zero, `[]` means "expect zero violations everywhere" — a
**legitimate passing state**. Today 5 of 6 surfaces have violations so corruption is loud. But a
ratchet exists to trend to zero, and this spec defers both remaining families rather than
abandoning them. The moment the last 25 are fixed the correct baseline *is* `[]`, and a deleted,
truncated or unparseable file becomes indistinguishable from success. **The check would disarm
itself exactly on reaching its own goal.**

The reader therefore must:

1. Rethrow anything that is not ENOENT.
2. Validate the parsed shape: an array of `{ label: string, ruleId: string, count: number }` with
   `count` a positive integer. A `count: 0` entry is rejected rather than tolerated — the format
   omits zeroes, and a maintainer who records a fix as `"count": 0` instead of deleting the line
   would otherwise get a permanent red whose fix is not obvious from the diff.
3. Reject duplicate `(label, ruleId)` keys. Harmless under the old `Set`-keyed scheme; under counts
   a sloppy merge silently discards one value.
4. Reject any `label` not in `EXPECTED_LABELS`.

Rule 4 closes a hole equality would otherwise open. The `afterAll` guard is `if (!UPDATING) return`
(`a11y.spec.ts:51`), so on an asserting run it does nothing — `EXPECTED_LABELS` and `scanned` are
consulted only during regeneration. That was fine for increases-only, which never claimed anything
about a surface that did not run. Equality claims "the baseline cannot rot", and that claim is
**false for any entry whose label no test scans**: an orphaned or mistyped label (`board-corK`, a
label stranded by a renamed surface) is asserted by nobody, can never be tightened, and emits no
signal in either direction. Validating the label set at read time needs no runtime state and costs
one `filter`.

The converse — an `EXPECTED_LABELS` entry whose test was filtered out with `-g` — genuinely cannot
be checked at assert time without breaking legitimate filtered runs, and cannot move into `afterAll`
because Playwright discards a worker after a failure and the check would re-fire spuriously in every
restarted worker. That is why the existing guard is UPDATING-only, and it stays that way. The
documentation must therefore **not** claim staleness detection is total.

### Implementation constraints

- **`label` becomes its own field on `Finding`.** Today it survives only as the prefix before the
  first `:` in `` `${label}:${n.target.join(' ')}` `` (`a11y.spec.ts:46`), and axe targets are full
  of colons (`div:nth-child(1)`). Splitting it back out is correct only by the luck of labels
  containing none.
- **Log the observed counts unconditionally, immediately after `scan()` and before asserting.** All
  six tests do still run after a failure (verified: no `maxFailures`, Playwright restarts the worker
  and continues), so one red run yields every surface's numbers — but only for surfaces that reach
  `scan()`. A timeout on the new settings wait would otherwise cost a second round trip on a
  required check that also holds the single `e2e-prod-account` concurrency slot.
- **The failure message must stay actionable.** Counts alone do not say *which* node regressed, so
  the assertion passes the formatted list of observed `n.target` values as `expect`'s message
  argument. `expect(actual, 'msg').toEqual(expected)` is valid in the installed Playwright 1.62.0
  (`types/test.d.ts:8716`) and prints the message above the full diff.
- **Do not build either comparison map with `undefined` values.** `toEqual` treats an
  `undefined`-valued key as absent, so `Object.fromEntries(rules.map(r => [r, baseline[r]]))` would
  silently equate "baselined as undefined" with "not baselined". Build only from present entries.

### What is given up, and the option not taken

Within a single `(label, ruleId)` pair, swapping one violation for another of equal count goes
undetected — fixing one board contrast failure while introducing a different one reads as green.

There is a way to recover exactly that for `color-contrast`, and it was considered and declined.
axe's node data already carries `fgColor`, `bgColor`, `contrastRatio`, `fontSize`, `fontWeight`
(`axe.js:26885-26894`), all structure-independent. Keying contrast entries on
`label + ruleId + fgColor/bgColor` would survive every DOM change this rekey is designed to survive,
close the conceded precision gap, cost nothing at read time, and read as `#8a8a8a on #f4e4c1 — 2.9:1`
in review. It is declined because `nested-interactive` has no comparable payload, so the baseline
would become a hybrid of two key schemes for two rule families that are both explicitly out of
scope — and the eventual contrast redesign rewrites those entries wholesale anyway. If that redesign
happens, adopting the colour keying at the same time is the right move.

Two alternatives were rejected outright. A signature derived from `n.html` is *worse* than positional
paths here: this app's styling is inline style objects by architectural choice, so a node's
serialized HTML carries the whole resolved theme token set, and any `themeConf.ts` edit — precisely
the contrast fix these entries are waiting for — rewrites every signature. Storing counts plus a
non-asserted record of targets restores the 810-line file and its merge conflicts while removing the
only thing that kept it honest, namely being asserted; that precision belongs in the failure message
and the log line instead.

### One deliberately red CI run, and what it costs

The counts committed with the code change are a prediction, and `settings` is a guess. CI is the
regeneration mechanism: the first `E2E` run reports the true numbers and those get committed.

This should be priced rather than waved through. `E2E` is required, `retries: 0`, `workers: 1`, and
the job shares one `e2e-prod-account` concurrency group across PRs with `cancel-in-progress: false`.
Each red→transcribe→push cycle costs a full serialized run and can evict a queued PR — the accepted
cost already documented in `ci.yml`. The unconditional log line above is what keeps it to one cycle.

Note also what the `E2E_A11Y_UPDATE_BASELINE=1` path really is after this change. It is preserved and
still works, but it requires the E2E account credentials, which exist only as repository secrets and
are not in `.env.local`; CI never sets the variable. So in practice the baseline is produced by
reading numbers out of a CI log, and the `afterAll` partial-write guard protects a path reachable
only by a maintainer who has those credentials to hand. The guard stays — its reasoning about
worker restarts is sound and its cost is nil — but the spec should not describe it as the working
regeneration path.

## Determinism: what strict equality requires that the suite does not yet provide

Equality is only as good as the scan's reproducibility, and three sources of drift exist today.

### 1. The glass theme's blobs animate, and `page.clock` does not stop them

`page.clock.setFixedTime` overrides `Date`, `performance.now` and timers. It does **not** freeze CSS
animations, which run on the compositor's own timeline. `src/index.css:49-58` defines
`@keyframes blobFloat`, and three blobs (`chrome.ts:43-82`, 520–600px, `position: absolute`) run it
on 14s / 18s / 20s loops from page load. They are therefore at an arbitrary phase when axe runs — a
function of how long seeding, `waitFor` and `document.fonts.ready` took on that particular runner.

That moves a **count**, not just a target path. axe's `getBackgroundColor` walks
`document.elementsFromPoint` and, the moment any element in the stack has a `background-image`, sets
`bgColor: 'bgGradient'` and returns null (`axe.js:17784-17788`) — the node becomes **incomplete**,
and incompletes are not in `results.violations`. Glass is exactly the theme where axe must walk deep:
`themeConf.ts:98-124` makes every background above `#0b0f1f` translucent
(`toolbarBg: rgba(255,255,255,.04)`, `boardBg: .03`, `cellBg: .035`, `pageImg: 'none'`), so the walk
passes through the toolbar and board and reaches the blobs at `zIndex: 0`. Blob 1's right edge sweeps
roughly x≈400→471 across the ViewSwitcher, where `board-glass`'s toolbar contrast violation lives;
blob 3 sweeps under the calendar grid, where the other one lives.

Corroboration: glass has **2** contrast violations against brutal's 9, despite `toolbarSub`
(`rgba(234,240,255,.5)`) being the worst of the three tokens — consistent with most glass nodes
returning incomplete because a blob is in the stack.

Increases-only tolerates a phase shift that turns a violation into an incomplete. Strict equality
turns it into a red required check with `retries: 0`. **The fix is to freeze animation before every
scan**, via `page.addStyleTag` injecting
`*, *::before, *::after { animation: none !important; transition: none !important }`. That pins the
blobs at `translate(0,0) scale(1)` and makes the sample deterministic. It changes which nodes come
back incomplete relative to today's baseline, which is fine — the first run establishes the numbers
and they are stable thereafter. One thing to verify during implementation: `addStyleTag` injects a
`<style>` element, so `public/_headers`' `style-src` must permit it. The app is styled entirely with
inline style objects, which are themselves governed by `style-src`, so `'unsafe-inline'` must already
be present — confirm rather than assume.

### 2. The board scan does not wait for the third seeded card

`board-*` `nested-interactive` is exactly 3 — one per `SEEDED_TITLES` card. The board test waits for
`SEEDED_TITLES[0]` and `[1]` (`a11y.spec.ts:136-137`) but never `[2]`, the inbox card. A board that
renders two cards used to pass (fewer targets, no new pair); under equality it fails as a stale
baseline. Add the third wait.

### 3. The pinned clock is still load-bearing, for a different reason

`a11y.spec.ts:101-112` and `AGENTS.md:384` justify `page.clock` as "the baseline keys on axe's CSS
target paths, so the board's shape must not drift between runs". **After the rekey that sentence is
false**, and a literal doc realignment would delete the justification along with it. The pinning
remains necessary under counts for a different reason: `brutal` flags `div:nth-child(41)` and `(42)`,
which are trailing **out-of-month** cells, and the number of out-of-month cells in the fixed 42-cell
grid is a function of the month. The realignment must **replace** the reason, not remove it.

## Why `region` reaches zero — settled by construction, not forecast

The first draft called this a prediction. It is not; every candidate for content outside a landmark
resolves without running anything.

- **dnd-kit's accessibility nodes are not portaled, and are exempt anyway.** `core.esm.js:3363`
  renders `<Accessibility>` as a sibling of `children`, and `Board.tsx:244` passes no
  `accessibility.container`, so it renders inline — a sibling of the new `<main>`, under `.app-root`.
  Both nodes are exempt regardless: `HiddenText` is `style={{display:'none'}}` and
  `findRegionlessElms` short-circuits on `!isVisibleToScreenReaders` (`axe.js:23955`); `LiveRegion`
  is `role="status"` + `aria-live`, and `isRegion` returns true for it (`axe.js:23933`, `23987`).
- **`DragOverlay` renders `null`** with no active drag (`core.esm.js:3945-3956`).
- **The glass blobs contribute zero `region` entries.** Empirically settled by the committed
  baseline: `board-glass` and `board-cork` both have exactly 51 entries, differing only in selector
  depth (`div:nth-child(3)` → `div:nth-child(6)`, the three extra blob siblings). Mechanically, an
  empty div is neither visual content nor accessibly named, so `hasContent()` is false.
- **`OfflineBanner`** is `role="status"` and does not render in E2E regardless.
- All 51 board `region` targets are the toolbar `img`, the search bar's `input` and two `select`s,
  the calendar cells and the inbox — each lands inside `header` / `search` / `main`. Login's 7 are
  all inside the `authCard` that becomes `<main>`. Landing's 2 are inside the two sections being
  named.

One thing worth knowing even though it is clean: `BoardPage.tsx:56`'s `<Toast>` renders as a
**sibling of `<Board>`**, outside `.app-root` and outside every landmark this spec adds. It passes
only because `role="alert"` / `role="status"` is exempt from the `region` rule. A future toast
without a live-region role would fail, and no landmark added here would catch it.

## The design creates no new violations

Every candidate was checked against axe-core 4.12.1:

- `landmark-complementary-is-top-level` is `enabled: false` and tagged deprecated (`axe.js:32595`),
  and independently `landmarkIsTopLevelEvaluate` (`axe.js:26335`) carries an explicit
  `!(role === 'main' && nodeRole === 'complementary')` carve-out. `<aside>` inside `<main>` is fine
  twice over.
- `empty-heading` passes on `<h1><img alt="Magic Agenda"></h1>`: the `has-visible-text` check is
  `sanitize(subtreeText(vNode))` (`axe.js:26554`), and `subtreeText` proceeds for `role=heading`
  (name-from-content) and picks up the `alt`.
- `landmark-banner-is-top-level`, `landmark-main-is-top-level` and `landmark-no-duplicate-*` all
  pass: `.app-root`, `#root` and `body` carry no landmark role, and `<header>` is a sibling of
  `<main>`, not a descendant.
- `landmark-unique` passes on every surface — **provided the two new Landing `aria-label`s are
  distinct strings.** Identical names on two `region` landmarks would fire it.
- `aria-label` on `<select>` (role `combobox`) is allowed. `option` is excluded from
  `color-contrast` entirely, so `DatesSection`'s ~400 timezone options are inert.
- Board gets exactly one `<h1>`: only one `Toolbar` branch renders. `Toolbar`, `Inbox` and
  `SearchFilterBar` are used only by `Board`, and `BoardPreview` on landing is `inert
  aria-hidden="true"`.

## Structural edits

| File | Change |
| --- | --- |
| `src/components/Board.tsx:253` | the flex wrapper `<div>` → `<main>`. It holds the views and the Inbox; `DragOverlay` and `TaskEditor` stay outside it, which is correct — neither is page content. |
| `src/components/Toolbar.tsx:49` and `:135` | both the mobile and desktop branches: root `<div>` → `<header>` (at `:49` the style is a spread `{{ ...c.toolbar, … }}`, not the bare `c.toolbar` of `:135`); the `<img alt="Magic Agenda">` wrapped in `<h1>`. |
| `src/components/SearchFilterBar.tsx:33` | `<div>` → `<search>`; `aria-label` on both `<select>`s (`"Filter by category"`, `"Filter by status"`) and on the text input. |
| `src/components/Inbox.tsx:30` | root `<div>` → `<aside aria-label="Inbox">`. |
| `src/pages/Login.tsx:121-126` | `<div style={authCard}>` → `<main style={authCard}>`; the logo `<img>` wrapped in `<h1>`. |
| `src/pages/SettingsPage.tsx:94-104` | the `SECTIONS.map(...)` output wrapped in `<main style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>`, leaving `<header>` and `<footer>` as siblings. **The inline style is not optional — see below.** |
| `src/pages/Landing.tsx:155` and `:210` | `aria-label` on the two unnamed `<section>`s, with **distinct** strings. |
| `src/components/LegalLayout.tsx:26-44` | `<header>` around the logo link, `<main>` from the `<h1>` down through the contact block. |

### Notes on individual edits

**The settings `<main>` is the one edit that inserts an element rather than renaming one, and it
breaks the layout unless styled.** `SettingsPage.tsx:76-84` is
`display: flex; flexDirection: column; gap: 16` with six children — `<header>`, four
`<section style={card}>`, `<footer>` — giving five 16px gaps. Wrapping the sections reduces that to
three flex items; the four cards become ordinary block children of an unstyled `<main>`, and `card`
(`:57-62`) sets no margin, so the three inter-section gaps collapse to zero and the cards render
flush. `SettingsPage.test.tsx` queries by role and would not catch it. The `<main>` must carry
`display: flex; flexDirection: column; gap: 16`.

Every other structural edit renames an element while keeping its inline style object verbatim.
`<main>`, `<header>`, `<aside>` and `<search>` all get `display: block` from the UA sheet and every
call site overrides it inline, so there is no UA-style problem elsewhere. `Login`'s `authPage` is
`display: grid; placeItems: center`, and `<main style={authCard}>` behaves identically to the div.

**`<header>` gives `banner`, `<aside>` gives `complementary`, only where not nested.** axe's
`implicitHtmlRoles` (`axe.js:16255-16258`) demotes `header` to `null` only inside
`article` / `aside` / `nav` / `section` / `main`. Plain `<div>`s do not match, and `.app-root` is a
`<div>` (`Board.tsx:221`) with `<Toolbar>` as a direct child (`:224`), so the toolbar qualifies. On
the settings page `<header>` and `<footer>` must stay *siblings* of the new `<main>` for the same
reason — moving them inside demotes both and re-opens `region`.

**`<search>` is safe on both sides.** `@types/react` 19.2.17 declares `search` in
`JSX.IntrinsicElements` (`index.d.ts:4258`), so `tsc -b` accepts it, and axe-core 4.12.1 maps the
element to the `search` role (`implicitHtmlRoles`, `axe.js:16319`) which is
`{ type: 'landmark', allowedAttrs: ['aria-expanded'], superclassRole: ['landmark'] }`
(`axe.js:14756`). Browser support (Chrome 118+, Safari 17+, Firefox 118+) is well past this
project's floor.

**The `<h1>` wraps must carry the flex properties they displace.** In three of the four call sites
the `<img>` is a flex item:

- `Toolbar.tsx:137-141` (desktop): `<h1 style={{ margin: 0, flex: 'none' }}>` with the img keeping
  `height: 80, display: 'block'`.
- `Toolbar.tsx:60-72` (mobile): `<h1 style={{ margin: 0, flex: '0 1 auto', minWidth: 0 }}>` with the
  img keeping `height: 44, display: 'block', objectFit, objectPosition` and gaining
  `maxWidth: '100%'`. The comment at `Toolbar.tsx:66` records that the img is shrinkable *by design*
  so the row always fits the viewport; that behaviour must survive.
- `Login.tsx:122-126`: `<h1 style={{ margin: '0 0 6px' }}>` taking over the img's margin, with the
  img keeping `height: 110, display: 'block'`.

The UA `<h1>` margin must be zeroed at every site. No `lineHeight: 0` is needed: the img keeps
`display: block`, so the `<h1>` contains no inline-level content and generates no line box at all.
(If a later change drops `display: block`, `lineHeight: 0` alone would not be sufficient either —
the inherited UA `font-size: 2em` would also apply.)

**`LegalLayout` must be wrapped properly or not at all.** `LegalLayout.tsx:26-44` is a logo `<a>`, an
`<h1>`, a "Last updated" `<p>`, `<div>{children}</div>`, and a contact `<div>`. Wrapping only
`{children}` — the obvious reading of "a `<main>` around the body content" — leaves four of those
five outside every landmark, so `region` still fires and the pages stay inconsistent, which was the
entire justification for the edit. `/privacy` and `/terms` are not in `EXPECTED_LABELS`, so nothing
would report it.

**No CSS helper is added.** There is no visually-hidden / sr-only class in `src/index.css`, and this
design needs none: every accessible name it adds comes from an `aria-label` or an existing `alt`.
(`index.css` does already carry `.app-root`, two `@keyframes` and the `::-webkit-scrollbar` fallback,
so this is not a claim that the file is untouched — only that no offscreen-text helper exists or is
required.)

## Test changes

```ts
await page.goto('/settings')
await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
await page.addStyleTag({ content: FREEZE_ANIMATION })
await page.evaluate(async () => { await document.fonts.ready })
```

Three changes, each load-bearing:

- **The heading wait** makes the settings scan deterministic and surfaces that page's real
  violations for the first time. A comment must record *why* — the `isModalOpen` mechanism from §1 —
  so it is not later simplified away as a redundant wait.
- **`FREEZE_ANIMATION`** applies to every surface, per §"Determinism".
- **`document.fonts.ready` awaited inside the evaluate.** The current form
  `page.evaluate(() => document.fonts.ready)` returns a `FontFaceSet` to Playwright's serializer and
  works only by luck (no own enumerable properties). `smoke.spec.ts:63-67` already does the correct
  thing. Since these lines are being edited anyway, fix the form.

The board scans additionally gain the `SEEDED_TITLES[2]` wait from §"Determinism".

## Dependabot

`@axe-core/playwright` and `@playwright/test` currently fall into the `npm-minor-and-patch` catch-all
group in `.github/dependabot.yml`, which opens daily. They move into their own group covering all
update types. (`axe-core` is transitive under `@axe-core/playwright` and Dependabot does not open
indirect-only npm PRs, so naming the two direct packages captures it.)

The reason is sharper than ordinary churn: **the `E2E` job cannot run on a Dependabot PR at all.**
GitHub withholds regular repository secrets from the `dependabot` actor, so `HAS_SECRETS`
(`ci.yml:261`) evaluates to the string `"false"`, the gate step takes the `!= "true"` branch, and
every subsequent step is skipped — the job reports success having scanned nothing. An axe or
Chromium change therefore merges green and breaks the *next human PR*, the same shape as the
Changelog-backfill trap already documented in `AGENTS.md`.

**Strict equality makes this worse, not better, and the first draft had it backwards.** It claimed
the rekey "defuses most of this — selector-path churn no longer matters". Selector churn does stop
mattering, but increases-only tolerated a bump that *reduced* a count, and equality does not. A
`@playwright/test` bump changes the bundled Chromium, which changes rendering and therefore contrast
counts in **both** directions. Isolating the group makes such a change attributable to one obvious
PR; it does not make it survivable.

The same asymmetry applies beyond Dependabot: any merge landing without an E2E run (non-PR event,
fork PR, missing secrets) that incidentally *reduces* a count leaves the baseline stale, and the next
human PR goes red for a number it did not cause. Exposure is narrow — human PRs always run E2E — but
the resolution (commit the lower number) must be written down, because that first encounter is
confusing and lands on whoever happens to be next.

## Expected outcome

177 of the 202 baselined violations cleared: `region` 163, `landmark-one-main` 4,
`page-has-heading-one` 4, `select-name` 6. The 25 that remain are the two out-of-scope rule families,
recorded with the rationale above. The baseline file goes from 810 lines to 42 at the writer's
existing `JSON.stringify(x, null, 2)` indentation, and stops being invalidated by unrelated UI work.

## Documentation to realign in the same PR

- `AGENTS.md:384` — the **only** line in that file touching the ratchet. It currently reads "Where
  the a11y baseline needs a stable CSS-target shape, `page.clock` is pinned and the seed anchor
  pinned to match". Its reason must be *replaced*, not deleted, per §"Determinism" item 3. The
  `isModalOpen` trap and the downward-staleness note belong alongside the three existing "non-obvious
  constraints on the specs themselves", each of which is there because it cost a debugging pass. The
  regeneration command is not documented in `AGENTS.md` today and does not need to be added.
- `ROADMAP.md` — the a11y follow-up bullet at L81 recording 202 violations, and the two bullets at
  L49 and L73-74 asking for `RLS` and `E2E` to be promoted to required checks, which are already
  done (verified against ruleset 18273908, whose required contexts are Format, Test, Build,
  Functions, Changelog, Agents, Config, RLS, E2E) and are now stale.
- `CHANGELOG.md` — a `## [x.y.z]` section for the version this merge will mint, per
  `scripts/next-version.mjs`.

## Verification

- `npm run format:check`, `npm run lint`, `npm run build` (`tsc -b` covers the `<search>` typing and
  the worker project).
- `npm test` — no test breaks were found by inspection: nothing uses `getByAltText`,
  `getByRole('img')`, or snapshots of the affected trees; `Toolbar.test.tsx` is role/name-based,
  `Board.test.tsx:192` uses `getByText('Inbox')` (unaffected by an `aria-label` on the ancestor
  `<aside>`), `Landing.test.tsx:41` queries `container.querySelector('header')` which stays a
  `<header>`, and `globalSetup.ts` / `smoke.spec.ts` key on `+ New task`, placeholders and the
  landing `<h1>`. Run it anyway.
- `npm run test:e2e` via CI against the PR's preview — the authoritative check, expected to be red
  once with the true counts.
- A visual look at the deployed preview at desktop and mobile widths: the toolbar and login logo per
  the `<h1>` note, and **the settings page card spacing** per the `<main>` note.
