### Internal

- **`AGENTS.md` and `docs/agents/tooling.md` send a change's release notes to its changelog
  fragment.** Both said to keep `CHANGELOG.md` aligned with `AGENTS.md` and `README.md`, a rule
  left over from before `stamp-on-tag`. They now say the notes go in the branch's
  `changelog.d/<branch-slug>.md` fragment, which `open-pr` writes, never in `CHANGELOG.md`, and
  link to `docs/agents/releases.md`. (#681)
