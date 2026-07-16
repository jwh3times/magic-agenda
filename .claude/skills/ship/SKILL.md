---
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
  section. The second is why step 2 exists — Dependabot merges ship undocumented and this PR is
  where that debt comes due.
- `## [Unreleased]` stays as a header with a `No unreleased changes.` placeholder; your
  branch's entry goes in a `## [x.y.z]` section for the computed version.
- **Cutting a new minor/major** is just a normal ship where you first bump `package.json` to
  `x.y.0` (and match `package-lock.json` — the top-level `version` and `packages[""].version`);
  the script then returns `x.y.0` and you write that section. Otherwise leave `package.json`
  alone and the merge mints the next build.

## Steps

### 1. Preconditions — stop if any fail

- **Not on `main`.** `main` is protected (PR-only). If on `main`, stop and offer to branch:
  `git checkout -b feat/<topic>` (or `fix/`, `chore/`). Never name a branch `release/*` — a
  ruleset rejects that push; use `chore/release-vX.Y.Z` for a version cut.
- **Clean working tree.** Run `git status --porcelain`. Your feature code must already be
  committed. If anything is uncommitted, stop and ask the user whether to commit it — do **not**
  commit their work silently. (The docs/changelog edits *this skill* makes are committed in step 6.)
- **`gh` authenticated.** `gh auth status` must succeed.

### 2. Backfill any released version missing from the changelog

```bash
git fetch --tags -q origin
node scripts/check-changelog.mjs   # expected to exit 1 here — step 4 writes this branch's entry
```

Read the **`These builds were released but have no '## [x.y.z]' section:`** line. Each version it
lists is a build that shipped with no entry — in practice a merged Dependabot PR, which the guard
exempts from naming its own version. Backfill each one now: read what the tag changed
(`git show --stat v<x.y.z>`, plus the `package.json` / `package-lock.json` diff for dependency
bumps) and add a dated section in the right position, with a compare link.

This step is not optional bookkeeping — it's the half of the guard that makes the bot exemption
safe. The same script fails **this** PR until the gaps are filled, so skipping it just means a red
check. The other error line (`no '## [$next]' section`) is expected until step 4. **Ignore the
legacy 4-part tags** (`v1.1.1.x`) — they predate the scheme and the script already excludes them.

### 3. Refresh the docs

Invoke the **`docs-updater`** subagent, scoped to **this branch's diff only**:

```bash
git diff "$(git merge-base main HEAD)"..HEAD --stat
```

Let it update the docs it owns — `AGENTS.md`, `README.md`, `ROADMAP.md` (remove shipped items). It
also owns `CHANGELOG.md`, but **you** write that in step 4 — tell it to **leave `CHANGELOG.md`
alone**. Never edit `CLAUDE.md` (an `@AGENTS.md` import) or anything under `design/`.

### 4. Write the CHANGELOG entry

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

### 5. Fast checks — refuse to push if any fail

Cheap gates that catch most mistakes in seconds. **Tests, the full build, and the Deno
edge-function tests run in CI, not here** (`Test`, `Build`, `Functions` jobs).

```bash
npm run format:check      # prettier (src only) — half of the CI "Format" check
npm run lint              # eslint          — the other half
npx tsc -b                # typecheck (the first half of `npm run build`)
node scripts/check-changelog.mjs   # the exact script the required `Changelog` check runs
```

`check-changelog.mjs` must now exit 0: this branch's entry names `$next`, and step 2 filled every
backfill gap. If it still reports missing builds, go back to step 2 — do not push.

`format:check` only covers `src/**`, so the docs/changelog markdown you edited is not
formatting-gated (there is no markdown check in CI) — no root Prettier run is needed. Fix format
failures with `npm run format`. If any check is red, stop and report — do not push.

### 6. Commit the docs and changelog

```bash
git add -A
git commit -m "docs: changelog and docs for v$next"
```

### 7. Push and open or update the PR

```bash
git push -u origin "$(git branch --show-current)"
gh pr list --head "$(git branch --show-current)" --state open --json number -q '.[0].number'
```

- **No PR** → `gh pr create --base main` with a title and a body derived from the changelog
  section you just wrote.
- **PR exists** → `gh pr edit <number>` to refresh the body. Do **not** open a second PR.

### 8. Report

Give the user: the PR URL; the version this merge will mint (`v$next`); any versions you backfilled
in step 2 and what they turned out to be. State plainly that **`Test`, `Build`, and `Functions` run
in CI, not locally** — do not imply the branch is verified beyond the fast checks.

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
| Letting `docs-updater` edit `CHANGELOG.md` too | Tell it to skip `CHANGELOG.md`; the skill owns that file. |
| Stacking a second section on re-ship | Rewrite in place; renumber if `$next` changed since last ship. |
| Skipping the backfill because "it's not my change" | The guard fails your PR for someone else's undocumented build. Step 2 is how it gets paid. |
| Adding a root Prettier run to gate the docs | `format:check` is `src`-only and there's no markdown check in CI — nothing to gate. |
| Merging once green | Stop at PR open — the human self-merges. |
