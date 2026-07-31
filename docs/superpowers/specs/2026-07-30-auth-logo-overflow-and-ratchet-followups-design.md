# Auth logo overflow, plus two a11y-ratchet follow-ups — design

**Date:** 2026-07-30
**Status:** approved, ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-07-30-a11y-landmarks-design.md`

Three unrelated-looking items that share one branch because two of them were recorded as follow-ups
while the parent spec was being implemented, and the third was found by the visual check that closed
it out.

| # | Item | Origin |
| --- | --- | --- |
| 1 | The auth pages' logo overflows its card at every viewport width | Found during the parent branch's preview check; **pre-existing**, not introduced there |
| 2 | `color-contrast` findings log their colours | Recorded as "the option not taken" in the parent spec |
| 3 | A check that `EXPECTED_LABELS` matches the spec's actual scan call sites | Recorded as a follow-up by the parent branch's whole-branch review |

## 1. The auth logo overflows its card

### What is wrong

Measured against production (which is what the fix must be judged against, since the parent branch
changed none of this):

```
1280px  pageOverflow=false | card=400 inner=344 logo=381  → logo bleeds 37px past the card
 768px  pageOverflow=false | card=400 inner=344 logo=381  → same
 390px  pageOverflow=true  | card=400 inner=344 logo=381  → same, plus the page overflows
 320px  pageOverflow=true  | card=400 inner=344 logo=381  → same
```

Two distinct symptoms, one cause. The logo has **always** been 37px wider than its card's content
box, at every width; below roughly 450px that also drags the page wider than the viewport. So this
is not a mobile bug that happens to show on desktop — it is a sizing bug that happens to become a
page-level overflow on phones.

Every public route at 390px:

```
/               scrollW= 390 clientW=390  ok
/login          scrollW= 449 clientW=390  OVERFLOWS by 59
/privacy        scrollW= 390 clientW=390  ok
/terms          scrollW= 390 clientW=390  ok
/auth/reset     scrollW= 449 clientW=390  OVERFLOWS by 59
/auth/confirm   scrollW= 449 clientW=390  OVERFLOWS by 59
```

Exactly the three pages built on `authCard`, by exactly the same amount. `/`, `/privacy` and
`/terms` are already clean, which is what makes the regression test in §4 safe to apply to all six.

### Why

Two things compound:

- **The logo cannot shrink.** `logo-dark.svg` is `900×260` natural. The `<img>` carries
  `{ height: 110, display: 'block' }` with no `max-width`, and `object-fit` is therefore its default
  `fill`. At `height: 110` its used width is `900 × (110/260) ≈ 381px`, fixed, regardless of the
  space available.
- **The card sizes itself to the logo, not to the viewport.** `authPage` (`authChrome.ts:4-13`) is
  `display: grid; place-items: center` with **no `grid-template-columns`**, so the implicit column is
  `auto` — which sizes to the item's max-content contribution, and that contribution is driven by the
  381px logo. `authCard`'s `width: min(400px, 100%)` then resolves its `100%` against that inflated
  column rather than against the viewport, which is why the card measures 400px even at 390px wide
  where only 350px is available.

`box-sizing: border-box` is set globally (`src/index.css:3`), so `authCard`'s `padding: 28` is inside
its 400px, leaving the 344px content box the logo overruns.

### The fix

```ts
// src/pages/authChrome.ts
authPage:  + gridTemplateColumns: 'minmax(0, 1fr)'
authLogo:  NEW export — { maxWidth: '100%', height: 'auto', display: 'block' }
```

`minmax(0, 1fr)` caps the column at the container's width, so `min(400px, 100%)` resolves against the
viewport as it was always meant to. It is what stops any future unbreakable content re-opening the
same bug, and is worth keeping even though §1's logo change alone would fix today's symptom.

`height: 'auto'` is not incidental — it is what preserves the aspect ratio. With `height: 110`
retained, clamping the width would squash the image horizontally, because `object-fit` defaults to
`fill`. (The alternative, `objectFit: 'contain'` with the height kept, letterboxes inside a 110px box
and is what `Toolbar.tsx` does on mobile; it is not used here because the auth card has no fixed-height
row to fit into.)

Six call sites replace `style={{ height: 110, display: 'block' }}` with `style={authLogo}`, all
currently byte-identical:

| File | Lines |
| --- | --- |
| `src/pages/Login.tsx` | 123 |
| `src/pages/ResetPassword.tsx` | 53, 74, 117 |
| `src/pages/AuthConfirm.tsx` | 55, 73 |

The surrounding `<h1 style={{ margin: '0 0 6px' }}>` added by the parent branch is unchanged.

### What this changes visually

Predicted, to be confirmed against the deployed preview:

```
1280px  card 400  inner 344  logo 344×99   no bleed   (today 381×110, bleeding 37px)
 390px  card 350  inner 294  logo 294×85   no overflow
 320px  card 280  inner 224  logo 224×65   no overflow
```

**The desktop logo gets about 10% smaller.** That is the intended outcome, not a side effect: it is
currently oversized relative to its container. This is a deliberate, visible change to the sign-in
page and should be looked at on the preview before merge.

## 2. Colour data in the `color-contrast` log

The parent spec conceded one thing when it moved the baseline to counts: within a single
`(label, ruleId)` pair, swapping one violation for another of equal count goes undetected. It also
recorded the fix — axe already returns `fgColor` / `bgColor` / `contrastRatio` — and declined it,
because adopting it would make the baseline a hybrid of two key schemes for two rule families that
are both explicitly out of scope.

That reasoning still holds, so **the baseline format does not change.** What changes is that the
colour data reaches the log, which is where it is actually useful: it is what makes the eventual
contrast redesign easy to start, and it costs nothing because the data is already in the results
object.

axe attaches it on the check result (`axe-core/axe.js`, the `color-contrast` evaluate):

```js
this.data({
  fgColor: fgColor ? fgColor.toHexString() : void 0,
  bgColor: bgColor ? bgColor.toHexString() : void 0,
  contrastRatio: truncatedResult,
  fontSize: `${(fontSize * 72 / 96).toFixed(1)}pt (${fontSize}px)`,
  fontWeight: bold ? 'bold' : 'normal',
  expectedContrastRatio: `${expected}:1`,
  …
})
```

so it is read from `node.any.find((check) => check.id === 'color-contrast')?.data`.

**Design:** `Finding` gains an optional `detail?: string`. `scan()` populates it for
`color-contrast` violations only. `formatFindings()` prints it on an indented continuation line:

```
[a11y] board-brutal {"color-contrast":9,"nested-interactive":3}
  color-contrast  .app-root > div:nth-child(1) > … > button:nth-child(2)
                  #8a8a8a on #f4e4c1 — 2.9:1 (needs 4.5:1)
  nested-interactive  div:nth-child(16) > div:nth-child(2) > …
```

`detail` is deliberately **not** part of the count key, so `tally()`, `baselineFor()`, `toBaseline()`
and `a11y-baseline.json` are all untouched and the ratchet's semantics do not move. It reaches only
the log line and the assertion's failure message.

Both `fgColor` and `bgColor` can be `undefined` when axe could not resolve a colour — but that path
produces an *incomplete*, not a violation, and incompletes never enter `results.violations`. The
formatter still guards for it rather than printing `undefined on undefined`.

## 3. A check that `EXPECTED_LABELS` matches the scan call sites

### The gap

`parseBaseline()` rejects a baseline entry whose label is not in `EXPECTED_LABELS`. Nothing checks
the other direction: that every label in `EXPECTED_LABELS` is actually scanned by a test. A surface
deleted or `.skip`'d stops asserting its baseline entries and emits no signal, because the
`afterAll` partial-write guard only runs in update mode — and the parent spec explains why it cannot
move: Playwright discards a worker after a failure, so a coverage check there would re-fire
spuriously in every restarted worker.

### The check

It can be done statically instead, with no Playwright dependency, in `npm test`. The parsing is a
pure function so it is testable in its own right — the same split that makes `src/sw/policy.ts` and
`tests/rls/reloptions.ts` testable:

```ts
// scripts/a11y-baseline.ts
export function parseScanCallSites(specSource: string): string[]
```

It extracts the argument of every `scanAndAssert(page, …)` call. Three of the four call sites are
string literals; the fourth is `` `board-${theme}` `` inside `for (const theme of ['cork', 'brutal',
'glass'] as Theme[])`, so the template is resolved against the theme array found in the same source.

**It throws when it finds no call sites.** That is the load-bearing part: a text-parsing check whose
regex stops matching — after a rename, a reformat, or a refactor — would otherwise pass vacuously,
which is precisely the silent-rot failure this whole effort exists to prevent. Failing loudly on
"found nothing" is what makes the check trustworthy.

The unit test asserts `parseScanCallSites(<the committed spec>)` equals `EXPECTED_LABELS` as a set,
and separately exercises the function against synthetic sources: a missing label, an extra label, a
renamed helper (must throw), and the template case.

### What this does and does not catch

Catches: a label added to `EXPECTED_LABELS` with no test; a test removed while its label stays; a
label renamed on one side only. Does **not** catch a `.skip`'d test — the call site is still in the
source. That limit is worth stating in the test's comment rather than leaving a reader to assume
coverage it does not have.

## 4. Testing

**Unit (`npm test`), all hermetic:**

- Each of `Login`, `ResetPassword` and `AuthConfirm` asserts its logo carries `maxWidth: '100%'` and
  `height: 'auto'`. jsdom has no layout engine, so this is a shape assertion, not a measurement —
  the same compromise as the settings-page gap test in the parent branch. It catches a call site
  missed during the edit, which is the realistic regression.
- `formatFindings()` with and without `detail`, and with `detail` present but colours undefined.
- `parseScanCallSites()` against synthetic sources per §3, plus the committed spec file.

**E2E — the test that would actually have caught this.** At a 390px viewport, assert
`document.documentElement.scrollWidth <= clientWidth` for the six public routes `/`, `/login`,
`/privacy`, `/terms`, `/auth/reset`, `/auth/confirm`. Signed-out, so it needs no seeding. Measured
above: three already pass, three fail by exactly 59px and will pass once §1 lands.

This belongs in `smoke.spec.ts`, not `a11y.spec.ts` — it is a layout assertion, not an axe scan, and
putting it in the a11y spec would entangle it with `EXPECTED_LABELS` and the baseline machinery for
no reason. It needs its own `test.describe` with `test.use({ viewport: … })`, since the project's
default viewport is desktop.

**Manual:** the sign-in page on the deployed preview at desktop and phone widths, because §1 changes
the desktop logo's size and no automated test asserts how it *looks*.

## 5. Out of scope

- **Rekeying `color-contrast` baseline entries on colour data.** Declined again here, for the reason
  the parent spec gives: it buys precision only for rule families nobody is scheduled to touch, at
  the cost of two key schemes in one file. The right moment is the contrast redesign itself, which
  would rewrite those entries anyway.
- **The 16 `color-contrast` and 9 `nested-interactive` violations.** Still baselined, still out of
  scope, for the reasons recorded in `tests/e2e/a11y.spec.ts`'s header comment.
- **Any change to `a11y-baseline.json` or the count-equality semantics.**

## 6. Documentation

- `CHANGELOG.md` — a section for the version this merge mints (`node scripts/next-version.mjs`
  prints `1.2.46` at the time of writing; re-run it, since another merge may land first).
- `AGENTS.md` — no change needed. The auth-logo fix is ordinary layout work, and neither follow-up
  alters a documented convention. Resist adding a bullet for its own sake; that file earns its length
  by only recording things that cost a debugging pass.
