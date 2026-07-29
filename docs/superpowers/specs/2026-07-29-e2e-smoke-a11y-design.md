# E2E Part 2A: Playwright smoke + a11y against the preview deploy — design

**Date:** 2026-07-29
**Status:** approved, ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-07-28-test-coverage-rls-and-e2e-design.md`

This is Part 2 of the parent spec, sliced. It carries §2.1–§2.5 (infrastructure, smoke, a11y) and
defers §2.6 (visual regression) to a separate plan. Everything the parent spec settles is settled
here too; this document records only what changed, what was verified, and what the slice decides.
Read the parent for the rationale behind the decisions that carry over unchanged.

## Why sliced here

Smoke and a11y share every piece of infrastructure — preview discovery, the workflow skeleton,
`storageState` auth, board seeding — and both belong on the required-check track. Visual adds
machinery none of the others need: Linux-only baseline generation, the artifact-based refresh flow,
and the "a Playwright upgrade invalidates every baseline" problem. The parent spec calls visual "the
expensive commitment", and it is the piece most likely to churn. Landing the shared infrastructure
first means Plan B starts with a proven runner instead of debugging two things at once.

## What changed since the parent spec

The parent was written on 2026-07-28, before Part 1 was implemented. Three of its assumptions no
longer hold.

### 1. The preview-discovery mechanism does not exist — replaced

The parent (§2.1) polls the GitHub deployments API for a Cloudflare Pages deployment matching
`head.sha`. **This repository has zero GitHub Deployments.** Cloudflare Pages reports as a *check
run* named `Cloudflare Pages`, whose `details_url` points at the Cloudflare dashboard rather than at
the preview. There is no preview URL anywhere in GitHub's deployments, commit-status, or check-run
payloads.

The replacement, verified before adoption:

1. Poll `GET /repos/{owner}/{repo}/commits/{head_sha}/check-runs` for the run named
   `Cloudflare Pages`, until `status == "completed"`.
2. Extract the deployment UUID from its `details_url` with
   `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`.
3. The preview is `https://<first 8 chars of that UUID>.magic-agenda.pages.dev`.

**Evidence.** Checked against three merged PRs — #115 (`15aaf5a2`), #113 (`1039d130`), and #114
(`52e80f42`) — each of which resolved to HTTP 200. The branch-alias form
(`https://<branch-slug>.magic-agenda.pages.dev`) returned 404 and is not used.

This needs `checks: read` in the workflow's `permissions` block, **not** `deployments: read`. Every
workflow in this repo is least-privilege `contents: read`, so omitting it fails the poll on the
first run.

Two properties worth stating, because they are why this was preferred over the Cloudflare API:

- **It is commit-exact.** The check run is attached to `head.sha`, so this cannot silently test
  "the latest build for this branch" the way a branch alias would.
- **It needs no new secret.** No Cloudflare API token to create, scope, or rotate.

The cost is that both the URL convention and the `details_url` format are undocumented. If either
changes, the job fails **loudly** — no matching check run, or a preview URL that does not resolve —
rather than testing the wrong thing. The recorded fallback is the Cloudflare Pages deployments API
(`GET /accounts/{account_id}/pages/projects/magic-agenda/deployments`, matching
`deployment_trigger.metadata.commit_hash`), which returns the URL authoritatively at the cost of a
`CLOUDFLARE_API_TOKEN` secret.

Poll every 15s for up to 10 minutes, then fail with an explicit "no preview deploy appeared for
`<sha>`" message rather than hanging.

### 2. Specs live in `tests/e2e/`, not `e2e/`

The parent writes `e2e/smoke.spec.ts`. Part 1 shipped `exclude: [..., 'tests/**']` in
`vite.config.ts` and `"include": ["tests"]` in `tsconfig.test.json`. A root-level `e2e/` directory
would therefore be swept into `npm test` — which must never need a browser or a network — **and** be
the only untypechecked TypeScript in the repo. `tests/e2e/` inherits both nets for free and needs no
config change at all.

### 3. Part 1 is merged, and the ground it sits on moved

`RLS` is a required check as of v1.2.42. Two migrations shipped that bear on the database this suite
writes to: `20260729100000` made the Data API grants explicit, and `20260729190000` revoked the
permissive default privileges that would otherwise have auto-granted every future table to `anon`.
Neither changes what E2E does, but both mean the production schema's authorization posture is now
what the tests assume.

## Decisions

| Decision                                                          | Rationale                                                                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Check run + URL convention for preview discovery                  | No new secret, commit-exact, verified across three deployments. Fails loudly if the convention breaks.                             |
| `tests/e2e/`                                                      | Inherits Part 1's `npm test` exclude and tsconfig coverage.                                                                       |
| Chromium only                                                     | The bugs this guards (CSP, service worker) are engine-behaviour, not cross-browser. Adding engines multiplies runtime for little. |
| Desktop viewport only                                             | Mobile layouts branch on `useIsMobile`; covering them belongs with the visual work, which screenshots them.                       |
| **smoke runs on real time; a11y pins the clock, with a fallback** | See Determinism. The parent makes the clock mandatory for screenshots; this slice has none.                                        |
| One job, `E2E`, carrying both specs                               | They share sign-in, seeding, and the preview URL. Splitting them doubles a 2–4 minute setup for no isolation benefit.             |
| Merge non-required, promote after it reports                      | The repo's standing CI lesson. Same two-step used for `RLS` in v1.2.40 → v1.2.42.                                                 |

## Architecture

### Tooling

New devDependencies: `@playwright/test` and `@axe-core/playwright`. A `playwright.config.ts` at the
repo root, with `testDir: 'tests/e2e'`, `workers: 1`, and `baseURL` supplied by the workflow from the
discovered preview. Scripts mirror the `test:rls` naming: `npm run test:e2e` runs the suite against
`E2E_BASE_URL`, and fails with an actionable message if that is unset rather than silently testing
production.

CI installs only the Chromium browser (`npx playwright install --with-deps chromium`); the full
install pulls three engines for no benefit here.

`@playwright/test` is **not** pinned out of Dependabot's reach in this plan. That pin exists to stop
a version bump silently invalidating visual baselines, and there are none yet — it lands with Plan B,
in the same change that creates them.

### Workflow shape

A new `E2E` job in `.github/workflows/ci.yml`, triggering on `pull_request` like every other job.
**Never on `deployment_status`** — a deploy-triggered job has exactly the shape of a required check
that never runs, which leaves a PR unmergeable forever.

`permissions` gains `checks: read`.

**Skip conditions, both required, both succeeding from inside a step rather than a job-level `if:`**
— a job-level condition would stop the check reporting at all, which is the failure mode above:

- **The head repo is a fork.** This repo is public and Cloudflare does not build previews for fork
  PRs, so a fork PR gets neither secrets nor a preview. A required E2E check would make outside
  contributions permanently unmergeable.
- **The run has no secrets** (which also covers Dependabot).

### Serialising against one production account

Both levels from the parent §2.2 are required:

- **Across PRs:** workflow-level `concurrency` group `e2e-prod-account`, `cancel-in-progress: false`.
  **Accepted cost:** GitHub keeps only one pending run per group, so a third PR queueing behind a
  running and a waiting one cancels the middle one, which then needs a manual re-run.
- **Within a run:** Playwright `workers: 1`.

Without this, two PRs corrupt each other and not subtly: the app subscribes to Supabase realtime, so
one run's seeding deletions are pushed live into the other's open page between load and assertion.

### Auth and seeding

Sign in **once** per run via a Playwright global setup and reuse `storageState`. Beyond speed,
`config.toml` sets a `sign_in_sign_ups` limit of 30 per 5 minutes per IP, and a shared CI egress IP
makes per-test sign-in a self-inflicted flake.

`tests/e2e/fixtures/seedBoard.ts` resets the account with the **user-scoped client** — anon key plus
the test account's credentials. **The production service-role key must never enter CI**; it bypasses
RLS entirely and would be a categorical downgrade of the posture this work exists to protect.

Seeding deletes the account's tasks, inserts a fixed set, and writes a known `user_settings` row
(theme, default view, `weekStart`, `timezone: 'UTC'`). Per-theme scans set `user_settings.theme` and
reload rather than driving the settings UI.

### Determinism

The parent makes `page.clock.setFixedTime()` mandatory for anything that screenshots. This slice
screenshots nothing, and `page.clock` carries two risks the parent flags as verify-not-assume: it can
invalidate Supabase JWT expiry checks, since the token was issued in real time, and it may not reach
the service worker's separate context. So the clock is decided per suite:

- **smoke runs on real time.** Faking it would undermine the service-worker reload test, which is the
  single most valuable thing in this slice.
- **a11y pins the clock**, because axe targets are CSS paths and the calendar grid's shape changes
  with the month. **Verify during implementation that sign-in still succeeds under a fixed clock.**
  If it does not, the fallback is real time plus a baseline refreshed when it drifts — record which
  path was taken and why.

`document.fonts.ready` is awaited before any assertion that depends on rendered text.

## `tests/e2e/smoke.spec.ts` — required after promotion

Led by the guard for the bug that shipped twice (v1.2.37):

- **Service worker reload.** Load, wait for `navigator.serviceWorker.controller`, **reload**, then
  assert no CSP violation and no failed request. A first load never reproduces this — the reload is
  the entire point.
- **Webfonts actually applied**, via `document.fonts.check()`. A `font-family` assertion resolves to
  a string whether or not the font loaded.
- Landing renders signed-out with no console errors.
- Sign in → board renders → create a task → reload → it persists → delete it.
- **Offline:** `context.setOffline(true)`, reload, board still renders. **This must assert the
  _source_ of the response**, not merely that something rendered: Playwright's offline emulation does
  not reliably sever service-worker-initiated fetches, so a naive version passes while the page is
  served from the network. Assert a marker only the snapshot path produces — the `OfflineBanner`, or
  `savedAt` from the snapshot envelope. **If severing cannot be made reliable, drop this test rather
  than keep a vacuous one**, and say so in the report.

**The no-console-errors assertion must allowlist the Cloudflare Insights host.** `public/_headers`
records that Cloudflare's injected beacon hash changes without notice and silently re-breaks CSP.
Unscoped, that event turns every PR red for a cause unrelated to any PR.

## `tests/e2e/a11y.spec.ts` — required after promotion

`@axe-core/playwright` over six scans: landing, login, settings, and the board in each of the three
themes, since contrast risk is per-theme.

Violations compare against a committed `tests/e2e/a11y-baseline.json` keyed on `{ruleId, target}`;
only unbaselined pairs fail. Targets are CSS paths, so this is stable only because the board is
seeded — the baseline depends on `seedBoard` staying fixed.

**The initial scan result is reported to the maintainer** so remediation can be scheduled as separate
work. Installing the ratchet is in scope; fixing what it finds is not — `theme/themeConf.ts` is a
deliberate verbatim port and turning this into a contrast redesign would be a different project.

## Rollout

Two steps, never one:

1. Merge the workflow **not required**. Confirm it reports on a real PR and goes green.
2. Only then add `E2E` to branch ruleset `18273908` via `gh api -X PUT`, sending the **full** rules
   array — the legacy branch-protection API 404s on this repo.

Making a check required before its workflow exists on `main` wedges every other open PR. The
required-check list appears in `README.md` and `AGENTS.md` and must be updated in the same PR that
changes it.

## Prerequisites the maintainer must do

Neither can be automated, and nothing runs until both exist:

1. **Create a dedicated test account** in the production Supabase project, email-confirmed.
2. **Add `E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD`** as repository secrets.

## Accepted risks

To be recorded in a dated note under `private/`, which `AGENTS.md` establishes as the record for
accepted risks:

- **E2E writes to the production database** as the test account. RLS bounds the blast radius to that
  one account; its rows appear in the nightly backup, which is harmless.
- **A production account's credentials live in repository secrets** and need rotating like any other.
  The service-role key does not, and must not.
- **The `E2E` check depends on an external deploy.** If Pages is slow or down, the job times out and
  fails rather than hanging.
- **Preview discovery rests on two undocumented Cloudflare behaviours** — the `details_url` shape and
  the deployment-ID URL convention. Verified across three deployments; fails loudly, not silently;
  fallback recorded above.
- **Concurrent-run queue cancellation** can require a manual re-run.

## Out of scope

- **Visual regression** — Plan B, together with pinning `@playwright/test` out of Dependabot's reach.
  That pin only matters once baselines exist, since a Playwright upgrade invalidates all of them.
- **Mobile viewports** — they belong with the visual work that screenshots them.
- **Broad E2E UI coverage.** The jsdom component tests are fast and good; duplicating them in a
  browser buys little and rots fast.
- **Drag-and-drop gesture tests.** dnd-kit is painful to drive reliably and `src/dnd/reorder.ts` is
  already well covered as pure logic.
- **Remediating whatever axe finds.**

## Documentation to update

`AGENTS.md` (the testing-layers section gains the E2E layer, the preview-discovery mechanism and why
it is shaped that way, and the required-check list), `README.md` (commands and the check list),
`ROADMAP.md` (Part 2 progress, Plan B remaining), and `CHANGELOG.md` for the target version.
