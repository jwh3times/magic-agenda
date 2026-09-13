# Testing layers and lint policy

The three test layers, what each is allowed to touch, and the lint policy the `Format` job enforces.

`npm test` is the fast unit/component suite: Vitest under jsdom with Supabase mocked, and it is
**hermetic by contract** — it must never need Docker, a database, or a network. `vite.config.ts`
injects dummy `VITE_SUPABASE_*` values to enforce that, pointed at port 1 — privileged, and
nothing listens there — so an unmocked call fails fast with `ECONNREFUSED` rather than reaching
the local stack, which is live whenever `test:rls` is running. Keep `tests/**` excluded from
that project.

DOM matchers are registered in `src/test/setup.ts` with `expect.extend`; their Vitest 5
`Matchers<R, T>` types live in `src/test/domMatchers.d.ts`. Keep these together when upgrading
the test stack: jest-dom 7.0.1's Vitest adapter still augments the older `Assertion<T>` interface,
and global Jest matcher declarations do not supply Vitest 5's types. `domMatchers.test.ts`
checks runtime registration and synchronous/asynchronous return types; run the TypeScript
build as well as Vitest to verify the type assertions.

`npm run test:rls` is a **separate Vitest project** (`vitest.rls.config.ts`) running integration
tests in `tests/rls/` against a real local stack — start one with `npm run test:rls:up`. It is
where the authorization boundary is actually exercised: RLS is the only thing standing between
one user's rows and another's, and every unit test mocks it away. Its tests come in two kinds,
split across two files, and the distinction matters when adding one.

**`test:rls:up` goes through `scripts/rls-up.mjs` rather than calling the CLI directly, and the
reason is `RESEND_API_KEY`.** `config.toml` enables SMTP against `smtp.resend.com` through
`env(RESEND_API_KEY)`, so a local GoTrue started by a shell holding the real key can send real
email from a test stack — and the documented way a maintainer holds production credentials is
`op run` with the production-operations template, which is exactly that shell. The script injects
the same dummy values CI's stack step does, **over** the ambient environment rather than under it:
`{ ...DUMMY_ENV, ...env }` would read as a sensible default and would hand the real key straight
back. The two sets are kept identical by `scripts/rls-up.test.mjs`, which parses the workflow and
compares them, rather than by a note here asking someone to remember (#296).

`structure.test.ts` holds **catch-alls** that need no knowledge of any particular table and hold
forever: RLS enabled everywhere, every RLS-enabled table has a policy, no security-definer views,
every table reachable by the Data API roles, a newly created table reachable by _none_ of them, and
every realtime-published table keyed on uuid only. That last one is the machine-checkable half of
the publication rule in [When changing the schema](../../AGENTS.md#when-changing-the-schema) —
DELETE fan-out caps its payload at the primary key, so the PK is the entire content of a
cross-tenant broadcast, and a `text` PK on a published table (an email, a slug, a board name) is
the realistic version of that mistake. It follows the publication rather than
assuming `public`, and it treats a published table with _no_ PK as a failure too: under replica
identity DEFAULT that table publishes no old record, so deletes stop reaching subscribers and the
client reducer silently diverges.

`baseline.test.ts` holds **baselines** — the security posture as it is _today_, asserted by strict
equality in both directions, so changing it is a deliberate act with a diff attached. Three of
them: every function in `public` with its definer flag / `search_path` / whether it carries its own
ACL / exact non-owner `EXECUTE` grantees, every schema reachable by the Data API roles, and every
policy that applies to `PUBLIC`
because it names no role. The remaining known weakness: `set_updated_at` is still EXECUTE-able by
`PUBLIC` via PostgreSQL's default, tolerable only because it is an invoker trigger function
unreachable outside a trigger context, and the three legacy policies on `user_settings` still
target `PUBLIC` (the four `tasks` policies and the seven Board policies — five from the authorization
cutover plus `boards_delete_owner` and `boards_update_owner` — all name `authenticated` explicitly instead; the `tasks` ones
only since that cutover, which is when this list shrank from seven to three). This paragraph used
to also record `handle_new_user` as `security
definer` with `search_path=public` rather than the empty path a definer should have, and as
EXECUTE-able by `PUBLIC` — that was the
"specific point in the board work" the surrounding prose said it would stop being tolerable at:
`handle_new_user` is hardened now (empty `search_path`, EXECUTE revoked from `PUBLIC`), and the two
lifecycle functions the board work added beside it (`handle_account_deletion` and `create_board`,
both `security definer`) are hardened the same way from birth. `create_board` is `security definer`
in `public` rather than `app_private`, which the baseline's own docstring now spells out as a second
case rather than an exception: a **policy helper** belongs in `app_private`, but a **client-invoked
RPC** cannot live there at all, because `[api] schemas` lists only `public` and `graphql_public` and
PostgREST refuses an unlisted schema with `PGRST106` even for `service_role`. `app_private` is
therefore still unbuilt, and the first co-member predicate remains what introduces it.
Each remaining weakness is tolerable for a specific reason stated in the file; recording them is
what turns "someday" into a line someone has to delete. A baseline that _shrinks_ is a failure too:
that means it is stale and the smaller set must be committed.

Of the catch-alls, the definer-view check asserts over an **empty set** today because `public` holds no views, so the
option-spelling parser it depends on lives in `tests/rls/reloptions.ts` and is tested directly in
`reloptions.test.ts` — the same split that makes `src/sw/policy.ts` testable when `src/sw.ts`
itself cannot be. `policy.test.ts` runs inside `npm test` (the `Test` job) and `reloptions.test.ts`
only under `npm run test:rls` (the `RLS` job); **both jobs are required checks and both run on every
PR**, so `isSecurityInvoker` is genuinely gated. This paragraph previously recorded the opposite —
that `RLS` was neither required nor had ever executed — which was true when written and is no longer:
verified 2026-07-29 against the ruleset and six consecutive successful `RLS` job runs. The CLI is pinned as an exact
`supabase` devDependency rather than through `supabase/setup-cli`, because every call goes
through `npx`, which ignores a PATH binary in favour of a local one and otherwise installs
`latest`.

`npm run test:e2e` is a **third layer**: Playwright (Chromium only) against a **real deployed
build**, not a local server. That is the whole point — `public/_headers` is Cloudflare-specific,
and the v1.2.37 CSP bug could not be reproduced locally. In CI it runs against the PR's Cloudflare
Pages preview; locally, point `E2E_BASE_URL` at a preview URL or production.

**Finding the preview is not obvious and the obvious way does not work.** This repo has no GitHub
Deployments — Cloudflare reports as a check run named `Cloudflare Pages` whose `details_url` points
at the dashboard, and no GitHub API exposes the preview URL. `scripts/preview-url.mjs` polls that
check run and derives `https://<first 8 of the deployment UUID>.magic-agenda.pages.dev`. Both the
link shape and the URL convention are undocumented, so the pure derivation is unit-tested in
`scripts/preview-url.test.mjs` and fails loudly rather than guessing. The fallback, if Cloudflare
changes either, is their deployments API with an API token.

**Playwright traces are GPG-encrypted before upload, and that is not optional.** A trace records the
Supabase request headers verbatim, including `authorization: Bearer <JWT>` in full for the E2E
account — and this repository is public, so anything a job uploads is downloadable by anyone. It is
the same constraint that makes `backup.yml` encrypt its dump, and the fix is deliberately the same
shape (`--symmetric --cipher-algo AES256`, a no-op check, a round-trip check). If
`E2E_TRACE_GPG_PASSPHRASE` is absent the traces are **discarded, not uploaded** — losing a debug
artifact beats leaking a credential, and gpg would otherwise cheerfully "encrypt" with an empty
passphrase. `globalSetup` is outside Playwright's per-test trace setting, so it starts context
tracing itself and writes a screenshot plus trace under `test-results/global-setup/` on failure;
that location is what routes setup failures through the same encryption step. Do not replace this
with a plain upload of `test-results/`. The general rule: **treat every artifact this repo uploads as
public**, and check what a new one actually contains before adding it.

E2E drives **one dedicated account in the production project**, so runs are serialised twice:
`workers: 1` within a run, and a `concurrency` group across PRs — scoped to `pull_request` events, so
a push to `main` (where the job only gate-skips) cannot occupy the group's single pending slot and
evict a queued PR. Seeding uses the anon key and that account's own credentials — **the service-role
key must never enter CI.** All three skip conditions (non-PR events, fork PRs, runs without secrets)
report success from inside a step, never a job-level `if:`.

**`tests/e2e/fixtures/` must match PRODUCTION's schema, which is one release behind its own
branch.** E2E runs against the _production_ database, but `Deploy Migrations` only applies
migrations on merge to `main` — so a PR carrying a schema change exercises its new client against
the **old** schema, and the next PR is the first to meet the new one. The fixtures are also the one
Supabase client in this repo that no unit or RLS test covers.

Both halves of that have now bitten once each, in opposite directions, and the pair is the useful
lesson:

- **Too late.** Dropping `tasks_infer_board_id` made `seedBoard` a pre-cutover client — it sent no
  `board_id` — but `v1.6.0`'s own E2E passed green, because production still had the trigger while
  it ran. The failure landed on the _following_ PR, which had not touched a line of it.
- **Too early.** Removing `user_id` from that same fixture in the very PR that relaxed it to
  nullable failed _immediately_: production still had `NOT NULL` when E2E ran, so the seed died on
  `null value in column "user_id" ... violates not-null constraint`.

The rule that follows: **a column being retired stays in the fixture for the release that makes it
optional, and comes out in the release that drops it** — one step later than feels natural. A column
with a default needs no such care, since omitting it is valid on both sides.

Five non-obvious constraints on the specs themselves. Four cost a real debugging pass; the fifth
is a deliberate tradeoff worth understanding before it costs one:

- **Seed data is dated relative to today.** `Board` anchors on today and `CalendarView` renders a
  fixed 42-cell grid around that month, so an absolutely-dated row is in the database and on no
  screen. The a11y baseline no longer keys on CSS target paths, but `page.clock` is still pinned
  and the seed anchor pinned to match — for a different reason: `nested-interactive` is counted one
  per rendered card, so an unpinned clock could place a seeded task on a day the fixed 42-cell grid
  doesn't carry that month, silently dropping it from the count. (`color-contrast` no longer needs
  this: it reached zero across every cell state — including brutal's out-of-month day numbers — in
  the pass recorded in `src/theme/themeConf.ts`.) The two must move together, because the clock
  moves only the browser while `seedBoard` runs in the test process in real time.
- **`document.fonts.check()` cannot detect the CSP regression.** It returns true for a family with no
  `FontFace` registered at all, which is exactly the broken state. The font assertion iterates
  `document.fonts` instead. (There is also no font named `Inter` in this app.)
- **`context.setOffline(true)` + `page.reload()` does not work here, and is not a bug in the app.**
  CDP offline emulation fails the top-level navigation with `net::ERR_FAILED` before the service
  worker is consulted, even though the worker is alive and `/index.html` is precached — measured
  both ways. The offline test therefore aborts only Supabase, which is the actual condition
  `useTasks` guards. No browser-level test here covers the worker serving the shell offline;
  `src/sw/policy.test.ts` covers that policy.
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

### Visual regression canaries

`tests/e2e/visual.spec.ts` (#280) screenshots thirteen surfaces: landing on desktop and mobile, the calendar in each of the three themes, week and kanban in `cork`, the task editor, settings, the mobile calendar, and (#359) a keyboard-focused card in each theme. The visual layer is an inline-style-object model with per-theme branching, so there
is no stylesheet to review and no CSS tooling that applies — these screenshots are the only
mechanical check that a token change did not wreck a theme. Six things about them are
load-bearing:

- **They are not a merge gate yet, and they do not get a job of their own.** `playwright.config.ts`
  splits the suite into two projects over the same browser: `chromium` (smoke + a11y) and `visual`.
  The `E2E` job runs `chromium` as the gated step and `visual` as a following `continue-on-error`
  step, so a changed or missing baseline shows as a warning annotation, a job summary, and an
  artifact while the check stays green. A separate job was rejected because every E2E run drives
  the same production account: it would join the `e2e-prod-account` concurrency group, and since
  GitHub keeps one pending run per group, a PR's second queued job could evict another PR's
  required E2E run. The `visual` project writes to `test-results-visual/`, not `test-results/`,
  because Playwright clears `outputDir` at the start of every invocation and the second step would
  otherwise wipe the gated run's traces.
- **Baselines are generated on the Linux CI runner only.** A baseline rendered on Windows or macOS
  bakes in that platform's font rasterization and turns every CI run into a diff.
  `snapshotPathTemplate` puts the platform in the filename (`tests/e2e/__screenshots__/<name>-linux.png`),
  so a local run on another OS reports a missing baseline rather than a false mismatch.
- **A missing baseline behaves differently locally and in CI, on purpose.** The config sets
  `updateSnapshots: 'none'`, so a local run never writes a baseline silently. But under `'none'`
  Playwright writes **nothing** for a missing baseline — no `-actual.png` — which #280's first CI
  run measured: ten failures and not one usable image, only generic `test-failed-1.png` captures
  that are neither full-page nor taken with the screenshot options, and so are not baselines. CI
  therefore passes `--update-snapshots=missing`. Under it the canary **still fails** ("writing
  actual"), and Playwright writes the new baseline at its real path **plus an identical
  `-actual.png`** — measured on the second run. A committed baseline is never overwritten, so a
  changed one still fails and yields `-actual.png` beside `-expected.png` and `-diff.png`. The
  collect step classifies both: an untracked file under `tests/e2e/__screenshots__/` is a new
  baseline, and an `-actual.png` counts as a change only when no baseline of that name was just
  written, so a new canary is not reported twice.
- **Only PNGs leave the runner.** `test-results-visual/` also holds a trace zip for every failed
  canary, and a trace stores the Supabase `authorization: Bearer <JWT>` header verbatim — the reason
  the gated run's traces are GPG-encrypted. The collect step copies PNGs alone into the uploaded
  `visual-diffs-*` artifact. No surface renders the account email and the seeded board is fixture
  text, but the artifact and the committed baselines are public, so inspect every image.
- **Determinism is shared with the a11y scans, not duplicated.** `tests/e2e/fixtures/determinism.ts`
  holds `FREEZE_ANIMATION`, `settle()`, and the pinned clock day. Both specs assert something that
  moves when a page is not settled, so a second copy of those rules is how the two would drift into
  measuring different pages. Settings is the one surface with several independently loading
  sections; its canary waits for every `Loading…` placeholder to disappear and for History's empty
  state before it screenshots.
- **Anything the board derives from a task's id must be fixed in the seed, and the tolerance
  must be absolute.** Card tilt is `rotOf(task.id)` in cork and brutal, and ties in a lane are read
  in id order, so a seed that let the database mint fresh UUIDs gave every run a different board.
  `seedBoard` therefore inserts `SEEDED_IDS`. That was found the hard way: the kanban canary matched
  on one run and differed by 14,936 pixels on the next. The other cork/brutal canaries drifted too
  and passed only because the first cut's `maxDiffPixelRatio: 0.01` (≈9,200 px on a 1280×720 page)
  forgave a small card rotating — which means it would have forgiven a real regression of the same
  size. The cap is now `maxDiffPixels: 50`, with Playwright's per-pixel `threshold` still absorbing
  colour noise. **One matching run proves nothing about stability**; a new or reseeded canary needs
  two consecutive matching runs before it is trusted.
- **`@playwright/test` is pinned to an exact version and ignored by Dependabot.** A Playwright bump
  changes the bundled Chromium, which invalidates every baseline — and the `E2E` job cannot run on a
  Dependabot PR, so such a bump would merge green and break the next human PR. Upgrade it by hand,
  and refresh the baselines in the same PR.

#### Refreshing the visual baselines

The CI run produces the candidate images, so no separate workflow is needed. (A `workflow_dispatch`
that commits them with `GITHUB_TOKEN` was the original design and does not work: pushes made with
that token trigger no workflows, so every required check on the new commit would sit waiting.)

1. Push the change and let the PR's `E2E` job run. When anything is new or changed, the job
   summary lists it and a `visual-diffs-<run-id>-<attempt>` artifact is uploaded.
2. Download it: `gh run download <run-id> -n visual-diffs-<run-id>-<attempt> -D visual-diff`. The
   artifact mirrors repository paths.
3. **Open every image and confirm it shows the intended surface and nothing sensitive.** This is the
   human-in-the-loop step the design keeps on purpose.
4. Accept them:
   - a **new** baseline is already at `visual-diff/tests/e2e/__screenshots__/<name>-linux.png` —
     copy it to the same path in the repository;
   - a **changed** one is `visual-diff/test-results-visual/**/<name>-actual.png` — copy it to
     `tests/e2e/__screenshots__/<name>-linux.png`, after comparing it with its `-expected.png` and
     `-diff.png`.

   Ignore any `test-failed-*.png`: those are Playwright's generic failure captures, not baselines.

5. Commit and push. The next `E2E` run's summary should report every canary matching.

**Data API grants are explicit, per table, full stop** (`20260729100000_explicit_data_api_grants.sql`)
and must stay that way. `config.toml` sets `auto_expose_new_tables = false` explicitly, so new
tables, views, sequences, and functions never inherit Data API grants merely because a CLI or cloud
default changed. A migration that adds a table must grant it explicitly right there; the fourth
structural test (`tests/rls/structure.test.ts`, "every table in public is reachable by the Data API
roles") is the backstop that catches one that doesn't. The function baseline separately pins every
non-owner `EXECUTE` grantee, because merely checking for an explicit ACL cannot distinguish a
reviewed grant from an inherited `anon` or `service_role` grant. Note `anon` is granted deliberately:
RLS, not the grant, is what denies it, and `useSettings` depends on an unauthenticated select
returning zero rows rather than an error.

That fail-closed premise was **not** true until `20260729190000`. `pg_default_acl` in `public`
granted `anon` and `authenticated` full DML on every future table, inherited from the legacy
auto-expose era, so any table shipped without `enable row level security` would have been
world-readable and writable through the public anon key. That migration revokes them for the
`postgres` role, which is what both migrations and the Studio table editor (pg-meta connects as
`postgres`) create through. **`authenticated` is revoked for the same reason as `anon`, not as
belt-and-braces**: signup is open, so `authenticated` is `anon` plus one free registration.
`service_role` is deliberately left alone — the Edge Functions hold the service key precisely to
cross this boundary.

**This paragraph used to call that a production-only problem, "invisible to CI, which always
builds a fresh database whose defaults are already restrictive". That was wrong** (#283, measured
2026-09-10). A freshly reset local stack carries the same permissive defaults, and the evidence is
inside the baseline: `anon`'s entry for `postgres`-created tables is exactly
`MAINTAIN,REFERENCES,TRIGGER,TRUNCATE`, the full set minus precisely the four privileges that
migration revokes — and a `pg_default_acl` entry exists only because something altered it. So the
migration is load-bearing in CI too, and the fifth structural test ("a newly created table is NOT
reachable by the Data API roles by default") passes **because of it**, not because a fresh database
is benign. The same mistaken claim still appears in that migration's own comment; it is left there
because an applied migration is a record of what ran, not a place to correct after the fact.

**One residual gap, by necessity:** `supabase_admin` carries the same permissive defaults and
`postgres` is neither superuser nor a member of that role, so the migration's second statement
raises `insufficient_privilege` and is skipped with a notice. Objects the Supabase platform itself
creates in `public` as `supabase_admin` are still auto-granted — and it is wider than tables:
sequences and functions are permissive too, so a platform-created function in `public` is
`EXECUTE`-able by `anon` by default. Nothing this repository can run will change that; the refusal
is structural rather than environmental.

**It is now watched, which is the part that changed.** `baseline.test.ts` pins the whole
`pg_default_acl` picture for `public` by strict equality, and separately asserts that the
`supabase_admin` alter still fails with `42501`. The first fails the day Supabase tightens or
loosens anything; the second fails the day `postgres` gains the membership that would make #283
closable. The fifth structural test still connects as `postgres` and still cannot create a table as
`supabase_admin` — that has not changed, and is why the baseline reads the ACL directly instead.

One residual is wider than #283's own summary and worth knowing before adding a sequence:
**`postgres`-created sequences still grant `UPDATE` to `anon`**, which is enough for `nextval()`.
The migration revoked table DML only. Inert today — `public` holds no sequences, every key being a
uuid — but a default ACL is a template, so it applies to the first one anybody adds.

## Lint policy

`.oxlintrc.json` owns the entire lint policy. `options.typeAware` delegates semantic rules to
`oxlint-tsgolint`, whose compiler engine is TypeScript 7, while Oxlint's category-specific
`react/*` rules cover the React Compiler diagnostics. `react/invariant` and `react/todo` stay off:
they report compiler bugs and skipped optimizations rather than app violations, and the removed
`react/react-compiler` rule filtered both by default. `react/hooks` also stays off because
`react/rules-of-hooks` already owns that check. `react/config` and `react/gating` are not enabled
because the Oxlint binary does not register them: 1.79's schema advertised both while its binary
rejected them, and 1.82 (checked 2026-09-12, #349) neither lists them in its schema nor registers
them. **Revisit them when the binary registers them, not on every Oxlint upgrade** — a
version-pinned trigger refires on each Dependabot bump whether or not anything changed, which is
how the earlier wording went stale unnoticed. To check, enable one in a scratch config and run
`npx oxlint -c <config> <file>`: an unregistered rule fails with
`Rule 'config' not found in plugin 'react'`, exactly like a misspelled one.
`options.reportUnusedDisableDirectives` makes stale inline suppressions errors, so every exception
remains tied to a diagnostic it actually covers. A small explicit React correctness set covers
invalid keys, props, and DOM children, while a test-file-only Vitest override rejects focused or
structurally invalid tests. Generated Supabase types and Deno Edge Functions stay outside the Node
lint project.
