# Merging

Everything from an open pull request to a finished merge. `ship` stops when the PR opens; the
maintainer says when to merge, usually as "ship it and merge" or "merge it and complete all follow
ups". What gates a merge and how a version is minted are in
[Required checks and releases](releases.md); this file holds what to do, and what has gone wrong.

## Reading CI

- **The `Cloudflare Pages` check is never required.** Red or green, don't gate a merge on it.
- **A job's log is unreadable until the whole run finishes.** `gh run view <run> --job <job> --log`
  says the run is still in progress while a 20-second `Config` job waits on a 16-minute `E2E`. Wait
  for the run before reading a diff.
- **A red `RLS` or `E2E` at the stack-start step is usually infrastructure.** Docker Hub's
  `toomanyrequests` and the `address already in use` on ports 54322 or 54324 that follows a
  half-started stack both pass on `gh run rerun <id> --failed`. Recognize it by the step: no test
  ran.
- **`E2E` has a known upstream crash signature**: `Received signal 11 SEGV_MAPERR` from Chromium,
  triggered by the test runner's trace recording on the legacy `chrome-headless-shell` (#141).
  Switching to `channel: 'chromium'` in `playwright.config.ts` mitigated it and #141 is closed; if
  the signature recurs it is that bug, not the PR, and #141 is the issue to reopen.
- **A required check that fails on code the PR can't reach isn't the PR's fault**, however many
  times it fails. A control branch (`main` plus only this PR's changelog section) settles it; more
  reruns don't. A test seeded relative to today can behave differently by weekday.
- **Post-merge CI on `main` can go red from a flake the PR's run passed.** Check which job and test
  before treating it as a regression; `gh run list --branch main` maps runs to commits.
- **Poll `state` or `mergedAt`, never `mergeable`.** `mergeable` is computed lazily and can stay
  `UNKNOWN` forever, even on a merged PR, so a loop waiting on it never ends.
- **The end of `gh pr checks --watch` doesn't mean CI finished.** Run seconds after the PR opened,
  `gh pr checks 673 --watch --required --interval 30` returned with `E2E` and `RLS` still
  `pending`; its exit status went unread, so whether it errored is unknown. Re-read
  `gh pr checks <n>` afterward, or poll until no row other than `Cloudflare Pages` is `pending` or
  `queued`, then confirm `mergeStateStatus` is `CLEAN` before merging.
- **A step with `continue-on-error` reports success when its command failed.** Read the raw log or
  the uploaded artifact for such a step, not its conclusion.

## Before merging

- **A `BEHIND` branch can't merge**, even with every check green: the ruleset requires up-to-date
  branches. `gh pr view <n> --json mergeStateStatus` shows it; `gh pr update-branch <n>` fixes it and
  starts a fresh run.
- **On a Dependabot PR, use `gh pr update-branch <n> --rebase`.** `@dependabot rebase` has been
  silently ignored for 15 minutes and more. Pushing a commit of your own to a Dependabot branch ends
  Dependabot's management of that PR.
- **Dependabot regenerates a group PR by itself** when another PR merges, which can remove the
  errors a fix was written for. Before writing a fix for a red Dependabot PR, check
  `gh run list --branch <its branch>` for a regeneration.
- **For a config-touching PR, read the `Config` diff**, never just its green
  ([When changing Supabase config](supabase-config.md)). The first one after a CLI bump or a plan
  change can carry lines the PR didn't cause; ask the maintainer before merging an `update` they
  didn't ask for.
- **Read every issue the PR mentions.** GitHub's closing-keyword parser ignores negation:
  "not fixed: #404" closed #404, and a PR body reading "this does **not** close #277" closed #277.
  Write "#277 stays open" or "PR 1 of 2 for #277". Never put fix, close or resolve (any tense)
  right before an issue number unless the PR closes it.

## Merging

`gh pr merge <n> --merge` once every required check on the current head is green. Merge commits
are the only method the repository allows, and GitHub deletes the merged branch on origin.

**A failed `gh pr merge` can mean either outcome.** With `main` checked out in another worktree it
prints a fatal error after a successful server-side merge, because its local cleanup tries to switch
branches; a TLS timeout has also left a PR open with nothing merged. Read the PR's state before
retrying, and retry only if it is still open, clean and on the expected head.

## After the merge: "complete all follow ups"

That phrase covers all of this, without asking between steps:

1. Confirm the PR's issue closed, and that every issue it only mentions is still open. If one closed
   by mistake, `gh issue reopen` it and set its board `Status` back by hand: reopening doesn't.
2. Confirm the post-merge `Version`, CI and CodeQL runs and the Cloudflare Pages deploy succeeded,
   and that the tag exists on the merge commit, with `Version`'s
   `chore(release): v<x.y.z> [skip ci]` stamp commit on top. A `Version` run that ends with "main
   moved during this run" is benign: the next run releases both merges. Fast-forward local `main`
   afterwards, since the stamp commit lands after the merge.
3. Set the board item to Done.
4. Tidy up: the branch, scratch files, a `vite preview` server on 4173, and the local stack if this
   session started it.
5. Search the private wiki for pages the change made stale, when one could be.
6. File any finding or offer still open in the thread: an unanswered "want me to file X?" counts as
   yes. A concrete defect goes in as `ready-for-agent`, a product choice as `needs-triage` with
   options.
7. Verify in a real browser anything nobody has seen there yet.

"Proceed" after the report means start the next ready item.

## Several PRs at once

- **Open PRs merge in any order.** No branch names a version: each carries only its own
  `changelog.d/` fragment, so catching up with `main` (merge `origin/main`, or "Update branch")
  never touches `CHANGELOG.md`, and `Version` numbers the merges in the order they land. A
  `CHANGELOG.md` conflict means the branch edited it, which `Changelog` rejects; move the entries
  into the branch's fragment.
- **A stacked PR needs no changelog work either.** Its fragment sits beside the first PR's; after
  the first merges, `Version` deletes the first's fragment on `main`, and merging `origin/main`
  carries that deletion over. Nothing in CI enforces the merge order, so the stacked PR's body must
  say "merge #N first". This only fits genuinely dependent branches.

## Dependency pull requests

- **A Dependabot PR needs no changelog work.** It writes no fragment, `Changelog` passes it, and
  `Version` gives its merge a one-bullet section from its PR title.
- **A green Dependabot CLI bump proves nothing about deploys.** The deploy workflows install
  `package.json`'s CLI version, so a CLI major can break them after merge. Read the workflows against
  the new version's behavior.
- **An axe-core bump can flag real violations the old scanner couldn't see.** Treat a new violation
  as a sharper scanner, not noise: fix it app-side in its own PR to `main`, then
  `@dependabot recreate` the bump.

## Changing the required checks

- **A required check must report on every PR, bots included.** Exempt a bot inside the step
  (`exit 0`), never with a job-level `if:`, or the job never reports and the PR can't merge. Detect
  the bot from `github.event.pull_request.user.login`, not `github.actor`, which becomes a human's
  name when someone re-runs the workflow.
- **Merge the PR that adds a job before making its check required.** A branch cut before the job
  existed can't report it.
- **`workflow_dispatch` registers only from the default branch.** A diagnostic workflow on a feature
  branch triggers on `push` scoped to that branch instead.
- **To edit the ruleset**, GET it whole, change one entry and PUT the full rules array back
  (`gh api -X PUT repos/jwh3times/magic-agenda/rulesets/18273908`). The legacy branch-protection API
  answers 404.
