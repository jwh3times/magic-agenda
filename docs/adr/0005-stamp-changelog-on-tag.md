# Stamp each merge's changelog section when it is tagged, not when it ships

Every merge to `main` is a release, and `CHANGELOG.md` gives each one a dated section. A branch no
longer names the version its merge will mint: `ship` writes the branch's entries to its own
`changelog.d/<branch-slug>.md` fragment and never edits `CHANGELOG.md`. After the merge,
`.github/workflows/version.yml` runs `scripts/stamp-changelog.mjs`, which turns each untagged
merge's fragments (or, with none, its PR title) into a dated section with its compare link,
commits the sections with `[skip ci]`, and tags the merge commit. The version is still
`scripts/next-version.mjs`'s computation from the `package.json` line, now made once, at tag time,
over the merges in the order they landed.

Until this record, the rule was `per-merge` and no ADR held it: a PR predicted its version at ship
time and wrote that section, so every merge invalidated every open PR's section. Two open PRs
named the same version by design (#223), whichever merged second failed `Changelog` and conflicted
under `## [Unreleased]`, and Dependabot merges, exempt from the check, shipped undocumented until
the next human PR backfilled them. Fragments cannot collide, and a merge that wrote none still
gets a section, so none of that survives.

The stamp commit goes straight to `main`, which the ruleset otherwise forbids, so `version.yml`
pushes it with a token from a release GitHub App listed as the ruleset's one bypass actor
(`GITHUB_TOKEN` cannot be one). Every first-parent commit on `main` is a release, so rebase and
squash merging stay off. `[skip ci]` keeps the stamp commit from starting CI or a Cloudflare Pages
build, and the `Deploy *` workflows are path-filtered to `supabase/`, which it never touches. The
`Changelog` check keeps its name, which the ruleset requires, and now checks the fragments instead
of a predicted version, with no Dependabot exemption. The scheme and its operating rules are
`stamp-on-tag` in `jwh3times/skills`, which holds the canonical scripts.
