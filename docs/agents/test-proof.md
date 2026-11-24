# Test proof

Settings the shared `test-prover` skill reads (installed from `jwh3times/skills`): how it runs one
test on its own, and how it tells a run that tested nothing from a pass. Each `##` heading is one
setting. The test layers themselves are in [Testing layers and lint policy](testing.md).

## Test commands

- repo root, the hermetic unit suite (`npm test`): `src/**/*.test.{ts,tsx}` and the Vitest files
  in `scripts/` (`scripts/*.test.ts`, and each `scripts/*.test.mjs` that imports `vitest`). One
  file: `npx vitest run <file>`; one test: `npx vitest run <file> -t "<name>"`. Worktree: link
  `node_modules`.
- repo root, the canonical scripts' tests that `vite.config.ts` excludes and CI's `Agents` job runs
  (`scripts/sync-agents.test.mjs`, `lint-agent-neutrality`, `sync-main`, `next-version`,
  `check-changelog`, `stamp-changelog`, `check-docs`, `check-skills`, `guard`): node's runner. One
  file: `node --test <file>`; one test: `node --test --test-name-pattern="<name>" <file>`.
  Worktree: link `node_modules`.
- `supabase/functions/`, the Edge Function tests (`Functions`): `*/*.test.ts`. One file:
  `deno test <file>`, with `<file>` relative to `supabase/functions/`; one test:
  `deno test <file> --filter "<name>"`. Count: Deno's closing `ok | N passed | N failed` line,
  which `mutate.mjs` reads already. Worktree: link `supabase/functions/node_modules`.
- `tests/rls/` (`npm run test:rls`, `vitest.rls.config.ts`) is not run here: it needs the local
  Supabase stack (`npm run test:rls:up`, Docker) and writes to its database.
- `tests/e2e/` (`npm run test:e2e`, `npm run test:e2e:preview`) is not run here: it needs the
  isolated local stack, a production build and an installed browser, or a deployed Pages preview.
