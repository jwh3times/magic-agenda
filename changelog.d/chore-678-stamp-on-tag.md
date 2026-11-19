### Internal

- **The changelog moves from `per-merge` to `stamp-on-tag`** (ADR 0005). A branch no longer
  predicts the version its merge will mint: `/ship` writes its entries to its own
  `changelog.d/<branch-slug>.md` fragment and never edits `CHANGELOG.md`. After each merge to
  `main`, `Version` runs the new `scripts/stamp-changelog.mjs`, which turns every untagged merge's
  fragments (or, with none, its PR title) into a dated section with its compare link, pushes one
  `chore(release): v<x.y.z> [skip ci]` commit through the release GitHub App the main ruleset lets
  bypass it, tags each merge commit, and creates its GitHub Release from that section. Open PRs now
  merge in any order without renumbering, and Dependabot merges get a section without a backfill.
- **The required `Changelog` check keeps its name** but now verifies the branch's fragments and
  fails when a branch edits a released section, a `## [Unreleased]` entry or a fragment already on
  `main`. Dependabot PRs pass it without the old author exemption.
- **The compare-link footer is repaired**: `[Unreleased]` compared from `v1.18.51`, and `1.18.52`
  to `1.18.54` had no links. The stamp builds each new link from the `[Unreleased]` line, so it
  must be current before the first stamped release.
- The shared `ship`, `docs-updater` and `end-session` skills are reinstalled from
  `jwh3times/skills` with `stamp-on-tag` support, the canonical `check-changelog.mjs` is updated,
  and `skills-lock.json` now records the source commit of every installed skill.
