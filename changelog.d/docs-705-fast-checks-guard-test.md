### Docs

- **The documented fast checks now run `scripts/guard.test.mjs`, as CI's `Agents` job does.**
  The `node --test` line in `docs/agents/open-pr.md` listed eight of the nine suites the job runs,
  and Vitest excludes the ninth. A branch that changed `scripts/guard.mjs` could therefore pass
  every documented local check and still fail `Agents`. (#705)
- **`AGENTS.md`'s one-test example names the file the test lives in.** The bare
  `npx vitest run -t "<name>"` form loads all 151 test files to run one test, which takes about
  41 seconds instead of one. (#705)
