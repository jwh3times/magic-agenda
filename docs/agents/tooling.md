# Agents, skills, and docs automation

Which documents and agent-facing trees a change has to keep aligned, and which of them are
generated. Read before editing anything under `.claude/`, `.agents/`, or `.codex/`.

`AGENTS.md` is the **canonical agent guide**; `CLAUDE.md` is only an `@AGENTS.md` import so Claude Code
loads the same content. Edit `AGENTS.md` — never duplicate content into `CLAUDE.md`.

The project subagent `code-reviewer` lives in `.claude/agents/`: it reviews diffs against the
app/DB boundary, RLS, recurrence, and DnD correctness rules before merging. Whatever runs the change,
keep `AGENTS.md`, `README.md`, and `CHANGELOG.md` aligned when it affects project behavior, commands,
architecture, or release notes. `ROADMAP.md` is a pointer to GitHub Issues and holds no item list to
update.

**Five workflow skills install from the shared `jwh3times/skills` repository:** `ship`,
`end-session`, `docs-updater`, `handoff`, and `lets-go`. Their bodies are identical in every
repository that installs them; what is particular to this one is in the settings files under
`docs/agents/` — `workspace.md`, `issue-tracker.md`, `human-follow-up.md`, `docs.md`, `releases.md`,
`ship.md`, and `handoffs.md` — which each skill's first step reads and, when one is missing,
proposes. Change behavior here by editing a setting; fix a skill body upstream, then reinstall:

```bash
npx skills add jwh3times/skills -s end-session -s handoff -s lets-go -s ship -s docs-updater -a codex --copy -y
npm run sync:agents
```

Never run `npx skills update`: it re-runs the install for every agent it detects, which links
`.claude/skills/<name>` back to its authored source instead of copying it.

- **`ship`** takes a finished branch to an open PR: it evaluates the release level, writes the
  changelog section for the version the merge will mint (backfilling builds that shipped without
  one), runs `docs-updater` on the branch's diff, runs the `Fast checks`, pushes, and opens or
  updates the PR. It stops at "PR open"; the maintainer merges.
- **`end-session`** closes a work session: issues and the board brought up to date, human
  follow-ups recorded, `docs-updater` run, `private/` reconciled, memory updated, and the local
  workspace audited against `workspace.md`'s never-remove and safe-to-remove lists. It never pushes
  the public repository; the companion is committed and pushed only through the shared companion
  commit procedure, with the maintainer's approval. A dated document under `private/` is
  **amended, never rewritten**.
- **`docs-updater`** finds where the docs and the code disagree and fixes the docs, following the
  `Doc map` in `docs/agents/docs.md` — what each document owns, when it changes, and which are
  frozen. It replaced the `docs-updater` subagent.
- **`handoff`** and **`lets-go`** (both user-invoked) carry a session between machines through a
  shared Handoffs folder. `/handoff` audits for work not merged to `origin/main`, writes a handoff
  document, marks it active in the folder's `handoff_map.json`, and runs `end-session`; `/lets-go`
  resumes this repository's active handoff after checking its claims against the checkout, and
  clears the entry so it is consumed once. `.agents/skills/handoff/handoff-map.mjs` is the only
  writer of the map. How the folder reaches a machine — a synced folder, or a local mirror pushed
  through the `proton-drive` CLI — is that machine's config (`~/.config/handoffs/config`; see
  `.agents/skills/handoff/machine-config.md`), not this repository's. This `/handoff` is the machine
  handoff, not `mattpocock/skills`' portable-file one that `ask-matt` describes.

## Two authored trees, two generated trees — opposite directions on purpose

Both Claude Code and Codex are used on this repo, and they read different files. Rather than keep
hand-written copies that drift, each generated tree is produced from an authored one by
`scripts/sync-agents.mjs` (`npm run sync:agents`). The script is shared verbatim with the
maintainer's other repositories — change it in one and copy it to all, never fork it here:

| Authored (edit this)    | Generated (never edit)   | How                                            |
| ----------------------- | ------------------------ | ---------------------------------------------- |
| `.claude/agents/<n>.md` | `.codex/agents/<n>.toml` | frontmatter + body -> `developer_instructions` |
| `.agents/skills/<n>/**` | `.claude/skills/<n>/**`  | copied byte-for-byte; `SKILL.md` gets a banner |

The two rows run in **opposite** directions, and that asymmetry is deliberate, not a typo: each
authored tree is wherever something actually writes to it. Subagents are hand-written under
`.claude/agents/`. Skills are installed by a skills-sync tool (e.g. a Matt Pocock skills sync) that
writes real files straight into `.agents/skills/<n>/` — making that side authored is what keeps
installing or updating a skill a one-way write, with nothing to hand-copy back into `.claude/`.
Claude Code itself only discovers skills by scanning `.claude/skills` from the cwd up to the repo
root, so that side has to be the generated one. Both generated trees are **committed**, so a Codex
or Claude session gets them without running Node.

**Skills used to run the same direction as subagents** (`.claude/skills/` authored,
`.agents/skills/` generated), bridged by OS symlinks so both paths resolved to the same bytes. That
broke for two independent reasons, hit for real in this repo once a skills-sync tool wrote into
`.agents/skills/<n>/` and symlinked `.claude/skills/<n>` back to it:

1. `readdirSync(dir, { withFileTypes: true })` reports a symlinked directory as
   `isSymbolicLink()`, not `isDirectory()`. The sync script's directory walker filtered on
   `isDirectory()`, so it treated every symlinked skill as a single file and handed it to
   `readFileSync` — which throws `EISDIR` once it resolves through the link to a directory.
2. `git config core.symlinks` is `false` on a stock Windows checkout (no symlink privilege), so Git
   cannot store a symlink as a symlink: `git add` on one walks through it and stages the target's
   file contents under the link's path, silently duplicating every byte instead of recording a link.

**Never reintroduce a symlink under `.claude/skills/` or `.agents/skills/`** — either failure mode
comes back. `scripts/sync-agents.mjs` never follows a symlink: one in an authored tree is an error,
and one in a generated tree is reported by `--check` as orphaned and removed (the link, not its
target) by a sync, so a repeat shows up loudly instead of as one of the two failures above.

Rules for this pipeline:

- **`.claude/agents/` and `.agents/skills/` are authored — edit those directly.** `.codex/agents/`
  and `.claude/skills/` are generated — never hand-edit them, run `npm run sync:agents`. The script
  owns every byte in both generated trees, so a file with no source is deleted as stale.
- **Never "adapt" skill prose in transit.** A blind `CLAUDE.md` -> `AGENTS.md` substitution is what
  once produced "edit `AGENTS.md`, never add content to `AGENTS.md`". References to `CLAUDE.md` are
  correct as written for both tools, because it really does exist and really is just an import.
- Of the Claude-only frontmatter keys, only the read-only fact is translated: `tools:` without any
  file-writing tool becomes `sandbox_mode = "read-only"`. `model:`, `color:`, and the tool list
  itself are dropped (Claude's tiers name no Codex model; Codex uses
  `agents.default_subagent_model`). The instruction body is a TOML `'''` literal string, falling
  back to an escaped `"""` string only when the body contains `'''` or ends in a quote.
- A generated `SKILL.md` carries its banner as a YAML comment on line 2 — line 1 stays `---`, so the
  frontmatter still parses — rather than as prose after the closing `---`; every other file in a
  skill directory (`references/*.md`, `scripts/*.sh`, `agents/*.yaml`, …) is copied byte-for-byte.
- **Run `npm run format` before `npm run sync:agents`, never after.** The formatter's globs reached
  `**/*.md` in v1.4.4, which is the situation this bullet used to describe hypothetically. Neither
  _generated_ tree is formatted — `.codex/` and `.claude/skills/` are both `.prettierignore`'d, so a
  generated file is never rewritten out from under the script — but `.claude/agents/<n>.md` **is**
  formatted and is the source for `.codex/agents/<n>.toml`. Sync first and the TOML embeds the
  pre-format body, so the next format pass makes it stale and the `Agents` job fails. Landing the
  markdown glob updated exactly one generated file for this reason.
- **`.agents/skills/` is `.prettierignore`'d even though it is authored**, which looks inconsistent
  with the table above until you check `skills-lock.json`: those files are vendored from
  `mattpocock/skills` and `jwh3times/skills` with a `computedHash` per skill. Formatting them would rewrite third-party
  content the installer expects byte-for-byte, so every skill update would churn and fight the
  formatter. Authored-vs-generated and ours-vs-vendored are separate axes; this directory is
  authored _and_ vendored, and the vendoring wins. `private/` is ignored for a different reason —
  git-ignored and local-only, so CI never sees it and formatting only rewrites security-review
  evidence in the maintainer's checkout.
- The required **`Agents` CI job** runs `node --test` over the shared scripts' own `node:test`
  suites (excluded from Vitest); `npm run sync:agents:check`, which fails on any missing,
  hand-edited, or orphaned generated file; `npm run check:claude-md`
  (`scripts/check-claude-md.mjs`), which asserts `CLAUDE.md` still contains its `@AGENTS.md`
  import line; and `npm run lint:agents` (`scripts/lint-agent-neutrality.mjs`, shared verbatim like
  `sync-agents.mjs`), which fails on wording one tool cannot follow and on links that break once a
  file is mirrored. The `CLAUDE.md` check is repository-specific, so it lives outside the shared
  scripts; its Vitest test is `scripts/check-claude-md.test.mjs`.
- `skills-lock.json` at the repo root is the skills-sync tool's own lockfile (source repo + commit
  hash per installed skill) — committed as installer metadata, untouched by `sync-agents.mjs`.

Completed implementation plans are archived under `docs/plans/` and `docs/specs/` (see
`docs/README.md`) — they are dated historical records of shipped work, not living documentation;
do not update them to match current code. `docs/runbooks/` is the exception: those are **living**
operational procedures and must be updated in the same PR as whatever they describe.
