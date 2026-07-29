# Test coverage: RLS integration + Playwright E2E — design

**Date:** 2026-07-28
**Status:** approved, ready for implementation planning

## Goal

Close the two coverage gaps that current tests structurally cannot reach: the database's
authorization boundary, and anything that requires a real browser (service worker, CSP, layout,
accessibility).

## Background: what exists, and what it cannot see

48 test files, 357 tests, all Vitest under jsdom with Supabase mocked, plus 3 Deno tests for the
edge functions. There is no Playwright, Cypress, or E2E of any kind, and no test-infrastructure
item on the roadmap.

This is not a coverage-quantity problem. The pure logic in `src/data`, `src/dnd`, and `src/lib` is
thoroughly tested, and the component tests are good. It is a **coverage-altitude** problem: every
test runs at one level, and every real boundary is stubbed out.

Two consequences, both already realised in production:

1. **RLS is untested.** `AGENTS.md` states Postgres Row-Level Security is _the only_ authorization
   boundary and the anon key is public by design. Every test mocks `../lib/supabase`. A migration
   that dropped a policy, or a new table missing `enable row level security`, would pass all 357
   tests, all eight required checks, and CodeQL.
2. **Nothing runs in a real browser.** jsdom has no service worker (`AGENTS.md` says so), does not
   enforce CSP, and does not lay out. v1.2.37 fixed a bug where the worker's Google Fonts fetch was
   CSP-blocked and the stylesheet failed for every _returning_ visitor — first load never
   reproduces it, which is why a preview-deploy smoke check missed it.

## Decisions

| Decision                                                        | Rationale                                                                                                                                    |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright runs against the **Cloudflare Pages preview deploy** | `public/_headers` is Cloudflare-specific. A local server cannot reproduce how Pages resolves header rules — the exact cause of v1.2.37.      |
| A **dedicated test user** in the production project             | RLS already isolates its rows, so the blast radius is that one account. Unlocks board, themes, and settings coverage.                        |
| Visual regression is **required, on a narrow canary set**       | ~10 stable, high-value screenshots. Broad pixel-perfect suites rot; a small set means a refresh is cheap and a failure means something.      |
| Axe **baselines existing violations**, fails only on new ones   | Gets the ratchet in place without silently turning this into a theme-contrast redesign — `theme/themeConf.ts` is a deliberate verbatim port. |
| RLS tests run against a **local `supabase start` stack**        | Hermetic, free, no production involvement. `config.toml` already configures the full local stack (API 54321, DB 54322).                      |
| **Two PRs, not one**                                            | The two parts share no code, runner, or trigger. Part 1 is valuable alone; Part 2 carries all the flakiness risk.                            |

## Part 1 — RLS integration tests

### Runner and isolation from `npm test`

A second Vitest project: `vitest.rls.config.ts`, script `npm run test:rls`, tests in `tests/rls/`.

`test:rls` **assumes a stack is already running** and fails with a clear message if it is not —
it does not start one, because starting and stopping Docker containers per test run is slow and
surprising. A separate documented `npm run test:rls:up` (`supabase start`) is what CI and a
developer call first.

**`vite.config.ts` must explicitly exclude `tests/rls/**` from the default project.** Vitest's
default `include` glob matches the whole repo, so without this the RLS tests would be pulled into
`npm test`, which is hermetic by design (dummy `VITE_SUPABASE_*` env is injected precisely so unit
tests can never reach a real project). Getting this wrong makes the main suite fail for everyone
without a local stack running.

The RLS project runs serially (`fileParallelism: false`) — the tests share one database.

### Connecting

`supabase start` prints the anon and service-role keys; CI captures them with
`supabase status -o json`. Two client kinds:

- A **service-role client** to create the two test users via `auth.admin.createUser`
  (`email_confirm: true`), and to clean up afterwards.
- Two **user-scoped clients**, each signed in, exercising the policies as a real browser would.

The structural test needs `pg_catalog`, which PostgREST cannot reach, so it connects directly with
the `pg` devDependency to `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

### What it asserts

**The catch-all, and the highest-value test in this spec:**

- Every table in schema `public` has `pg_class.relrowsecurity = true`. Match `relkind IN ('r','p')`
  so a partitioned table cannot slip through as a non-ordinary relkind. This fails the day someone
  adds a table and forgets RLS, and it needs no knowledge of what that table is for.

**Cross-user isolation** (`tasks` and `user_settings`): user B cannot select, update, or delete
user A's rows. A select returns zero rows rather than erroring — that is what RLS does, and it is
exactly the behavior `useSettings` had to be written defensively against.

**The two sharp policy tests**, which isolation tests alone would not catch:

- **Forged-owner insert**: A inserts a task with `user_id = B`. A policy with `USING` but no
  `WITH CHECK` passes every isolation test above and still permits this.
- **Ownership transfer**: A updates their own task to set `user_id = B`.

Both are rejected by the current policies — these pin correct behavior rather than fix a bug.

**Anonymous access**: an anon-key client with no session reads zero rows and cannot write.

**`user_settings` has no delete policy**, so DELETE is default-denied. A test pins that, because
the absence of a policy is easy to "helpfully" add later.

**Signup trigger**: creating a user seeds exactly one `user_settings` row via
`on_auth_user_created`. This is the trigger `AGENTS.md` notes `schema.sql` alone cannot restore.

### CI

A new required `RLS` job: install the Supabase CLI, `supabase start` (which applies
`supabase/migrations/`), `npm run test:rls`. First-run image pulls cost 1–2 minutes.

## Part 2 — Playwright against the preview deploy

### Trigger — this shape is deliberate

The workflow triggers on **`pull_request`** and _polls_ the GitHub deployments API for a Cloudflare
Pages deployment matching `github.event.pull_request.head.sha`, polling every 15s for up to 10
minutes before failing with an explicit "no preview deploy appeared" message rather than hanging.

It must **not** trigger on `deployment_status`. This repo's CI history records that a required
check which never runs leaves a PR unmergeable forever, and a deploy-triggered job has exactly that
shape — no deploy, no report, no merge. A `pull_request`-triggered job always reports.

**Dependabot**: GitHub does not expose secrets to Dependabot-triggered runs, so the job skips with
success for that actor. The exemption lives **inside the step**, never in a job-level `if:` — same
pattern and same reason as the existing `Changelog` job.

### Secrets and the test account

`E2E_USER_EMAIL` and `E2E_USER_PASSWORD` as repository secrets, for a dedicated confirmed account
in the production project. Sign-in goes through the email/password form; Google OAuth is not
automatable.

### Determinism

Three fixtures, all mandatory for any test that screenshots:

- **`page.clock.setFixedTime()`** before navigation, pinned to `2026-06-15T12:00:00Z` — a Monday in
  the middle of June, chosen so the highlighted "today" cell sits well away from any month
  boundary and the grid's leading padding is identical under every supported week start.
- **`document.fonts.ready`** awaited before every screenshot. The app loads Google Fonts; a late
  webfont swap is the classic source of one-pixel diffs.
- **`animations: 'disabled'`** in screenshot options — the card pop, the glass blobs, and the
  per-theme card rotation all animate.

**`e2e/fixtures/seedBoard.ts`** resets the test account before visual tests: deletes its tasks,
inserts a fixed set with dates derived from the same pinned timestamp, and writes a known
`user_settings` row (theme, default view, `weekStart`, and `timezone: 'UTC'` so the pinned clock
maps to a deterministic date). Theme switching for the per-theme screenshots is done by seeding
`user_settings.theme` and reloading, not by driving the settings UI.

### `e2e/smoke.spec.ts`

Led by the guard for the bug that shipped twice:

- **Service worker reload**: load, wait for `navigator.serviceWorker.controller`, **reload**, then
  assert no CSP violation was reported and no request failed. A first load never reproduces this —
  the reload is the entire point of the test.
- **Webfonts actually applied**: `document.fonts.check()` for a Google font, not merely a
  `font-family` declaration, which resolves to a string whether or not the font loaded.
- Landing renders for a signed-out visitor with no console errors.
- Sign in → board renders → create a task → reload → it persists → delete it.
- Offline: `context.setOffline(true)`, reload, board still renders from the snapshot.

### `e2e/a11y.spec.ts`

`@axe-core/playwright` over six scans: landing, login, settings, and the board in each of the three
themes (contrast risk is per-theme, which is why the board is scanned three times).

Violations are compared against a committed `e2e/a11y-baseline.json` keyed on `{ruleId, target}`;
only unbaselined pairs fail. The baseline is a visible, shrinkable to-do list. The initial scan
result is reported to the maintainer so remediation can be scheduled as separate work.

### `e2e/visual.spec.ts`

Ten canaries: landing desktop, landing mobile, board calendar in cork / brutal / glass, board week
(cork), board kanban (cork), settings (cork, which covers the Dates section), the task editor
modal, and board mobile.

Baselines are committed under `e2e/visual.spec.ts-snapshots/` and **generated on the Linux CI
runner only**. Generating them on Windows would bake in platform font rendering and make every CI
run a diff. Refresh is a documented `workflow_dispatch` that re-runs with `--update-snapshots` and
commits to the PR branch.

## CI integration

Two new jobs, both required: `RLS` and `E2E`. Adding required checks means updating the branch
ruleset (id `18273908`) via `gh api -X PUT`, sending the **full** rules array — the legacy branch
protection API 404s on this repo. The required-check list is documented in several places and must
be updated in the same PR or the docs drift apart again.

## Accepted risks

- **E2E writes to the production database** as the test account. RLS bounds the blast radius to
  that account; its rows appear in the nightly backup, which is harmless.
- **The `E2E` check depends on an external deploy.** If Pages is slow or down, the job times out
  and fails rather than hanging. Accepted in exchange for testing the real header behavior — the
  only place the v1.2.37 class of bug is observable.
- **Visual baselines need refreshing on intentional UI changes.** Kept tolerable by the ten-shot
  limit.
- **The test account's credentials** live in repository secrets and need rotating like any other.

## Out of scope

- **Broad E2E UI coverage.** The jsdom component tests are fast and good; duplicating them in a
  browser buys little and rots fast.
- **Drag-and-drop gesture tests.** dnd-kit is painful to drive reliably, and `src/dnd/reorder.ts`
  is already well covered as pure logic. Noted as future work.
- **Remediating whatever axe finds.** This spec installs the ratchet and reports the findings;
  fixing them is separate work.
- **A second Supabase project for previews.** Considered and rejected as disproportionate setup —
  `Deploy Migrations` would need to target both or the schemas silently drift.

## Documentation to update

`AGENTS.md` (a testing section covering both layers, the hermetic-`npm test` boundary, and the
required-check list), `README.md` (the commands), `ROADMAP.md` (record this as shipped
infrastructure), and `CHANGELOG.md` for each PR's target version.
