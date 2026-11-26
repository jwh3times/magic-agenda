### Docs

- **`CONTRIBUTING.md`'s local checklist now runs everything the `Functions` and `Agents` checks
  run.** It gave only `deno test` for `Functions`, which also runs `deno fmt --check` and
  `deno check */index.ts`, and presented `npm run sync:agents:check` as the whole of `Agents`, which
  runs six steps. A contributor could pass every listed command and still fail either required
  check. The Functions commands now run in a subshell, so a pasted block no longer stays inside
  `supabase/functions` for the lines after it. (#670)
- **The other descriptions of those checks are complete, or say they're partial.**
  `docs/agents/tooling.md`'s account of the `Agents` job names its last step, `check-docs.mjs`;
  `README.md`'s `test:scripts` row and the Agent configuration note in `CONTRIBUTING.md` no longer
  read as the whole check; and the `vite.config.ts` comment gives the in-directory
  `cd supabase/functions && deno test` form. (#670)
