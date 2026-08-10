---
# GENERATED from .agents/skills/ship/SKILL.md by scripts/sync-codex.mjs — do not edit; edit the source and run `npm run codex:sync`.
name: ship
description: Use when a feature branch is ready for review and you want to open or update its PR — refresh docs, write the changelog entry for the version this merge will mint, run the fast checks, push, and open/update the PR. Triggers on "ship it", "open a PR", "push this", "let's ship".
---

# Ship

Take the current branch from "code is done" to "PR is open and green-able", and make
sure the changelog names the version this merge will actually create.

**Announce at start:** "I'm using the ship skill to open a PR for this branch."

## How releases work here — read before touching the changelog

Every merge to `main` auto-deploys (Cloudflare Pages) **and** auto-tags
`v<major>.<minor>.<build>` via `.github/workflows/version.yml`, where `build`
auto-increments per major/minor line. **So every merge is a release**, and its changelog
entry must be written for **the version its merge will mint** — an `[Unreleased]` section is
wrong the moment it lands. The `Changelog` CI job enforces this on every PR.

- Compute the version with **`node scripts/next-version.mjs`** (prints a bare SemVer like
  `1.2.12`). This is the single source of truth — the tag workflow and the CI guard call the
  same script. **Never hand-compute it.**
- The `Changelog` check is **required** and enforces two things via
  `scripts/check-changelog.mjs`: this PR names `$next`, **and** every already-released build has a
  section. The second is why step 3 exists — Dependabot merges ship undocumented and this PR is
  where that debt comes due.
- `## [Unreleased]` stays as a header with a `No unreleased changes.` placeholder; your
  branch's entry goes in a `## [x.y.z]` section for the computed version.
- **Cutting a new minor/major** follows the release-level evaluation in step 2. After confirmation,
  bump the version files to `x.y.0`; the script then returns that version and you write its section.
  Otherwise leave the version files alone and the merge mints the next build.

## Steps

### 1. Preconditions — stop if any fail

- **Not on `main`.** `main` is protected (PR-only). If on `main`, stop and offer to branch:
  `git checkout -b feat/<topic>` (or `fix/`, `chore/`). Never name a branch `release/*` — a
  ruleset rejects that push; use `chore/release-vX.Y.Z` for a version cut.
- **Clean working tree.** Run `git status --porcelain`. Your feature code must already be
  committed. If anything is uncommitted, stop and ask the user whether to commit it — do **not**
  commit their work silently. (The docs/changelog edits *this skill* makes are committed in step 7.)
- **`gh` authenticated.** `gh auth status` must succeed.

### 2. Evaluate the release level

Fetch tags, then inspect the complete branch diff against `main`, the originating issue/spec when
available, and the existing product contracts:

```bash
git fetch --tags -q origin
git diff "$(git merge-base main HEAD)"..HEAD
```

Classify the merge by its highest-impact change. Diff size, commit count, and implementation effort
do not affect the level.

- **Major:** an intentional backward-incompatible change to a user workflow, persisted-data format,
  auth/API/integration contract, or operator/deployment contract. Existing users or integrations
  must change how they behave, or existing data cannot continue unchanged.
- **Minor:** no major change, and the merge adds a backward-compatible user-facing capability,
  supported workflow, setting, or meaningful expansion that users can intentionally adopt.
- **Build:** no major or minor change. This includes compatible bug and security fixes,
  accessibility/performance improvements, UI polish, dependency updates, docs, tests, tooling, and
  internal refactors.

State `major`, `minor`, or `build` and give a short rationale tied to the shipped contract or user
impact. For a mixed diff, choose the highest level present.

- **Build:** leave `package.json` and `package-lock.json` versions unchanged and continue.
- **Minor or major:** present the recommendation and target `x.y.0`, then get the user's confirmation
  before changing version files. After confirmation, run `npm version minor --no-git-tag-version`
  or `npm version major --no-git-tag-version`; verify it set the same version in `package.json`, the
  top-level `package-lock.json.version`, and `package-lock.json.packages[""].version`.
- **Already bumped:** verify the branch's version-file change matches the evaluation; do not bump a
  second time. If it conflicts, stop and resolve the mismatch with the user.
- **Explicit requested level:** still perform the evaluation. If the requested and evaluated levels
  differ, explain the conflict and get confirmation before proceeding.

Complete this decision before computing `$next`: `next-version.mjs` can only return the right
release after any confirmed major/minor bump is present.

### 3. Backfill any released version missing from the changelog

```bash
node scripts/check-changelog.mjs   # expected to exit 1 here — step 5 writes this branch's entry
```

Read the **`These builds were released but have no '## [x.y.z]' section:`** line. Each version it
lists is a build that shipped with no entry — in practice a merged Dependabot PR, which the guard
exempts from naming its own version. Backfill each one now: read what the tag changed
(`git show --stat v<x.y.z>`, plus the `package.json` / `package-lock.json` diff for dependency
bumps) and add a dated section in the right position, with a compare link.

This step is not optional bookkeeping — it's the half of the guard that makes the bot exemption
safe. The same script fails **this** PR until the gaps are filled, so skipping it just means a red
check. The other error line (`no '## [$next]' section`) is expected until step 5. **Ignore the
legacy 4-part tags** (`v1.1.1.x`) — they predate the scheme and the script already excludes them.

### 4. Refresh the docs

Invoke the **`docs-updater`** subagent, scoped to **this branch's diff only**:

```bash
git diff "$(git merge-base main HEAD)"..HEAD --stat
```

Let it update the docs it owns — `AGENTS.md`, `README.md`, `ROADMAP.md` (remove shipped items). It
also owns `CHANGELOG.md`, but **you** write that in step 5 — tell it to **leave `CHANGELOG.md`
alone**. Never edit `CLAUDE.md` (an `@AGENTS.md` import) or anything under `design/`.

### 5. Write the CHANGELOG entry

```bash
next=$(node scripts/next-version.mjs)
```

Insert a `## [$next] - <today>` section immediately below `## [Unreleased]`.

- `## [Unreleased]` **stays**, with the `No unreleased changes.` placeholder.
- Date is today, `YYYY-MM-DD`.
- Group under Keep a Changelog headings — `Added` / `Changed` / `Fixed` / `Removed` /
  `Security` for user-visible behavior, plus `Internal` / `Docs` for build/CI/dependency/doc
  changes. One heading of each kind per section.
- Describe user-visible behavior and its consequences, derived from the branch diff — not a
  commit log.
- Update the compare links at the bottom: point `[Unreleased]` at `compare/v$next...HEAD` and add
  `[$next]: …/compare/v<prev>...v$next`.
- **Idempotent:** if a previous `/ship` of this branch already wrote a section for this version,
  rewrite it in place — never stack a second one. If the target version changed since last time
  (someone else merged first, so `$next` went up), **renumber** the existing section rather than
  adding a new one.

### 6. Fast checks — refuse to push if any fail

Cheap gates that catch most mistakes in seconds. **Tests, the full build, and the Deno
edge-function tests run in CI, not here** (`Test`, `Build`, `Functions` jobs).

```bash
npm run format:check      # prettier (src only) — half of the CI "Format" check
npm run lint              # eslint          — the other half
npx tsc -b                # typecheck (the first half of `npm run build`)
node scripts/check-changelog.mjs   # the exact script the required `Changelog` check runs
```

`check-changelog.mjs` must now exit 0: this branch's entry names `$next`, and step 3 filled every
backfill gap. If it still reports missing builds, go back to step 3 — do not push.

`format:check` only covers `src/**`, so the docs/changelog markdown you edited is not
formatting-gated (there is no markdown check in CI) — no root Prettier run is needed. Fix format
failures with `npm run format`. If any check is red, stop and report — do not push.

### 7. Commit the version, docs, and changelog

```bash
git add -A
git commit -m "docs: changelog and docs for v$next"
```

### 8. Push and open or update the PR

```bash
git push -u origin "$(git branch --show-current)"
gh pr list --head "$(git branch --show-current)" --state open --json number -q '.[0].number'
```

- **No PR** → `gh pr create --base main` with a title and a body derived from the changelog
  section you just wrote.
- **PR exists** → `gh pr edit <number>` to refresh the body. Do **not** open a second PR.

### 9. Report

Give the user: the PR URL; the evaluated release level and rationale; the version this merge will
mint (`v$next`); any versions you backfilled in step 3 and what they turned out to be. State plainly
that **`Test`, `Build`, and `Functions` run in CI, not locally** — do not imply the branch is verified
beyond the fast checks.

## Do not

- **Merge the PR.** The repo self-merges once green (0 approvals required); `/ship` stops at
  "PR open".
- **Push to `main`** — it's protected.
- **Run the full suites** (`npm test`, `npm run build`, `deno test`) — CI owns them.
- **Leave the branch's entry under `[Unreleased]`, or hand-compute the version** — always use
  `scripts/next-version.mjs`.
- **Backfill or renumber the legacy 4-part `v1.1.1.x` tags.**
- **Edit `CLAUDE.md`** (it only imports `AGENTS.md`) or anything under `design/`.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Writing the entry under `## [Unreleased]` | Every merge releases — write `## [$next]` for the computed version; `[Unreleased]` stays empty. |
| Hand-computing the next build | Run `node scripts/next-version.mjs`; it's what CI checks against. |
| Treating a large refactor as a minor release | Classify shipped compatibility and user capability, not diff size or effort. |
| Silently cutting a new release line | State the major/minor recommendation and get confirmation before editing version files. |
| Letting `docs-updater` edit `CHANGELOG.md` too | Tell it to skip `CHANGELOG.md`; the skill owns that file. |
| Stacking a second section on re-ship | Rewrite in place; renumber if `$next` changed since last ship. |
| Skipping the backfill because "it's not my change" | The guard fails your PR for someone else's undocumented build. Step 3 is how it gets paid. |
| Adding a root Prettier run to gate the docs | `format:check` is `src`-only and there's no markdown check in CI — nothing to gate. |
| Merging once green | Stop at PR open — the human self-merges. |
