# Agents, skills, and docs automation

Which documents and agent-facing trees a change has to keep aligned, and which of them are
generated. Read before editing anything under `.claude/`, `.agents/`, or `.codex/`.

`AGENTS.md` is the **canonical agent guide**; `CLAUDE.md` is only an `@AGENTS.md` import so Claude Code
loads the same content. Edit `AGENTS.md` — never duplicate content into `CLAUDE.md`.

Project subagents live in `.claude/agents/`: `docs-updater` (keeps `AGENTS.md`,
`README.md`, `CHANGELOG.md` in sync with the code) and `code-reviewer` (reviews diffs
against the app/DB boundary, RLS, recurrence, and DnD correctness rules before merging). The `ship`
skill (`.claude/skills/ship/`) takes a finished branch to an open PR — it refreshes the docs (via
`docs-updater`), evaluates the release level from shipped compatibility and user impact, gets
confirmation before starting a major/minor line, records the resulting version in `CHANGELOG.md`,
runs the fast checks (`format:check`, `lint`, `tsc -b`), pushes, and opens or updates the PR; run it
with "ship it" when a branch is ready. Whether or not you use it, keep `AGENTS.md`, `README.md`,
and `CHANGELOG.md` aligned when a change affects project behavior, commands, architecture, or
release notes. `ROADMAP.md` is a pointer to GitHub Issues and holds no item list to update.

The `end-session` skill (authored at `.agents/skills/end-session/`) is the other bookend: it closes
a work session by moving knowledge out of the conversation and junk out of the checkout — GitHub
issues brought up to date per `docs/agents/`, `private/` reconciled, memory updated, and the local
workspace audited. It is deliberately **not** a shipping skill: it never pushes, merges, or edits
`AGENTS.md` / `README.md` / `ROADMAP.md` / `CHANGELOG.md`, because those belong to the PR that
changed the code. Run `/ship` first if a branch is still in flight, then `end-session`. It carries
**one narrowly named exception** to "never push": the private companion at `private/` may be
committed and pushed to its own `main`, and only after its staged diff is reviewed, a secret scan
passes, GitHub re-reports the remote as `PRIVATE`, and the maintainer explicitly approves — that
push is what makes a session's private conclusions reach the next machine. The public
application repository is never pushed by it. Two of its
rules are load-bearing rather than stylistic: a dated document under `private/` is **amended, never
rewritten** (it is evidence from the state it reviewed), and the workspace pass carries an explicit
never-delete list. `.env.local` and `tests/e2e/.auth/` are git-ignored and the only
copy of what they hold, and `private/` is the only _local_ copy of its uncommitted work, so a
blanket sweep of ignored paths destroys them; `supabase/.temp/` (all
but its regenerable `pgdelta/` cache) and `supabase/.branches/` are on the same list for a
different reason — that's Supabase CLI link state, so deleting it doesn't destroy data but does
unlink the project, and relinking needs the database password.

The `handoff` and `lets-go` skills (authored at `.agents/skills/`, both user-invoked) carry a
session between the maintainer's Windows and Fedora machines through Proton Drive. `/handoff`
audits for work not merged to `origin/main` and alerts on it. It then writes a handoff document to
the `Handoffs` folder, marks it active in that folder's `handoff_map.json`, and runs `end-session`.
`/lets-go` reads the map, resumes this repository's active handoff after checking its claims
against the checkout, and sets the entry to `null` so the handoff is consumed once.
`.agents/skills/handoff/scripts/handoff-map.mjs` is the only writer of the map. It resolves the
folder (`HANDOFFS_DIR`, else `~/Proton Drive/jwh3times/My Files/Documents/Handoffs` on either OS),
matches the map key case- and punctuation-insensitively, and refuses to run beside Proton Drive
sync-conflict copies. `handoff` began as a vendored `mattpocock/skills` skill. It is now ours and
has left `skills-lock.json`, so a skills sync will not overwrite it.

## Two authored trees, two generated trees — opposite directions on purpose

Both Claude Code and Codex are used on this repo, and they read different files. Rather than keep
hand-written copies that drift, each generated tree is produced from an authored one by
`scripts/sync-codex.mjs` (`npm run codex:sync`):

| Authored (edit this)    | Generated (never edit)   | How                                            |
| ----------------------- | ------------------------ | ---------------------------------------------- |
| `.claude/agents/<n>.md` | `.codex/agents/<n>.toml` | frontmatter + body -> `developer_instructions` |
| `.agents/skills/<n>/**` | `.claude/skills/<n>/**`  | copied verbatim, plus a "generated" banner     |

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
comes back. `scripts/sync-codex.mjs`'s walker now throws immediately on any symlink it finds, in
either tree, specifically so a repeat shows up as a loud error instead of one of the two failures
above.

Rules for this pipeline:

- **`.claude/agents/` and `.agents/skills/` are authored — edit those directly.** `.codex/agents/`
  and `.claude/skills/` are generated — never hand-edit them, run `npm run codex:sync`. The script
  owns every byte in both generated trees, so a file with no source is deleted as stale.
- **Never "adapt" skill prose in transit.** A blind `CLAUDE.md` -> `AGENTS.md` substitution is what
  once produced "edit `AGENTS.md`, never add content to `AGENTS.md`". References to `CLAUDE.md` are
  correct as written for both tools, because it really does exist and really is just an import.
- The Claude-only frontmatter keys are translated, not dropped silently: `tools:` without any
  file-writing tool becomes `sandbox_mode = "read-only"`, and `model:` is recorded in a comment as
  not carried over (Claude's tiers name no Codex model; Codex uses `agents.default_subagent_model`).
- A generated `SKILL.md` carries its banner as a YAML comment on line 2 — line 1 stays `---`, so the
  frontmatter still parses — rather than as prose after the closing `---`; every other file in a
  skill directory (`references/*.md`, `scripts/*.sh`, `agents/*.yaml`, …) is copied byte-for-byte.
- **Run `npm run format` before `npm run codex:sync`, never after.** The formatter's globs reached
  `**/*.md` in v1.4.4, which is the situation this bullet used to describe hypothetically. Neither
  _generated_ tree is formatted — `.codex/` and `.claude/skills/` are both `.prettierignore`'d, so a
  generated file is never rewritten out from under the script — but `.claude/agents/<n>.md` **is**
  formatted and is the source for `.codex/agents/<n>.toml`. Sync first and the TOML embeds the
  pre-format body, so the next format pass makes it stale and the `Agents` job fails. Landing the
  markdown glob updated exactly one generated file for this reason.
- **`.agents/skills/` is `.prettierignore`'d even though it is authored**, which looks inconsistent
  with the table above until you check `skills-lock.json`: those files are vendored from
  `mattpocock/skills` with a `computedHash` per skill. Formatting them would rewrite third-party
  content the installer expects byte-for-byte, so every skill update would churn and fight the
  formatter. Authored-vs-generated and ours-vs-vendored are separate axes; this directory is
  authored _and_ vendored, and the vendoring wins. `private/` is ignored for a different reason —
  git-ignored and local-only, so CI never sees it and formatting only rewrites security-review
  evidence in the maintainer's checkout.
- The required **`Agents` CI job** runs `npm run codex:check`, which fails on any missing, hand-edited,
  or stale generated file, and also asserts `CLAUDE.md` still contains its `@AGENTS.md` import line.
  Pure logic in the script is unit-tested in `scripts/sync-codex.test.mjs`.
- `skills-lock.json` at the repo root is the skills-sync tool's own lockfile (source repo + commit
  hash per installed skill) — committed as installer metadata, untouched by `sync-codex.mjs`.

Completed implementation plans are archived under `docs/plans/` and `docs/specs/` (see
`docs/README.md`) — they are dated historical records of shipped work, not living documentation;
do not update them to match current code. `docs/runbooks/` is the exception: those are **living**
operational procedures and must be updated in the same PR as whatever they describe.
