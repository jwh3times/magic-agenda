# Open PR

Settings the shared `open-pr` skill reads (installed from `jwh3times/skills`). Each `##` heading is one
setting.

## Fast checks

All from the repository root, in order; together they cover the required `Format`, `Agents` and
`Test` checks, and `tsc -b` is the typecheck half of `Build`.

- `npm run format:check`, fixed by `npm run format`
- `npm run lint`
- `npx tsc -b`
- `npm run sync:agents:check`, fixed by `npm run format` then `npm run sync:agents`, committing
  everything it rewrites (the generated trees, `AGENTS.md`'s shared blocks, `.claude/settings.json`)
- `npm run check:claude-md`
- `npm run lint:agents`
- `node scripts/check-docs.mjs`
- `node scripts/check-skills.mjs`
- only when `scripts/` changed:
  `npm run test:scripts` (the canonical scripts' `node:test` suites, as the `Agents` job runs them)
- only when `src/`, `tests/`, `scripts/`, `vite.config.ts` or `package.json` changed: `npm test`
  (the required `Test` check; about 16 seconds locally)

`Build` (vite), `Functions` (Deno), `RLS`, `E2E`, `Config` and CodeQL run in CI only.
