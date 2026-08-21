# Handoff — Magic Agenda session, 2026-08-21

For a fresh agent picking up this repo. Everything shipped is already in git, GitHub, and the
repo's own docs — this covers only what a new session **cannot** read off disk.

> This file lives on a handoff branch and is **not** meant to be merged into `main`.

## Where things stand

`main` is at `af7a458`, everything is merged and pushed, working tree clean. Three PRs shipped this
session: **v1.8.16** (#225), **v1.8.18** (#227), **v1.8.19** (#230). `node scripts/next-version.mjs`
returns `1.8.20` — that is simply the next unclaimed build, not debt. `check-changelog.mjs` reports
no undocumented releases.

The local branch `claude/next-priority-item-m10whq` is fully merged. **This session's task framing
required all work to happen on that branch name**; if that still applies, restart it from `main`
rather than stacking on merged history:

```bash
git fetch origin main && git checkout -B claude/next-priority-item-m10whq origin/main
```

## The blocker you are inheriting

**There is no agent-actionable item in the tracker.** All four open issues need the maintainer:

| Issue | Why it's blocked |
| --- | --- |
| [#166](https://github.com/jwh3times/magic-agenda/issues/166), [#167](https://github.com/jwh3times/magic-agenda/issues/167) | `ready-for-human`, assigned to jwh3times |
| [#228](https://github.com/jwh3times/magic-agenda/issues/228), [#229](https://github.com/jwh3times/magic-agenda/issues/229) | `needs-triage`; filed this session with options + a lean, deliberately undecided |

#228 and #229 were written **at the maintainer's request** during this session and each ends in a
judgement call. Implementing your own lean on them is what `end-session`'s rules call out as a
mistake ("silently picking a default for a two-sided question"). Ask before acting.

Recommendation already given to the user and awaiting an answer: **#229 first** (smaller — copy and
button styling), then **#228**. Both are small once decided.

The precedent for how a decision unblocks work: [#223](https://github.com/jwh3times/magic-agenda/issues/223)
was `needs-triage` until the maintainer picked option A mid-session, after which it shipped as
v1.8.19 without further questions.

## Landmines this session hit — none of these are in the repo

1. **`gh` CLI does not exist in this remote environment.** `AGENTS.md` and `docs/agents/issue-tracker.md`
   assume it, and the `ship` skill's steps are written in `gh`. Use the `mcp__github__*` MCP tools
   instead (`ToolSearch` to load them). The skills' prose is correct for a local checkout; don't
   "fix" it.
2. **Node 26 is required** (`package.json` `engines: >=26`) and the container ships Node 22, so
   `npm ci` fails with `EBADENGINE`. Fix: `nvm install 26` (nvm is present but `NVM_DIR` may not
   resolve — after installing, `node_modules/.bin/*` works from the system Node for the scripts).
   **`node_modules` was initially absent/stale**, so a global Prettier 3.x silently reformatted a
   dozen unrelated files on the first `npm run format`. Always confirm `./node_modules/.bin/prettier`
   exists and matches `package-lock.json` before running the formatter, and check
   `git status --porcelain` afterwards for files you didn't touch.
3. **`src/data/snapshot.ts`'s `V` is one constant shared by all three localStorage envelopes**
   (board, settings, directory). Bumping it for a shape change in one drops the other two, and five
   test files hardcode `v: <n>` literals — a bump shows up as failures in `useSettings.test.ts`,
   `ProtectedRoute.test.tsx`, and `HomeRoute.test.tsx`, which look unrelated. This is now recorded
   in `AGENTS.md`, but the *fixture* churn is not.
4. **Recurrence test fixtures are systematically unrealistic about drafts.** `Board.openTask` merges
   the Series' Recurrence Rule onto an Occurrence's draft; many older tests built all-future drafts
   with no Rule, which the editor never produces. They passed only because the old code never read
   that field. `src/data/series.test.ts` now has an `editing()` helper that mirrors `openTask` —
   **use it for any new all-future test**, or you will test an input the app cannot produce.
5. **Running `code-reviewer` before committing paid for itself.** On #220 it caught a real defect in
   the first implementation (a routing predicate that conflated "user removed the Rule" with "the
   editor never had a Rule to show", which would have let a plain rename delete rows). Worth
   repeating on anything touching `src/data/series.ts`.

## Working agreement observed with this user

- They say **"pick up the next priority item"** → find it, implement it, stop before opening a PR.
- **"ship it"** → run `/ship` (docs refresh, changelog for the version the merge will mint, fast
  checks, push, open PR). Stop at PR open.
- **"merge"** → they want it merged; verify all checks green and `mergeable_state: clean` first,
  then merge, unsubscribe, and delete the check-in trigger.
- After opening a PR: subscribe via `subscribe_pr_activity` and arm an hourly `send_later` check-in;
  cancel both on merge.

## Suggested skills

- **`end-session`** — the most likely correct next move if the user does not supply a decision. This
  session produced discoveries (the landmines above) that belong in memory and `private/`, and it
  never ran. Note its own rules: it does not push, merge, or edit `AGENTS.md`/`README.md`/
  `ROADMAP.md`/`CHANGELOG.md`.
- **`ship`** — for any branch that becomes ready. Note it now checks open PRs for a competing claim
  on `$next` before writing the changelog section (that check shipped in v1.8.19).
- **`tdd`** — the repo is test-first for pure logic in `src/data` and `src/dnd`; #228's fix is
  exactly that shape.
- **`code-review`** or the `code-reviewer` subagent — before committing anything in the recurrence
  subsystem.
- **`domain-modeling`** — only if the user picks up #166 or #167, which are explicitly domain work.

## Verification commands that matter here

```bash
npm test                      # 798 tests, hermetic, ~60s
npx tsc -b                    # typecheck
npm run lint                  # oxlint
npm run format                # ALWAYS before codex:sync, never after
npm run codex:sync            # regenerate .claude/skills/ + .codex/agents/
npm run codex:check           # required CI job asserts this
node scripts/check-changelog.mjs
```

`Test`, `Build`, `Functions`, `RLS`, and `E2E` run in CI, not locally — do not claim a branch is
verified beyond the fast checks plus `npm test`.

## Pointers, not copies

- What shipped and why: `CHANGELOG.md` sections 1.8.16 / 1.8.18 / 1.8.19.
- Architecture and the reasoning behind it: `AGENTS.md` (canonical; `CLAUDE.md` is only an import).
- Domain vocabulary: `CONTEXT.md` — use its words (Recurring Series, Occurrence, Occurrence Date,
  Excluded Date), never `template`/`instance`, in issues and product copy.
- Field ownership rules: `docs/adr/0002-series-occurrence-field-ownership.md`.
- The recurrence fix's design: `src/data/series.ts` `planEndSeriesAt` docstring.
