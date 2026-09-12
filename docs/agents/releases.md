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
