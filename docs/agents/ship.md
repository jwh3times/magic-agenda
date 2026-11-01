# Ship

Settings the shared `ship` skill reads (installed from `jwh3times/skills`). Each `##` heading is one
setting.

## Fast checks

All from the repository root, in order; together they cover the required `Format`, `Agents` and
`Test` checks, and `tsc -b` is the typecheck half of `Build`.

- `npm run format:check`, fixed by `npm run format`
- `npm run lint`
- `npx tsc -b`
- `npm run sync:agents:check`, fixed by `npm run format` then `npm run sync:agents`, committing the
  regenerated mirrors
- `npm run check:claude-md`
- `npm run lint:agents`
- `node scripts/check-docs.mjs`
- `node scripts/check-skills.mjs`
- only when `scripts/` changed:
  `node --test scripts/sync-agents.test.mjs scripts/lint-agent-neutrality.test.mjs scripts/sync-main.test.mjs scripts/next-version.test.mjs scripts/check-changelog.test.mjs scripts/check-docs.test.mjs scripts/check-skills.test.mjs`
- only when `src/`, `tests/`, `scripts/`, `vite.config.ts` or `package.json` changed: `npm test`
  (the required `Test` check; about 16 seconds locally)

`Build` (vite), `Functions` (Deno), `RLS`, `E2E`, `Config` and CodeQL run in CI only.
