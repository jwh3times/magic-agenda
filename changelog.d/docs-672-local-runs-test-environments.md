### Internal

- **`docs/agents/local-runs.md` says which runner and environment each script test uses.** It
  said `npm test` runs `scripts/` under the node environment. Vitest's configured default is jsdom,
  and a script test runs under node only when its first line opts in. The canonical scripts'
  `node:test` suites don't run in `npm test` at all: `npm run test:scripts` runs them, from
  `scripts/node-test-suites.ts`. The guide now also warns against globbing them with
  `node --test`, and says the environment header is for a Vitest test that builds a path from
  `import.meta.url`. (#672)
