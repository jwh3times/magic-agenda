# Required checks and releases

How a change lands on `main` and becomes a release. Read before opening a PR, picking a version, or
changing a workflow that gates a merge.

`main` is **protected: PR-only, no direct pushes** (no admin bypass). Land changes via a branch + PR.
The nine required status checks are `Format`, `Test`, `Build`, `Functions`, `Agents`, `Changelog`,
`Config`, `RLS`, and `E2E`. These checks and the CodeQL gate must pass, and review threads must be
resolved before merge (0 approvals required, so you can self-merge once green). The
[active ruleset](https://github.com/jwh3times/magic-agenda/rules/18273908) is authoritative for all
merge requirements and scanning thresholds.
`Config` previews the pending `supabase config push` on PRs touching `supabase/config.toml` or
`supabase/templates/**` and no-ops elsewhere — it is required, so it reports on every PR. Branch names must not start
with `release/` — a ruleset protects that namespace and rejects the push; use `chore/release-vX.Y.Z`. Cloudflare Pages builds & deploys `main`
(`npm run build` -> `dist`), so production only ships after a checks-passing merge. Database migrations
are applied to production on the same merge by the `Deploy Migrations` workflow (triggered by changes
under `supabase/migrations/**`). `VITE_*` vars are inlined at **build time**, so they must be set in the
Pages project, not just locally. Every merge to `main` is also a release: the `Version` workflow
(`.github/workflows/version.yml`) tags `v<major>.<minor>.<build>` and creates a GitHub Release. The
next version is computed by `scripts/next-version.mjs` — the single source of truth, also called by the
CI guard below: for an existing major/minor line the build auto-increments from the highest existing
`v<major>.<minor>.*` tag; for a new major/minor line the `package.json` build is used as-is, so `x.y.0`
is valid and does not auto-bump to `x.y.1`. Because every merge ships, **`CHANGELOG.md` names the exact
version each merge will mint**: a PR adds a `## [x.y.z]` section for its target version (from that
script). The required `Changelog` job runs `scripts/check-changelog.mjs`, which enforces both that the
PR names its target version **and** that every already-released 3-part tag has a section. Dependabot
PRs are exempt from the first (a bot can't write an entry) — so their merges ship undocumented, and
the second rule fails the next human PR until those builds are backfilled. That job must keep
reporting a status on **every** PR including Dependabot's (the exemption lives inside the step, not in
a job-level `if:`) — a required check that never runs leaves a PR unmergeable forever. The `ship`
skill automates the whole flow, backfill included.

**Two PRs open at once both name the same version, and that is the design rather than a bug**
(#223). The next build is computed from the highest existing tag, so branches cut from the same
commit _must_ compute the same number; nothing reserves it. Whichever merges second then fails the
required `Changelog` check for naming an already-minted version, and conflicts on `CHANGELOG.md`
besides, since both inserted a section at the same offset under `## [Unreleased]`. Both go green
before either merges, so the failure always lands after review. The fix is mechanical — renumber the
section, fix its two compare links, resolve the conflict — and `ship` now checks for a competing
claim before writing, so it is reported up front instead of discovered from a red check.

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

per-merge — `.github/workflows/version.yml` tags every merge to `main` `v<major>.<minor>.<build>`,
and each merge's dated changelog section names the version it mints.

## Skipped tags

backfill — a merged Dependabot PR (exempt from naming its own version) gets its section on the next
ship.

- **Ignore:** the legacy 4-part `v1.1.1.x` tags, which predate the scheme;
  `scripts/check-changelog.mjs` already excludes them.

## Version file

`package.json` (with `package-lock.json`: its top-level `version` and `packages[""].version`)

## Bump command

`npm version <version> --no-git-tag-version`

## Ask before bumping

always

## Next-version command

`node scripts/next-version.mjs`

## Unreleased placeholder

`No unreleased changes.`

## Changelog check

`node scripts/check-changelog.mjs` — the script the required `Changelog` job runs: this PR names
its version, and every released 3-part tag has a section.

## Release commit message

`docs: changelog and docs for v<version>` — the release prep `docs/agents/dev-flow.md` exempts.
