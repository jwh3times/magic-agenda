# Development flow

The detail behind the **Development flow** section of `AGENTS.md`: what counts as code, how to
check that an issue is ready, where to route the user when none is, the exemptions, and how a branch
and PR link to their issue. The flow itself — which skill follows which, and why — is the
`ask-matt` router (`.agents/skills/ask-matt/SKILL.md`). Read that file for the map; this page only
binds it to this repository. `ask-matt` is user-invoked like the phase skills, so suggest `/ask-matt`
to the user when they are unsure which route fits.

`/handoff` here is the machine handoff (`docs/agents/tooling.md`), not the portable-file handoff
`ask-matt` routes through: for a prototype or a side task in another directory, write the brief by
hand.

## The gate

Before the first edit to a code path (defined below), name the issue the change starts from and
confirm it is **ready**. Read it with `gh issue view <n> --json labels,body,comments,assignees`.
It is ready when one of these holds:

| Kind          | Label             | What marks it                                                                                                                                                         |
| ------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spec          | `ready-for-agent` | Body follows the `/to-spec` template (`## Problem Statement`, `## Solution`, `## Implementation Decisions`, …)                                                        |
| Ticket        | `ready-for-agent` | Body follows the `/to-tickets` template (`## Parent`, `## What to build`, `## Acceptance criteria`, `## Blocked by`), and every issue under `## Blocked by` is closed |
| Triaged issue | `ready-for-agent` | A comment holds a `/triage` brief headed `## Agent Brief` — `/triage` posts the brief as a comment, not in the body                                                   |
| Bug           | `bug`             | You are working it through `/diagnosing-bugs`. The issue number is required; a spec is not                                                                            |

`needs-triage`, `needs-info`, `ready-for-human`, `deferred`, and `wontfix` all mean _not ready for
an agent_ (see [Triage labels](triage-labels.md)). Reading code, running tests, and answering
questions need no issue; the gate guards edits.

## Routing when there is no ready issue

Stop before the first edit. Name the command that fits, give one line of why, and wait for the
user to run it:

| Situation                                                        | Route                                                                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| An idea one session can hold                                     | `/grill-with-docs`, then `/to-spec` (plus `/to-tickets` if the build spans sessions)               |
| A huge, foggy, multi-session effort                              | `/wayfinder`, then `/to-spec` once the map clears                                                  |
| A raw issue someone else filed (unlabeled or `needs-triage`)     | `/triage`                                                                                          |
| A ready issue nobody has started (no assignee, no branch, no PR) | `/implement`, in a fresh context (`/clear` first)                                                  |
| Something broken                                                 | File the bug issue (`bug` label, `.github/ISSUE_TEMPLATE/bug_report.yml`), then `/diagnosing-bugs` |

The same applies at every **phase boundary** inside the flow: when a phase ends, name the next
command and why in one line, then wait. Inside a phase, use the model-invoked skills — `/tdd`,
`/code-review`, `/diagnosing-bugs`, `/domain-modeling`, `/codebase-design`, `/prototype`,
`/research` — whenever they fit, without asking.

## What counts as code

A change is **code** — and gated — when it touches any of:

- `src/`, `public/` (service worker, `_headers` CSP, the auth bootstrap), `tests/`, `scripts/`
- `supabase/` — migrations, Edge Functions, and `config.toml` / `templates/`, which are production
  config
- `.github/workflows/`, `.github/dependabot.yml`, `.github/CODEOWNERS`
- root build and tooling config: `package.json`, `package-lock.json`, `index.html`,
  `vite.config.ts`, `vitest.rls.config.ts`, `playwright*.config.ts`, `tsconfig*.json`,
  `.oxlintrc.json`, `.prettierrc.json`, `.prettierignore`, `.npmrc`, `.nvmrc`, `.gitattributes`,
  `.gitignore`, `.env.example`

**Docs and agent config** — exempt when a change touches nothing else:

- root Markdown (`AGENTS.md`, `CLAUDE.md`, `README.md`, `CHANGELOG.md`, `CONTEXT.md`,
  `CONTRIBUTING.md`, `ROADMAP.md`, …), `docs/`, and `design/` (reference artifacts)
- `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`
- `.agents/`, `.claude/`, `.codex/`, `skills-lock.json`

Check with `git diff --name-only main...` — one code path makes the whole change code. `private/` is a
separate repository and outside this flow.

## Exemptions

Four kinds of change need no ready issue:

- **Dependency bumps** — Dependabot PRs and `chore(deps)` / `chore(dev-deps)` / `chore(ci)` bumps:
  the manifest, the lockfile, and pinned action versions. Code edits a bump forces (an API that
  moved, a test that broke) are code and need an issue or a waiver.
- **Docs and agent config only**, per the list above.
- **Release prep** — the `ship` skill's `docs: update docs and changelog for vX.Y.Z` commit, a
  `CHANGELOG.md` backfill, and a `package.json` major/minor line bump, including a standalone
  `chore/release-vX.Y.Z` branch. Inside a gated PR these ride on that PR's issue.
- **A user waiver** — the user's explicit words that this change skips the flow. Record it in the
  PR body as `Flow waived by the user: <reason>`, with their reason.

## Linking work to its issue

**Branch names are `<type>/<issue#>-<slug>`** — for example `fix/337-card-accessible-name` or
`feat/508-private-board-assignee-hint`. Types in use here: `feat`, `fix`, `docs`, `test`, `chore`.
Older branches put the number last (`fix/card-accessible-name-337`); new branches lead with it.
Exempt work with no issue drops the number (`docs/dev-flow`). The `release/` prefix stays forbidden
— see [Required checks and releases](releases.md).

**The PR body opens with the link**, one per issue:

- `Closes #N` — the PR finishes the ticket; merging closes it.
- `Part of #N` — the PR is one slice of a spec that stays open.

GitHub links and closes issues from keywords in the PR body or commit messages, never the title,
so a number in the title alone links nothing. `ship` follows the link with the `Release level:`
line and the version the merge will mint. An exempt PR opens with its waiver line when it has one.
