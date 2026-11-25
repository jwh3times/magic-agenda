// The canonical scripts' own test suites, installed verbatim from jwh3times/skills. They use
// node:test, not Vitest, so this is the one list of them:
// - `npm run test:scripts` runs this file, which runs exactly these suites with node's test
//   runner (CI's `Agents` job and the open-pr fast checks both call it);
// - `vite.config.ts` excludes the same list from `npm test`.
// A node:test suite missing here is therefore picked up by Vitest, which fails it with
// "No test suite found in file" -- so a new canonical suite can't be left out silently.
//
// Run directly by Node, which strips the types: keep this file free of non-erasable syntax and of
// imports other than node: builtins (CI's `Agents` job runs it without `npm ci`).
import { spawnSync } from 'node:child_process'

export const nodeTestSuites = [
  'scripts/sync-agents.test.mjs',
  'scripts/lint-agent-neutrality.test.mjs',
  'scripts/sync-main.test.mjs',
  'scripts/next-version.test.mjs',
  'scripts/check-changelog.test.mjs',
  'scripts/stamp-changelog.test.mjs',
  'scripts/check-docs.test.mjs',
  'scripts/check-skills.test.mjs',
  'scripts/guard.test.mjs',
]

if (import.meta.main) {
  const run = spawnSync(process.execPath, ['--test', ...nodeTestSuites], { stdio: 'inherit' })
  process.exit(run.status ?? 1)
}
