# Dependabot

Settings the shared `dependabot` skill reads (installed from `jwh3times/skills`), in a session and
in the scheduled review. Each `##` heading is one setting. These facts apply to this repository
only.

## Stack

- A React 19 and TypeScript SPA built with Vite 8 (`vite.config.ts`, with `vite-plugin-pwa` and a
  service worker in `src/sw.ts`), on Supabase for Postgres, Auth and Edge Functions. Cloudflare
  Pages builds and deploys `main` and a preview for every PR, Dependabot's included (README
  "Deployment"). Routing is `react-router` 8 (`src/App.tsx`); drag-and-drop is `@dnd-kit/core`,
  `@dnd-kit/sortable` and `@dnd-kit/utilities`.
- Lint is Oxlint with `oxlint-tsgolint` for the type-aware rules (`.oxlintrc.json`,
  `npm run lint`); formatting is Prettier (`npm run format:check`); TypeScript is 7
  (`tsconfig.*.json`).
- Unit tests are Vitest under jsdom (`npm test`); the RLS suite runs Vitest against a local Supabase
  stack (`vitest.rls.config.ts`); E2E is Playwright (`playwright.config.ts`,
  `playwright.preview.config.ts`, `tests/e2e/`) with `@axe-core/playwright` scans and visual
  baselines. The Edge Functions in `supabase/functions` are Deno.
- `.github/workflows/ci.yml` jobs: `Format` (`npm run format:check`, `npm run lint`), `Test`
  (`npm test`), `Build` (`npm run build`, which is `tsc -b && vite build`), `Functions`
  (`deno fmt --check`, `deno check */index.ts`, `deno test`), `Agents`, `Changelog`, `Config`,
  `RLS` and `E2E`.
- `.github/dependabot.yml` updates `npm` at `/` and `github-actions` at `/`, daily. The npm groups:
  `react` (majors of `react`, `react-dom`, `@types/react`, `@types/react-dom`), `dnd-kit` (majors
  of `@dnd-kit/*`), `testing-library` (majors of `@testing-library/*`), `lint-and-typescript`
  (majors of `oxlint`, `oxlint-tsgolint`, `typescript`), `vite-ecosystem` (majors of `vite`,
  `vitest`, `@vitejs/plugin-react`, `@vitest/*`), `e2e-toolchain` (every update of
  `@axe-core/playwright`) and `npm-minor-and-patch`; for actions, `actions-minor-and-patch`. Every
  other major arrives as its own PR. `@playwright/test` is ignored (#280).

## Review triggers

- `supabase` (the CLI devDependency), any bump: the five `supabase/setup-cli` steps (the `Config`
  job in `ci.yml`, `deploy-migrations.yml`, `deploy-functions.yml`, `deploy-auth-config.yml`,
  `backup.yml`) install the version `package.json` pins, so the bump changes the CLI that deploys
  and backs up production, which no PR check runs. A minor has changed what reaches production
  before: CLI 3.1.0 began comparing `auth.email.require_current_password` in `config diff`
  (`docs/agents/supabase-config.md`).

## Resolution

At the repository root: Node from `.nvmrc` (26; `engines` requires `>=26.0.0`, and `.npmrc` sets
`engine-strict=true`), then `npm ci`. For `npm run build`, set the placeholder values the `Build`
job sets in `ci.yml` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`),
never real keys.

## Where to look

- `src/App.tsx` (the router), `src/dnd/` (`reorder.ts`, `resolveDrop.ts`, `useBoardDnd.ts`,
  `SortableCard.tsx`, `DropLane.tsx`), `src/lib/supabase.ts`, and the other `@supabase/supabase-js`
  users under `src/data/`, `src/auth/`, `src/access/` and `src/labels/`.
- `vite.config.ts` (the Vite, PWA and Vitest config), `vitest.rls.config.ts`, the Playwright
  configs, `.oxlintrc.json`, `.prettierrc.json`, and `tsconfig.app.json`, `tsconfig.node.json`,
  `tsconfig.test.json`, `tsconfig.worker.json`.
- The tests that assert exact library output: `src/**/*.test.tsx` (jsdom's CSS serialization),
  `tests/e2e/a11y-baseline.json` (axe's violation counts) and `tests/e2e/__screenshots__/`.
- `scripts/workflow-pins.test.ts`, which `npm test` runs: every `uses:` must be a full commit SHA,
  and every `setup-cli` step must take its version from the exact `supabase` pin.
- The `with:` inputs and `run:` commands in every file under `.github/workflows/`.

## Grounding facts

- There is no server of this repository's own beyond the Supabase Edge Functions, no Docker, and no
  Postgres image or data volume: the database is hosted Supabase, changed by the SQL under
  `supabase/migrations` that `deploy-migrations.yml` pushes. The "a newer Postgres major refuses an
  old data directory" hazard does not apply. `@supabase/supabase-js` is the client library: a major
  there is an API concern in the files above, not a database migration.
- The Edge Functions pin their own `@supabase/supabase-js` and `web-push` in
  `supabase/functions/deno.json`, which Dependabot does not update. An npm bump of
  `@supabase/supabase-js` reaches the app only.
- The `Config` job exits early on a Dependabot PR (no secrets), and the deploy workflows run only
  after a merge to `main` that touches their paths (`supabase/migrations/**`,
  `supabase/functions/**`, `supabase/config.toml` and `supabase/templates/**`); `backup.yml` runs
  nightly. So a green Dependabot PR says nothing about the deploys or the backup
  (`docs/agents/merging.md`, "Dependency pull requests").
- The `E2E` job does run on Dependabot PRs (local Supabase stack, no secrets), except that its
  failure traces are not uploaded: `E2E_TRACE_GPG_PASSPHRASE` is withheld from the `dependabot`
  actor. Reproduce an E2E failure locally (`docs/agents/testing.md`).
- `@playwright/test` is pinned exactly and ignored by Dependabot (#280): a Playwright bump changes
  the bundled Chromium and every visual baseline, so it is upgraded by hand with the baselines.
- `@vitejs/plugin-react` 6 hard-peers `vite` `^8.0.0`, and Vitest tracks the Vite majors it
  supports, hence the `vite-ecosystem` group. `vite-plugin-pwa` 2.0.0, outside that group,
  hard-peers `vite` on majors 3 to 8 only (its `peerDependencies` in `package-lock.json`), so a
  Vite 9 group needs a `vite-plugin-pwa` release that accepts it.
- The `@dnd-kit/*` 0.5 packages in `devDependencies` (`@dnd-kit/react`, `dom`, `helpers`,
  `collision`, pinned exactly) belong only to the prototype under `src/dnd/dndKitNext.*`;
  production uses `@dnd-kit/core` and `@dnd-kit/sortable` (`docs/agents/drag-and-drop.md`).
- `@dnd-kit/sortable` 10 hard-peers `@dnd-kit/core` `^6.3.0`, hence the `dnd-kit` group.

## Playbook

- `oxlint` or `oxlint-tsgolint`, any bump: new or sharper rules turn `Format` red at
  `npm run lint` while `format:check` passes. Gate: `npm ci && npm run lint`, then
  `npm run build` and `npm test`. Known fixes: `oxlint-tsgolint` 7.0.2007's
  `no-unnecessary-type-assertion` flags `screen.getByTestId('x') as HTMLInputElement`; write
  `screen.getByTestId<HTMLInputElement>('x')` (PR #668, its review comment and the commit pushed
  to it). `oxlint` 1.91's `react/immutability` rejected effect- and callback-local `let`s that a
  closure reassigns; the sites were fixed on `main` (#655) and the bump then rebased (PR #652).
  The rules' current guidance is in `docs/agents/testing.md`.
- `jsdom` major: computed-style serialization can change. jsdom 31 serializes
  `minmax(0, 1fr)` as `minmax(0px, 1fr)`, which failed two assertions in
  `src/pages/AdminPage.test.tsx`; the fix was to expect the new serialization (PR #653, its review
  comment and the commit pushed to it). Gate: `npm test`.
- `@axe-core/playwright` (the `e2e-toolchain` group): a new axe rule fails `E2E` on the bump,
  because `tests/e2e/a11y-baseline.json` asserts strict equality, falling counts included.
  axe-core 4.14's `label-content-name-mismatch` did on PR #546, which took a human commit
  accepting it. Treat a new violation as real: fix it app-side in its own PR to `main`, then have
  Dependabot recreate the bump (`docs/agents/merging.md`).
- `supabase` CLI, any bump, and above all a major: read the release notes against every command
  the workflows run (`supabase link`, `db push --remote --yes`,
  `functions deploy --remote=<ref> --yes`, `config push --yes`, `db dump --remote`, and
  `npx supabase start -x` in `RLS` and `E2E`) and against `supabase/config.toml`. The 3.0.0
  bump (PR #639) was green and would have broken `Deploy Migrations` and `Deploy Functions` and
  pointed the backup at the local stack (its review comment); it was superseded by #646, which
  took the CLI together with the workflow changes. Carry a CLI major on a branch of your own that
  also touches `supabase/config.toml`, so its `Config` check shows what the new CLI would push
  (`docs/agents/supabase-config.md`).
- `vite-ecosystem` group major: read the Vite, Vitest and plugin-react notes for each major
  crossed; check `vite.config.ts` and `vitest.rls.config.ts` and the `vite-plugin-pwa` peer above;
  run `npm ci`, `npm run build` and `npm test`.
- `react` group or `react-router` major: read the upgrade notes; check `src/App.tsx` and the
  hard peers on `react` (`@testing-library/react`, `@dnd-kit/sortable`) in `package-lock.json`;
  run `npm ci`, `npm run build` and `npm test`.
- `lint-and-typescript` group major: the three move together; check `.oxlintrc.json` and each
  `tsconfig.*.json`; run `npm run lint` and `npm run build` (`tsc -b`).
- `dnd-kit` group major: read the release notes; check `src/dnd/`; run `npm test` (the reorder,
  resolve-drop and `useBoardDnd` tests) and `npm run build`.
- `@supabase/supabase-js` major: read the migration guide; check the files under `Where to look`;
  run `npm run build` and `npm test`. The RLS and E2E jobs exercise it against a real local stack.
- GitHub Actions major (`actions/checkout`, `actions/setup-node`, `actions/upload-artifact`,
  `actions/create-github-app-token`, `denoland/setup-deno`, `supabase/setup-cli`): every `uses:` is
  a full SHA with a version comment, which Dependabot updates together. NEEDS EFFORT only if a
  removed or renamed input or a changed default reaches a `with:` use (`setup-node`'s
  `node-version-file: .nvmrc` and `cache: npm`; `checkout`'s `fetch-depth: 0`, `ref`, `token`;
  `setup-deno`'s `deno-version: v2.x`; `setup-cli`'s `version`; `create-github-app-token`'s
  `client-id`, `private-key`, `permission-contents`; `upload-artifact`'s `name`, `path`,
  `retention-days`, `if-no-files-found`). Name the step.
