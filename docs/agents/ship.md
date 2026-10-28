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
- only when `scripts/` changed:
  `node --test scripts/sync-agents.test.mjs scripts/lint-agent-neutrality.test.mjs`
- only when `src/`, `tests/`, `scripts/`, `vite.config.ts` or `package.json` changed: `npm test`
  (the required `Test` check; about 16 seconds locally)

`Build` (vite), `Functions` (Deno), `RLS`, `E2E`, `Config` and CodeQL run in CI only.

## Issue link

- **Branch pattern:** `<type>/<issue#>-<slug>`, `<type>` one of `feat`, `fix`, `docs`, `test`,
  `chore`. Exempt work drops the number (`docs/dev-flow`). Never `release/*`: a ruleset rejects it;
  a version cut is `chore/release-vX.Y.Z`.
- **Link line:** `Closes #<n>` when the PR finishes the issue; `Part of #<n>` for one slice of a
  spec that stays open. One line per issue.
- **Waiver line:** `Flow waived by the user: <reason>`.
- **Exempt:**
  - dependency bumps (Dependabot, `chore(deps)`, `chore(dev-deps)`, `chore(ci)`)
  - changes touching only docs and agent config
  - release prep (the changelog commit, a backfill, a major/minor line bump)
- **Defined in:** `docs/agents/dev-flow.md`.
