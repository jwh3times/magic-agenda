### Internal

- **The docs say a branch's entries never go in `CHANGELOG.md`, rather than that a branch never
  edits it.** `AGENTS.md`, `docs/agents/releases.md`, `CONTRIBUTING.md`, `changelog.d/README.md`
  and the policy text at the top of `CHANGELOG.md` said a branch never edits the file, though the
  `Changelog` check accepts emptying `Unreleased`, a change to prose such as the policy text, and a
  backfill section for a version already tagged with none. `releases.md` now names those edits,
  and the Doc map points at it. `docs/agents/merging.md` said a `CHANGELOG.md` conflict means the
  branch edited the file; it now says the branch most likely added entries under `Unreleased` or a
  version section of its own, both of which the check rejects. (#728)
