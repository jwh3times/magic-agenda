### Internal

- **The shared scripts' `node:test` suites are listed in one place, `scripts/node-test-suites.ts`,
  and run with `npm run test:scripts`.** The list used to be kept by hand in four places: CI's
  `Agents` job, the documented fast checks, Vitest's exclude list and `docs/agents/test-proof.md`.
  Nothing checked that they agreed (#705 was one drifting). `Agents` and the fast checks now call
  the script, and `vite.config.ts` excludes the same list, so a new suite left off it fails
  `npm test` with "No test suite found in file" instead of going unrun. (#714)
