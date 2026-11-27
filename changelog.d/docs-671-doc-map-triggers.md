### Internal

- **The Doc map puts more documents in scope when the files they depend on change.** Five triggers
  in `docs/agents/docs.md` missed changes that make their document wrong. They now name:
  - for `local-runs.md`: `.prettierignore`, the `format` globs, `supabase/functions/deno.json` and
    `scripts/rls-up.mjs`;
  - for `merging.md`: the Playwright browser channel and the `main` ruleset's merge rules;
  - for `CONTRIBUTING.md`: the commands inside a required check's job;
  - for `SECURITY.md`: branch protection and the ruleset's bypass actors.

  `changelog.d/README.md` gets its own living entry, no longer skipped as a fragment. (#671)

- **`changelog.d/README.md` states the fragment rules the `Changelog` check enforces.** Only `###`
  headings, nothing before the first heading, and no heading without entries. (#671)
