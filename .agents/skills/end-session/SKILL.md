---
name: end-session
description: Use when a work session is ending and you want it closed out cleanly — session discoveries written to memory, GitHub issues brought up to date, `private/` docs reconciled, and the local workspace tidied. Triggers on "clean up the local workspace, update any private/ docs and/or github issues that need it from this session", "end session", "wrap up for the day", "we're done for today".
---

# End session

Close out a work session so the next one starts from an accurate picture. The canonical
request this skill answers, verbatim:

> clean up the local workspace, update any private/ docs and/or github issues that need it
> from this session.

**Announce at start:** "I'm using the end-session skill to close out this session."

## What this is and is not

This skill moves **knowledge** out of the conversation and **junk** out of the checkout. It
does not ship code.

- It does **not** open, update, or merge a PR — that is `/ship`, and it runs first if a branch
  is still in flight.
- It does **not** edit `AGENTS.md`, `README.md`, `ROADMAP.md`, or `CHANGELOG.md` — those are
  public docs owned by the `docs-updater` subagent and the `ship` skill, and they belong to the
  PR that changed the code, not to the end of a session.
- It does **not** delete anything git-ignored that is the only copy of something (see
  step 6's never-delete list).

Read `AGENTS.md` for context if it is not already in the session. Its "Agent skills" section
points at `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, and
`docs/agents/domain.md`, all three of which this skill leans on.

## Steps

### 1. Take stock of what this session actually produced

Before writing anything, list what happened. Read the checkout, not just your memory of the
conversation:

```bash
git status --porcelain              # uncommitted work and stray files
git status --porcelain --ignored    # the local-only surface (step 6 audits this)
git log --oneline origin/main..HEAD # commits this branch adds
git branch -vv                      # local branches and their tracking state
git worktree list
git stash list
gh pr list --state open --json number,title,headRefName
```

Then write out, in your own notes for this pass, the four categories that actually need
somewhere to go:

1. **Shipped** — what merged or is in an open PR, and which issue it closes.
2. **Learned** — surprises, corrections, dead ends, things that turned out to be untrue. These
   are the highest-value output of the session and the easiest to lose.
3. **Decided** — anything two-sided that got ruled on, plus anything two-sided that did **not**
   get ruled on (that one becomes a `needs-triage` issue, not an assumption).
4. **Left behind** — stray files, a running local Supabase stack, an unfinished branch, a stash.

If a category is genuinely empty, say so in the final report rather than inventing an entry.

### 2. Bring the GitHub issue tracker up to date

Conventions and exact `gh` invocations live in **`docs/agents/issue-tracker.md`**; the label
vocabulary lives in **`docs/agents/triage-labels.md`** (`needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`). `gh` infers the repo from the clone.

- **Close what shipped.** For each issue this session finished, `gh issue close <n> --comment
"..."` naming the PR and the version it merged as. Do not close an issue whose PR is still
  open — comment instead.
- **Comment where evidence was found but nothing was implemented.** A future session will not
  have this conversation. Put the `file:line` evidence in the issue.
- **File what was discovered and not fixed.** This repo's practice is findings-into-the-tracker
  before implementing: one issue per finding, self-contained, with evidence. A finding that only
  exists in this transcript is a finding that is gone tomorrow.
- **Label the two-sided ones `needs-triage` and leave them alone.** If the fix depends on a
  product judgement, the issue is the deliverable — do not pick a default and bake it into the
  repo. (`#220`'s "a Series definition with `recurFreq: 'none'` materializes nothing" is the
  shape: real, cheap to change, and meaningless until someone decides what it should do.)
- **Set the board fields on every new issue, and add private ones by hand.** The two halves are
  different because the automation covers less than it looks like it does:
  - A **public** issue is added to the board automatically (the `Auto-add to project` workflow,
    enabled 2026-09-04, filter `is:issue`), and `Status` is set to `Todo` by `Item added to
    project`. **Neither sets `Phase`, `Priority`, or `Size`** — do that:
    `gh project item-edit --id <item-id> --project-id <proj-id> --field-id <f> --single-select-option-id <o>`.
  - A **private-repo** issue is *never* auto-added. Auto-add is per-repository and GitHub Free
    allows exactly one workflow, which is spent on the public repo. Add it:
    `gh project item-add 5 --owner jwh3times --url <issue-url>`, then set the same three fields.

  An issue that is filed but not on the board, or on it with no fields, is invisible to the queue —
  the same drift the Markdown backlog had, one surface over. This has already gone wrong once: the
  board held only the public issues while three documents claimed it carried both.
- **Use the glossary's words.** `CONTEXT.md` is authoritative for domain vocabulary — Recurring
  Series, Recurrence Rule, Occurrence, Occurrence Date, Scheduled Day, Excluded Date. `template`
  and `instance` are implementation words and stay inside the recurrence code; an issue title
  using them is drift. If a concept has no glossary entry yet, that is itself worth noting.
- **Never paste `private/` content into an issue.** Those files carry threat models and accepted
  risks that are deliberately not public. Summarize the public half; leave the reasoning private.

### 3. Reconcile `private/`

`private/` is **git-ignored by the public repository and is a separate private Git repository**
(the private companion). CI never sees it, it is exempt from Prettier, and its remote is the only
other copy of what it contains — so this step ends with the companion synchronized, not merely
edited. Its operating rules are in `private/OPERATING-POLICY.md`; the ones that bind here:

- **Detect it by `private/.git`, not by the directory existing.** A bare directory is not a
  clone. If `private/` exists without `.git`, say so and touch nothing in it.
- **Fetch first and report the state** before editing anything:
  `git -C private fetch origin && git -C private status --short --branch` and
  `git -C private rev-list --left-right --count origin/main...main`. Behind-only: pull
  `--ff-only`. Ahead-only: carry on; it will be pushed below. **Diverged: stop** — report it and
  do not merge, rebase, reset, or resolve it yourself. **Never force-push.**

Its layout:

- **`private/README.md` — the index.** It carries `Last reconciled`, a `Repository state` line
  (version, the issue numbers that landed, whether a local feature branch remains), a **Where work
  is tracked** pointer, a **Current security and operational register** of open and accepted risks,
  and a **Document map**. Update the date and the state line; update the register when this session
  changed an accepted risk, closed one, or gave one an issue.

  **Do not reintroduce a shipped-list or a next-work ordering here.** Both existed until
  2026-09-04 and both drifted — a shipped-list is a worse `CHANGELOG.md`, and a next-work list is a
  worse issue queue. Planned work lives in GitHub issues and on the project board (see step 2). If
  this session's state feels like it needs a list in this file, it needs an issue instead.

  What the register **is** for, and why it is not an issue: an accepted risk with a revisit trigger
  has no closed state, and a closed issue is invisible at the moment someone needs it. Record the
  decision here; record the *action* as an issue and link it.
- **`private/YYYY-MM-DD-<topic>.md` — dated evidence documents.** Security reviews, decision
  records, threat models, accepted-risk registers. **These are evidence from the state they
  reviewed and are not silently rewritten to look like they were written today.** If this
  session changed something one of them covers, extend that document's **amendment** section
  saying what is now superseded — never edit the original body.
- **Create a new dated document only for a genuinely new artifact** — a fresh review, a new
  decision with a cost/benefit behind it, a deferred threat model. Not for session notes. Add it
  to the Document map in the same pass, or it is invisible.
- **The precedence rule stated in `private/README.md` holds:** current code, migrations, tests,
  `AGENTS.md`, `CONTEXT.md`, and `docs/adr/` establish what shipped; the amendment establishes
  which of a dated document's conclusions still apply; the original body is the audit trail for
  why. Where private language predates the public glossary, the glossary wins.

**Then synchronize the companion.** This is the one push this skill is allowed to make, and it
is gated four ways, in order:

1. Stage only the intended private files and show `git -C private diff --cached` — the diff
   itself, not a summary. Do not resolve any `op://` reference while doing so.
2. Scan the staged content for values: private-key headers, `ghp_`/`sbp_`/`eyJ…` token shapes,
   passwords, passphrases, connection strings, and `KEY=value` environment assignments. An
   `op://` reference is fine; a resolved value is an incident even here — stop and say so.
3. `gh repo view <owner>/<repo> --json nameWithOwner,visibility,url` on the companion's
   `origin` and **stop unless `visibility` is exactly `PRIVATE`**. A companion reported public
   means every prior push was a disclosure: do not push, preserve evidence, report.
4. Ask the maintainer for explicit approval to commit and push. Then commit, and
   `git -C private push origin main` — plain, never `--force`.

Report the resulting commit SHA and re-run the ahead/behind count; **zero/zero is
synchronized, anything else is not**, and the report must say so rather than claim success.
If the approval is declined or the session ends first, say plainly that private changes remain
local — the next machine will not have them.

If `private/.git` does not exist in this checkout, skip this step silently — it is the
maintainer's companion, and its absence means it was not bootstrapped here
(`npm run bootstrap:private`), not that it needs creating.

### 4. Update memory

Memory is one file per fact in the Claude Code project memory directory, with `MEMORY.md` as
the index — one line per memory, never content. Update in place; do not accumulate near-duplicates.

- **Check the index first.** Most session discoveries belong in a memory that already exists —
  build state, CI gotchas, release process, working practices, backups. Editing the right file
  beats adding a tenth one that says almost the same thing.
- **Write what the repo does not already record.** Code structure, past fixes, migration
  contents, and anything in `AGENTS.md` or `CHANGELOG.md` are already written down. Memory is
  for what a fresh session could not derive: the reasoning behind an accepted risk, a landmine
  that only shows up when you trip it, a preference, an open call awaiting a decision.
- **Convert relative dates to absolute.** "Last week" is worthless in three months.
- **Delete what turned out to be wrong.** A corrected claim is not left standing beside its
  correction.
- **Link related memories with `[[name]]`.**

The highest-value memory writes from a session here are usually the *landmines* — the things
that were true, cost time, and are invisible from the code. Prior examples: a required CI check
must report on Dependabot PRs or the PR wedges forever; `supabase config push` deploys straight
to production and must never run locally; the Supabase CLI's prompts default to **yes** on EOF.

### 5. Check whether anything learned belongs in a public doc

Some session discoveries belong in `AGENTS.md`, a runbook under `docs/runbooks/`, `CONTEXT.md`,
or an ADR — not in memory or `private/`. Decide by ownership, not convenience:

- **Branch still open?** Hand it to `/ship` (which runs `docs-updater`) and let the docs land in
  the PR that changed the behavior. Do not edit public docs here.
- **Already merged?** File an issue. Editing a public doc on a fresh branch after the fact is a
  second PR, which is a decision for the maintainer, not a cleanup task.
- **Runbooks are the exception worth watching.** `docs/runbooks/` is *living* documentation and
  must change in the same PR as whatever it describes. `docs/plans/` and `docs/specs/` are
  dated historical records — never update them to match current code.

### 6. Clean the local workspace

Audit, then delete — in that order. `git status --porcelain --ignored` is the tool.

**Never delete these.** Each is unrecoverable, the only copy, or costly to bring back:

| Path                              | Why                                                     |
| --------------------------------- | ------------------------------------------------------- |
| `.env.local`                      | Local Supabase credentials; `.env.example` is a template, not a backup. |
| `private/`                        | The private companion checkout; its uncommitted work exists nowhere else. |
| `tests/e2e/.auth/`                | Playwright storage state for the E2E account.           |
| `supabase/.temp/` (all but `pgdelta/`), `supabase/.branches/` | CLI link state, not scratch; deleting it unlinks the project, and re-linking needs the database password. |
| `node_modules/`, `supabase/functions/node_modules/` | Reinstallable, but deleting them is a chore, not cleanup. |
| Any file with uncommitted work in it | Ask; never silently discard the user's work.         |

**Safe to delete** once you have confirmed nothing in them is wanted:

- The session scratchpad directory (temp files should have gone there in the first place).
- `test-results/`, `playwright-report/` — Playwright output, git-ignored. **Traces in
  `test-results/` contain a full `authorization: Bearer <JWT>` for the E2E account**; deleting
  them locally is good hygiene, and they must never be attached anywhere.
- `dist/` — build output, regenerated by `npm run build`. (`*.tsbuildinfo` is safe too, but it is
  the incremental typecheck cache — deleting it buys ~nothing and makes the next `tsc -b` a full
  rebuild, so leave it alone unless the tree is genuinely dirty.)
- Ad-hoc scratch at the repo root: one-off `*.sql`, `*.mjs`, `*.json`, `*.md` files written to
  poke at something. These show as **untracked**, not ignored, which is exactly how you spot them.
- `supabase/.temp/pgdelta/` — a regenerable schema-diff cache, and the only thing under
  `supabase/.temp/` that is; the rest of that directory is link state (see the table above).

**Ask before deleting** `.superpowers/` — git-ignored workflow scratch (task briefs, per-agent
reports, review diffs) that may still be mid-flight.

**Anything ignored that is not on either list above is a stray.** Name it in the report and ask;
an unexplained ignored path is more interesting than a known one.

Then the loose ends that are not files:

- **Local Supabase stack.** `npm run test:rls:up` leaves a Docker stack running for the rest of
  the day. If this session started it, `npm run test:rls:down`. Leaving it up also means the
  hermetic unit suite has something live to accidentally reach, which is the failure mode
  `vite.config.ts`'s port-1 dummy env exists to prevent.
- **Worktrees.** `git worktree list`; remove any whose work is merged.
- **Local branches.** Delete branches whose PR merged (`gh pr list --state merged --limit 20
--json number,headRefName`). **Never delete a branch with unpushed commits** — check
  `git log --oneline origin/<branch>..<branch>` first, and check that the upstream still exists.
- **Stashes.** `git stash list`. A leftover stash is a loose end: report it, name what is in it,
  and do **not** drop it without being told to.
- **Working tree.** End on a clean `git status --porcelain`, or an explicit statement of what is
  still uncommitted and why.

### 7. Report

Give the user, in this order:

- **Issues** — closed, commented, filed (with numbers and one-line reasons), and anything left
  `needs-triage` awaiting their decision.
- **`private/`** — which files changed, and whether the boundary/next-work ordering moved.
- **Memory** — which memories were updated or created, and which were deleted as wrong.
- **Workspace** — what was deleted, what was deliberately kept, and anything you left alone
  pending their answer (a stash, `.superpowers/`, an unexplained ignored path).
- **Still open** — branch state, open PRs and their check status, and the single next thing you
  would pick up. This is the handoff line; a future session starts from it.

## Do not

- **Ship, push, or merge the public application repository.** If a branch needs a PR, run
  `/ship` first — separately, before this skill — and say so. The one exception is the private
  companion's own `main` in step 3, and only through its four gates.
- **Edit `AGENTS.md`, `README.md`, `ROADMAP.md`, or `CHANGELOG.md`.** They belong to the code
  PR. `CLAUDE.md` is only an `@AGENTS.md` import and is never edited at all.
- **Update `docs/plans/` or `docs/specs/`.** They are dated historical records by design.
- **Rewrite the body of a dated `private/` document.** Amend it.
- **Copy `private/` reasoning into a GitHub issue.**
- **Delete `.env.local`, `private/`, or `tests/e2e/.auth/`** — or any ignored path you cannot
  account for.
- **Drop a stash, or delete a branch with unpushed commits.**
- **Invent session outcomes to fill a category.** "Nothing to record here" is a valid result and
  a more useful one than a padded list.

## Common mistakes

| Mistake                                                       | Fix                                                                                          |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Recording a discovery only in the conversation                | It vanishes at session end. Issue, `private/`, or memory — pick one, in that order of preference. |
| Writing a memory that restates `AGENTS.md`                    | Memory is for what the repo does not already record. Prefer the landmine over the summary.     |
| Adding a tenth memory that overlaps three existing ones       | Read `MEMORY.md` first and edit in place.                                                     |
| Rewriting a dated `private/` review to match today's code     | It is evidence from the state it reviewed. Extend its amendment section instead.               |
| Silently picking a default for a two-sided question           | File it `needs-triage` and leave it. The decision is the maintainer's.                          |
| Using `template`/`instance` in an issue title                 | Use `CONTEXT.md`'s words: Recurring Series, Occurrence, Occurrence Date.                        |
| `rm -rf` on everything git-ignored                            | That takes `.env.local` and `private/` with it. Audit against the never-delete list first.      |
| Reporting "private/ reconciled" with commits still unpushed   | The next machine gets nothing. Say "N commits ahead, not pushed" and why.                      |
| Pushing the companion without re-checking its visibility      | A repo flipped public turns the push into a disclosure. `gh repo view … --json visibility` first. |
| Deleting `supabase/.temp/` as CLI scratch                     | It holds the link state; every `--linked` command then fails until `npx supabase link`, which needs the database password. Only `pgdelta/` inside it is cache. |
| Leaving the local Supabase stack running                      | `npm run test:rls:down` if this session brought it up.                                         |
| Editing public docs after the branch merged                   | File an issue; a docs-only PR is the maintainer's call.                                        |
| Ending without a "next thing I would pick up" line            | That line is the whole point of closing out cleanly.                                           |
