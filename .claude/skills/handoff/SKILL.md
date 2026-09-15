---
# GENERATED from .agents/skills/handoff/SKILL.md by scripts/sync-codex.mjs — do not edit; edit the source and run `npm run codex:sync`.
name: handoff
description: Write a handoff document to Proton Drive, mark it active in handoff_map.json, and close the session with end-session.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

# Handoff

Hand this session to the next one, which may run on the other machine (Windows or Fedora). The
document travels through Proton Drive; `handoff_map.json` beside it records which document is
**active** for each repository, and `/lets-go` consumes it.

`scripts/handoff-map.mjs` beside this file owns the folder location, the map key, and the map
format. Run it with `node`; do not edit the map by hand.

## Steps

### 1. Audit unmerged work

Everything not merged to `origin/main` is at risk of being stranded on this machine. Run
`git fetch origin`, then collect every item below:

- **Uncommitted changes** — `git status --porcelain` in every path from `git worktree list`.
- **Commits not on `origin/main`** — `git log --oneline origin/main..<ref>` for each worktree's
  `HEAD` and each local branch.
- **Stashes** — `git stash list`.
- **Open PRs** — `gh pr list --state open --json number,title,headRefName`.
- **Private companion** — if `private/.git` exists: uncommitted changes and
  `git -C private rev-list --left-right --count origin/main...main`.

This repo squash-merges, so `git branch --no-merged` reports merged branches as unmerged. A branch
counts as **merged** only when `gh pr list --head <branch> --state merged --json headRefOid` shows a
merged PR whose `headRefOid` equals the branch tip.

Done when every worktree, local branch, stash, and open PR is classified merged or **unmerged**. If
anything is unmerged, alert the user now with a `⚠ Unmerged work` list (item, location, and state:
uncommitted, unpushed, pushed without a PR, or PR open), then continue with the handoff. Merging or
shipping it is the user's call.

### 2. Resolve the map entry

`node <this skill>/scripts/handoff-map.mjs resolve` prints the folder, the map `key` for this
repo, and its current `active` document. A non-zero exit is a blocker: report its message and
stop, because the handoff has nowhere to go.

### 3. Write the document

Name it `<repo>-handoff-YYYY-MM-DD.md` using the `repo` from step 2 and today's local date. If
that file already exists, add `-2`, `-3`, and so on, so no earlier handoff is overwritten. Write it
directly into the resolved folder as UTF-8 with LF line endings.

Contents:

- **Resume objective** — the single thing the next session should do first. If the user passed
  arguments, they describe the next session's focus; tailor the document to it.
- **Repository state** — branch, commit, worktrees, open PRs, and the step 1 unmerged-work list
  verbatim. Say this is the state when the document was written; `end-session` may change it.
- **Next steps** — ordered, each one actionable without this conversation.
- **Suggested skills** — the skills the next agent should invoke, and when.

Reference specs, plans, ADRs, issues, PRs, commits, and diffs by path or URL rather than restating
them. The document leaves both repositories, so the private-companion rule in `AGENTS.md` applies:
a bare commit SHA is the most it may carry from `private/`. Redact API keys, passwords, tokens, and
personal information.

### 4. Mark it active

`node <this skill>/scripts/handoff-map.mjs set <file name>`. The script refuses a file that is not
in the folder and verifies what it wrote. A replaced `previous` document stays in the folder.

### 5. Close the session

Invoke the `end-session` skill and follow it to its report. Its approval gates still apply.

### 6. Report

- The handoff document's full path, and the map key with its previous and new values.
- `end-session`'s report.
- The `⚠ Unmerged work` list again, re-checked after `end-session`. It goes last so it survives a
  long closeout. If nothing is unmerged, say so.
