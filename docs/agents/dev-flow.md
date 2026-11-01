# Development flow

The flow itself is `.agents/skills/ship/settings/dev-flow.md`, and `AGENTS.md` summarizes it. This file holds what this repository
adds.

## Docs and agent config

- `docs/`
- `design/`, reference artifacts
- `.github/ISSUE_TEMPLATE/`

## Branch names

The `release/` prefix stays forbidden: a ruleset rejects it, and a version cut is
`chore/release-vX.Y.Z` (see [Required checks and releases](releases.md)). Older branches put the number
last (`fix/card-accessible-name-337`); new branches lead with it.

## Exemption details

- **Dependency bumps** are Dependabot PRs and `chore(deps)` / `chore(dev-deps)` / `chore(ci)` bumps:
  the manifest, the lockfile, and pinned action versions. Code edits a bump forces (an API that moved,
  a test that broke) are code here and need an issue or a waiver, unlike the shared default.
- **Release prep** also covers a `CHANGELOG.md` backfill and a `package.json` major/minor line bump,
  including a standalone `chore/release-vX.Y.Z` branch. Inside a gated PR these ride on that PR's issue.

## Outside this flow

`deferred` means not ready for an agent ([Triage labels](triage-labels.md)). `private/` is a separate
repository and outside this flow.
