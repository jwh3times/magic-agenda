# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## Required human actions after agent work

Follow [Required human follow-up](human-follow-up.md) whenever completed agent work leaves a
human dependency. The follow-up belongs in the private repository, on its private board, with
`ready-for-human` and cross-linked step-by-step private wiki instructions. Check existing records
before creating another issue; verify publication before reporting completion.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies** — the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only — the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` — the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.

## This repository in practice

**Every unbuilt item is an open issue, including the ones that are years out.** There is no Markdown
backlog to consult alongside it — `ROADMAP.md` is a pointer, and the per-item implementation
sketches that used to live there are now issue bodies. The
[project board](https://github.com/users/jwh3times/projects/5) carries `Phase` / `Priority` / `Size`
/ `Status` as fields, and ordering is expressed with GitHub's native **blocked-by** dependency
edges rather than prose, so a blocked item shows its open blockers in the UI. The board is private
because it also holds maintainer-only items; the public issues on it stay public regardless, since
a private project cannot make a public issue's body private.

**The automation covers less than it looks like it does, in two specific ways.** A new _public_
issue lands on the board by itself (`Auto-add to project`, filter `is:issue`) and gets
`Status: Todo` (`Item added to project` — that workflow sets status when something is added; it
does not add anything). But **no workflow sets `Phase`, `Priority`, or `Size`**, so a freshly filed
issue sits on the board unfielded until someone sets them. And a **private-repo** issue is never
auto-added at all: auto-add is per-repository, GitHub Free permits exactly one workflow, and that
one is spent on the public repo. Adding it is a manual `gh project item-add`. Both gaps are quiet —
nothing errors — which is why the `end-session` skill names them as steps.

The dividing line is worth stating because it is what stopped the old file drifting: **state goes in
GitHub, reasoning stays in files.** An issue has a closed state and a dependency graph; a Markdown
checkbox has neither. Things that are never "done" — the domain glossary, an architecture decision,
an accepted risk with a revisit trigger, an operational procedure — stay in `CONTEXT.md`,
`docs/adr/`, `docs/runbooks/`, and (for confidential ones) the private companion. Do not reintroduce
a status list, a shipped-items list, or a build-order table into any Markdown file; each is a second
copy of something GitHub already answers authoritatively, and each drifted before.

Work whose **issue body itself** would disclose something the public code does not — an undefended
surface, an unclosable production weakness, provider or credential metadata — goes in the private
companion's tracker instead. Note that GitHub cannot transfer a private-repository issue to a public
one, so misfiling in that direction is the harder mistake to undo.
