# Test coverage: RLS integration + Playwright E2E — design

**Date:** 2026-07-28
**Revised:** 2026-07-29, after an independent review found two critical holes and eight operational
gaps. Every change below is traceable to that review; the sections it did not challenge are
unchanged.
**Status:** revised, ready for implementation planning

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

| Decision                                                               | Rationale                                                                                                                                                                              |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright runs against the **Cloudflare Pages preview deploy**        | `public/_headers` is Cloudflare-specific. A local server cannot reproduce how Pages resolves header rules — the exact cause of v1.2.37.                                                |
| A **dedicated test user** in the production project                    | RLS already isolates its rows, so the blast radius is that one account. Unlocks board, themes, and settings coverage.                                                                  |
| Smoke + a11y **required**; visual regression **non-required at first** | Visual is the expensive commitment — three of the last four releases touched UI. Land it reporting-only, learn the real refresh cadence, promote later with a one-line ruleset change. |
| Axe **baselines existing violations**, fails only on new ones          | Gets the ratchet in place without silently turning this into a theme-contrast redesign — `theme/themeConf.ts` is a deliberate verbatim port.                                           |
| RLS tests run against a **local `supabase start` stack**               | Hermetic, free, no production involvement.                                                                                                                                             |
| Part 1 ships an **explicit `GRANT` migration**                         | Not a test workaround — a real schema-parity fix with a deadline. See below.                                                                                                           |
| **Two PRs, not one**                                                   | The two parts share no code, runner, or trigger. Part 1 is valuable alone; Part 2 carries all the flakiness risk.                                                                      |

---

# Part 1 — RLS integration tests

## 1.1 First, a schema gap this work exposes

`supabase/config.toml` leaves `auto_expose_new_tables` **unset**, which per the CLI's own comment
means entities created in `public` are **not** reachable through the Data API roles (`anon`,
`authenticated`, `service_role`) without explicit `GRANT`s — the new cloud default. There are
**zero** `GRANT` statements across all eight migrations.

Production works only because its tables were created in June under the legacy auto-expose
behavior. Replay the same migrations into a fresh database on today's CLI and every PostgREST call
fails with `42501 permission denied` — the RLS suite would die on its happy path before testing a
single policy.

This is not only a test problem. **That config field is removed on 2026-10-30**, after which any
new table would be silently unreachable in production too. So Part 1 opens with a migration making
the grants explicit:

```sql
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.tasks           to anon, authenticated, service_role;
grant select, insert, update, delete on public.user_settings   to anon, authenticated, service_role;
grant usage, select on all sequences in schema public          to anon, authenticated, service_role;
```

Two things about this that must not be "tidied" later:

- **`anon` genuinely needs these grants**, and RLS — not the grant — is what denies it. `AGENTS.md`
  documents that an unauthenticated select resolves `{ data: null, error: null }` rather than
  erroring, and `useSettings` branches on exactly that distinction: an error means "fall back to the
  snapshot", no-rows means "no settings yet". Revoking `anon` would turn empty results into `42501`
  errors and silently change that behavior in production.
- **On production this is a no-op** — those grants already exist. It exists to make local match
  production and to survive the October cutover.

## 1.2 Runner and isolation from `npm test`

A second Vitest project: `vitest.rls.config.ts`, script `npm run test:rls`, tests in `tests/rls/`.

`test:rls` **assumes a stack is already running** and fails with a clear message if not. A separate
`npm run test:rls:up` starts one, trimmed to what the tests need:

```
supabase start -x studio,edge-runtime,logflare,vector,imgproxy
```

The full stack (analytics, storage, studio, mailpit) takes 3–6 minutes to come up on a cold runner;
the tests need only the database, auth, and PostgREST.

**`vite.config.ts` must explicitly exclude `tests/rls/**` from the default project.** Vitest's
default `include` glob matches the whole repo, so without this the RLS tests would be pulled into
`npm test`, which is hermetic by design. Getting this wrong makes the main suite fail for everyone
without a local stack running.

**While in that file, change the dummy `VITE_SUPABASE_URL`.** It is currently
`http://localhost:54321` — which is the real local stack's address whenever the RLS stack is up.
Hermeticity rests on mocking alone today; an unmocked call would hit a live database rather than
failing loudly. Use a port nothing listens on.

The RLS project runs serially (`fileParallelism: false`) — the tests share one database.

## 1.3 Connecting

Pin the Supabase CLI to an exact version in the RLS job; `supabase status -o json` key names have
changed across CLI majors, and `version: latest` invites a green build turning red on someone
else's release.

Two client kinds:

- A **service-role client** to create test users via `auth.admin.createUser`
  (`email_confirm: true`) and clean up afterwards. User emails are randomised per run so a crashed
  previous run cannot collide; passwords satisfy the configured policy
  (`lower_upper_letters_digits_symbols`, 10+ chars).
- Two **user-scoped clients**, each signed in, exercising the policies as a real browser would.

The structural tests need `pg_catalog`, which PostgREST cannot reach (only `public` and
`graphql_public` are exposed), so they connect directly with the `pg` devDependency to
`postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

**`supabase start` and this repo's `config.toml`.** The file references `env()` secrets
(`RESEND_API_KEY`, `GOOGLE_OAUTH_CLIENT_SECRET`, and others) and the deploy workflows already carry
them because the CLI parses the whole file on every command. The RLS job must set **explicit dummy
values**.

> **Never pass the real `RESEND_API_KEY` to this job.** `config.toml` enables SMTP against
> `smtp.resend.com`, so a local GoTrue holding the production key could send real email to real
> addresses from a test run. The obvious "fix" of copying the `Config` job's env block is the
> trap.

`config.toml` also references `supabase/seed.sql`, which **does not exist**. Confirm `supabase start`
tolerates that on the first run; if not, add an empty seed file.

## 1.4 What it asserts

**The structural catch-alls** — no knowledge of any particular table required:

- Every table in `public` has `pg_class.relrowsecurity = true`. Match `relkind IN ('r','p')` so a
  partitioned table cannot slip through. This fails the day someone adds a table and forgets RLS.
- Every RLS-enabled table has **at least one policy**. RLS-on-with-no-policies is default-deny —
  safe, but it breaks the app silently, which is its own kind of outage.
- No unexpected **views** in `public`, or all of them are `security_invoker`. A view defaults to the
  definer's rights and is PostgREST-exposed, so it walks straight past the `relrowsecurity` check.
  This is the gap the catch-all above does not cover.

**Cross-user isolation** (`tasks` and `user_settings`): user B cannot select, update, or delete user
A's rows.

**The exact anon behavior `useSettings` depends on**: an anon-key client with no session gets
`{ data: [], error: null }` — empty, _not_ an error. This pins the distinction that a careless
`revoke` would flip, and it is the one place a grants change would silently alter production logic.

**The two sharp policy tests**, which isolation tests alone would not catch:

- **Forged-owner insert**: A inserts a task with `user_id = B`. A policy with `USING` but no
  `WITH CHECK` passes every isolation test above and still permits this.
- **Ownership transfer**: A updates their own task to set `user_id = B`.

Both are rejected by the current policies — these pin correct behavior rather than fix a bug.

**`user_settings` has no delete policy**, so DELETE is default-denied. A test pins that, because the
absence of a policy is easy to "helpfully" add later.

**Signup trigger**: creating a user seeds exactly one `user_settings` row via
`on_auth_user_created` — the trigger `AGENTS.md` notes `schema.sql` alone cannot restore.

---

# Part 2 — Playwright against the preview deploy

## 2.1 Trigger, and why this shape

The workflow triggers on **`pull_request`** and polls the GitHub deployments API for a Cloudflare
Pages deployment matching `github.event.pull_request.head.sha`, every 15s for up to 10 minutes,
then fails with an explicit "no preview deploy appeared" message rather than hanging. It needs
`deployments: read` added to the workflow's `permissions` block — every workflow here is
least-privilege `contents: read`, so the poll fails on the first run without it.

It must **not** trigger on `deployment_status`. A required check that never runs leaves a PR
unmergeable forever, and a deploy-triggered job has exactly that shape.

**Skip conditions — both required, and neither is "author is Dependabot":**

- **The head repo is a fork.** This repo is public, and `config.toml` records that Cloudflare does
  not build previews for fork PRs. A fork PR gets no secrets _and_ no preview, so a required E2E
  check would make outside contributions permanently unmergeable.
- **The run has no secrets** (which also covers Dependabot).

Both skip with **success**, from inside the step rather than a job-level `if:` — same pattern and
same reason as the existing `Changelog` job.

## 2.2 Serialising against a shared production account

Every signed-in test drives one production account. Without a mutex, two PRs running E2E
concurrently corrupt each other, and not subtly: the app subscribes to Supabase realtime, so run
B's `seedBoard` deletions are **pushed live into run A's open page** between load and screenshot.
Every board-dependent test — 5 of 10 visual canaries, 3 of 6 axe scans, the persistence smoke test —
is affected. The result would be nondeterministic failures on checks that gate the release.

Two levels of serialisation, both required:

- **Across PRs**: a workflow-level `concurrency` group (`e2e-prod-account`,
  `cancel-in-progress: false`). **Accepted cost, stated plainly:** GitHub retains only one pending
  run per group, so if a third PR queues while one runs and one waits, the middle run is cancelled
  and needs a manual re-run. Tolerable for a mostly-solo repo; it must be documented, not
  discovered.
- **Within a run**: Playwright `workers: 1`. The default is parallel, and smoke, a11y, and visual
  specs would otherwise fight over the same account inside a single run — a mutex across PRs would
  not help at all.

Sign in **once** per run and reuse `storageState`. Beyond speed, `config.toml` sets a
`sign_in_sign_ups` rate limit of 30 per 5 minutes per IP, and a shared CI egress IP makes
per-test sign-ins a self-inflicted flake.

**Seeding uses the user-scoped client** (anon key plus the test account's credentials). The
production **service-role key must never be placed in CI** — it bypasses RLS entirely and would be
a categorical downgrade of the security posture this spec exists to protect.

## 2.3 Determinism

Mandatory for anything that screenshots:

- **`page.clock.setFixedTime()`** pinned to `2026-06-15T12:00:00Z` — a Monday in mid-June, chosen
  so the highlighted "today" cell sits far from any month boundary and the grid's leading padding
  is identical under every supported week start.
- **`document.fonts.ready`** awaited before every screenshot.
- **`animations: 'disabled'`** — the card pop, glass blobs, and per-theme rotation all animate.

**Two clock interactions to verify during implementation, not assume**: a faked clock can invalidate
Supabase's JWT expiry checks (the token was issued in real time), and `page.clock` may not reach the
service worker's separate context. If either bites, pin the clock only for the visual spec and let
smoke run on real time.

**`e2e/fixtures/seedBoard.ts`** resets the account before visual tests: deletes its tasks, inserts a
fixed set with dates derived from the pinned timestamp, and writes a known `user_settings` row
(theme, default view, `weekStart`, `timezone: 'UTC'`). Per-theme screenshots seed
`user_settings.theme` and reload rather than driving the settings UI.

## 2.4 `e2e/smoke.spec.ts` — required

Led by the guard for the bug that shipped twice:

- **Service worker reload**: load, wait for `navigator.serviceWorker.controller`, **reload**, then
  assert no CSP violation and no failed request. A first load never reproduces this; the reload is
  the entire point.
- **Webfonts actually applied**: `document.fonts.check()`, not a `font-family` declaration, which
  resolves to a string whether or not the font loaded.
- Landing renders signed-out with no console errors.
- Sign in → board renders → create a task → reload → it persists → delete it.
- **Offline**: `context.setOffline(true)`, reload, board still renders. **This test must assert the
  _source_ of the response**, not merely that something rendered — Playwright's offline emulation
  does not reliably sever service-worker-initiated fetches, so a naive version can pass while the
  page is served from the network. Assert against a marker only the snapshot path produces (the
  `OfflineBanner`, or `savedAt` from the snapshot envelope). If severing cannot be made reliable,
  drop this test rather than keep a vacuous one.

**The no-console-errors assertion must allowlist the Cloudflare Insights host.** `public/_headers`
documents that Cloudflare's injected beacon hash changes without notice and silently re-breaks CSP.
Unscoped, that event turns every PR red for a cause unrelated to any PR.

## 2.5 `e2e/a11y.spec.ts` — required

`@axe-core/playwright` over six scans: landing, login, settings, and the board in each of the three
themes (contrast risk is per-theme).

Violations compare against a committed `e2e/a11y-baseline.json` keyed on `{ruleId, target}`; only
unbaselined pairs fail. Targets are CSS paths, so this is only stable because the board is seeded —
the baseline depends on `seedBoard` staying fixed. The initial scan result is reported to the
maintainer so remediation can be scheduled as separate work.

## 2.6 `e2e/visual.spec.ts` — non-required initially

Ten canaries: landing desktop, landing mobile, board calendar in cork / brutal / glass, board week
(cork), board kanban (cork), settings (cork, covering the Dates section), the task editor modal, and
board mobile.

Baselines are committed under `e2e/visual.spec.ts-snapshots/` and **generated on the Linux CI runner
only** — generating them on Windows bakes in platform font rendering and makes every CI run a diff.

**Refresh mechanism.** A `workflow_dispatch` that commits snapshots using `GITHUB_TOKEN` does not
work: pushes made with that token do not trigger workflows, so every required check on the new SHA
sits at "waiting" and the PR becomes unmergeable. Instead, the refresh job **uploads the new
snapshots as a build artifact** and the maintainer commits them. Slower, but it cannot wedge a PR,
and it keeps a human in the loop on what changed visually.

**Playwright upgrades invalidate every baseline.** A version bump changes the bundled Chromium and
its font rasterization. Because E2E skips on Dependabot PRs, such a bump merges green and breaks the
_next_ human PR — the same dynamic as the changelog-backfill debt, with a costlier recovery. Pin
`@playwright/test` out of Dependabot's reach in `dependabot.yml`, and treat a deliberate bump as
"upgrade and refresh baselines in the same PR".

---

# CI integration and rollout order

Three jobs: `RLS` (required), `E2E Smoke + A11y` (required), `E2E Visual` (not required initially).

**Rollout is two PRs per part, never one.** Making a check required before its workflow exists on
`main` wedges every other open PR, because they have no such check to report — this repo's CI notes
record that lesson verbatim. Sequence:

1. Merge the workflow, not required. Confirm it reports on a real PR.
2. Only then update the branch ruleset (id `18273908`) via `gh api -X PUT`, sending the **full**
   rules array — the legacy branch-protection API 404s here.

The required-check list is documented in several places and must be updated in the same PR that
changes it, or the docs drift apart again.

**Add a tests tsconfig.** `tsc -b` covers only the three existing projects, so `tests/rls/` and
`e2e/` would be the only untypechecked TypeScript in a repo that maintains a dedicated worker
tsconfig for two files.

# Accepted risks

Recorded here **and** in a dated note under `private/`, which `AGENTS.md` establishes as the record
for accepted risks:

- **E2E writes to the production database** as the test account. RLS bounds the blast radius to that
  account; its rows appear in the nightly backup, which is harmless.
- **A production account's credentials live in repository secrets** and need rotating like any other.
  The service-role key does not, and must not.
- **The `E2E` check depends on an external deploy.** If Pages is slow or down, the job times out and
  fails rather than hanging.
- **Concurrent-run queue cancellation** (§2.2) can require a manual re-run.
- **Visual baselines need refreshing** on intentional UI changes, via an artifact the maintainer
  commits.

# Out of scope

- **Broad E2E UI coverage.** The jsdom component tests are fast and good; duplicating them in a
  browser buys little and rots fast.
- **Drag-and-drop gesture tests.** dnd-kit is painful to drive reliably, and `src/dnd/reorder.ts` is
  already well covered as pure logic.
- **Remediating whatever axe finds.** This spec installs the ratchet and reports the findings.
- **A second Supabase project for previews.** Disproportionate setup — `Deploy Migrations` would
  need to target both or the schemas silently drift.

# Documentation to update

`AGENTS.md` (a testing section covering both layers, the hermetic-`npm test` boundary, the grants
rule and its October deadline, and the required-check list), `README.md` (the commands),
`ROADMAP.md`, and `CHANGELOG.md` for each PR's target version.
