# Required checks and releases

How a change lands on `main` and becomes a release. Read before opening a PR, picking a version, or
changing a workflow that gates a merge.

`main` is **protected: PR-only, no direct pushes** (no admin bypass). Land changes via a branch + PR.
The ruleset's one bypass actor is the release GitHub App, "Always allow", so `Version` can push its
stamp commit; nothing else pushes to `main`.
The nine required status checks are `Format`, `Test`, `Build`, `Functions`, `Agents`, `Changelog`,
`Config`, `RLS`, and `E2E`. These checks and the CodeQL gate must pass, and review threads must be
resolved before merge (0 approvals required, so you can self-merge once green). The
[active ruleset](https://github.com/jwh3times/magic-agenda/rules/18273908) is authoritative for all
merge requirements and scanning thresholds.
`Config` previews the pending `supabase config push` on PRs touching `supabase/config.toml` or
`supabase/templates/**` and no-ops elsewhere — it is required, so it reports on every PR. It is
green whenever the diff ran, pending changes included, so read that diff before merging
([When changing Supabase config](supabase-config.md)). Branch names must not start
with `release/` — a ruleset protects that namespace and rejects the push; use `chore/release-vX.Y.Z`. Cloudflare Pages builds & deploys `main`
(`npm run build` -> `dist`), so production only ships after a checks-passing merge. Database migrations
are applied to production on the same merge by the `Deploy Migrations` workflow (triggered by changes
under `supabase/migrations/**`). `VITE_*` vars are inlined at **build time**, so they must be set in the
Pages project, not just locally. Every merge to `main` is also a release: the `Version` workflow
(`.github/workflows/version.yml`) tags `v<major>.<minor>.<build>` and creates a GitHub Release. The
version is computed by `scripts/next-version.mjs`'s rule: for an existing major/minor line the build
auto-increments from the highest existing `v<major>.<minor>.*` tag; for a new major/minor line the
`package.json` build is used as-is, so `x.y.0` is valid and does not auto-bump to `x.y.1`.

**No branch names a version** (`Scheme: stamp-on-tag`, [ADR 0005](../adr/0005-stamp-changelog-on-tag.md)).
A branch writes its entries to its own `changelog.d/<branch-slug>.md` fragment and never edits
`CHANGELOG.md`; the `open-pr` skill does this. After the merge, `Version` runs
`scripts/stamp-changelog.mjs`, which turns that merge's fragments (or, with none, its PR title) into
its dated section with its compare link, deletes them, pushes one `chore(release): v<x.y.z> [skip ci]`
commit through the release App, tags the merge commit, and creates the Release from the section.
So open PRs merge in any order, and a Dependabot merge gets a section without a backfill. The
required `Changelog` job runs `scripts/check-changelog.mjs`, which checks that the branch's
fragments parse and that it edits no released section, no `## [Unreleased]` entry and no fragment
already on `main`. It has no Dependabot exemption, and it runs on every PR, as a required check
must: one that never reports leaves a PR unmergeable forever. A fragment may use this changelog's
own `### Internal` and `### Docs` categories; the stamp sorts them after Keep a Changelog's six.
`next-version.mjs`, `check-changelog.mjs`, `stamp-changelog.mjs`, `check-docs.mjs`, `check-skills.mjs`
and `sync-main.mjs`, with their `node:test` suites, are canonical in `jwh3times/skills`: fix them
there, then copy them here.

**The stamp commit is the tip of `main` but carries no tag**, and Cloudflare Pages skips it, as it
skips every `[skip ci]` commit; production is the merge commit's build. A Pages build of the stamp
commit (a manual retry, say) would show the _next_ release's number under the rule below, since it
is an untagged tip of `main`.

**The app shows its own release, resolved at build time** (Settings footer, for example
`v1.17.22 · a37c862`). The version is in no source file: `package.json` carries only the
major/minor line, and the build number is the tag `Version` pushes after the merge, while
Cloudflare Pages builds the same commit on its own schedule. `scripts/build-info.ts` therefore
resolves it while Vite builds, and `vite.config.ts` injects the result as `__BUILD_INFO__`:

- a tag on the commit itself wins, because `Version` may finish before the deploy build starts and
  counting on from the highest tag would then name the _next_ release;
- otherwise `computeNextVersion` from `next-version.mjs`, the same computation the tag workflow
  runs, so the two cannot disagree — but only when every tag is in view **and** the commit is the
  tip of `main`. An older commit still waiting for its tag would otherwise be given a later
  release's number;
- **anything uncertain resolves to no version and the commit alone is shown** (`Build a37c862`): a
  branch or Pages preview build, an incomplete tag list, or a line with no tags. Someone reads this
  to decide whether a fix is live, so a wrong version is worse than none.

**Cloudflare Pages builds from a shallow clone with no tags**, measured on the first production
build (v1.17.23), which showed a commit and no version. So a Pages build of `main` (`CF_PAGES` set
and `CF_PAGES_BRANCH=main`) reads the tags and the branch tip from the remote with
`git ls-remote`; the repository is public, so that needs no credential. Every other build reads
the local clone and needs no network. The branch and commit come from `CF_PAGES_BRANCH` and
`CF_PAGES_COMMIT_SHA` on Pages, since it checks a commit out detached.

Vitest gets a fixed `v0.0.0 · 0000000`, and the settings visual canary rewrites the label to
`Build 0000000` before its screenshot, because a PR build shows a commit that changes on every run.
No test reaches a real Pages build: after changing `scripts/build-info.ts`, read the footer on the
live site, or the `{version,commit}` object in the deployed bundle.

## Scheme

stamp-on-tag — `.github/workflows/version.yml` tags every merge to `main`
`v<major>.<minor>.<build>`. Each branch's entries live in its own `changelog.d/<branch-slug>.md`
fragment; the workflow stamps them into the merge's dated section and tags the merge commit
(ADR 0005).

## Ask before bumping

always
