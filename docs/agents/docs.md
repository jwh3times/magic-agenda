# Docs

Settings the shared `docs-updater`, `end-session` and `open-pr` skills read (installed from
`jwh3times/skills`). Each `##` heading is one setting.

## Doc map

- `AGENTS.md` — the canonical agent guide and a map, not a manual: commands, the release rules
  summary, the app/DB boundary, the schema workflow, and pointers to the area guides. Area detail
  belongs in the guide. **When:** an npm script is added or renamed (Commands); CI or the release
  process changes (the "Required checks and releases" summary); a migration changes a convention
  ("When changing the schema", "App / DB boundary conventions"); `src/data/mappers.ts` or
  `src/types/task.ts` changes a boundary convention; a page, view or major component lands under
  `src/pages/` or `src/components/` ("What this is"); an area guide is added or renamed (Area
  guides); a skill is added, removed or replaced ("Agent skills", "Agents and docs automation"); an
  MCP server is added to or removed from `.mcp.json` or `.codex/config.toml` ("MCP servers").
- `docs/agents/*.md` area guides — each the canonical account of one area: `auth`, `boards`,
  `labels`, `state-and-sync`, `recurrence`, `completion`, `drag-and-drop`, `ui`, `pwa-offline`,
  `testing`, `supabase-config`, `tooling`, `dev-flow`, `backups`, and the prose of `releases`.
  **When:** the area changes, in the same PR — a migration's policies, grants or lifecycle
  functions: `boards.md`; `src/data/recurrence.ts` or `src/data/series.ts`: `recurrence.md`;
  `src/dnd/`: `drag-and-drop.md`; `src/theme/`: `ui.md`; a workflow or required check:
  `releases.md` and `testing.md`; `.agents/`, `.claude/`, `.codex/`, `.mcp.json`,
  `scripts/sync-agents.mjs`, `scripts/node-test-suites.ts` or the `Agents` job in
  `.github/workflows/ci.yml`: `tooling.md`.
- `docs/agents/merging.md`, `docs/agents/local-runs.md`, `docs/agents/verification.md` — from open
  PR to finished merge and its follow-ups; running suites, lint and the local stack without a false
  result; proving a test, fix or claim. **When:** a lesson is learned that no script or test
  enforces, or a command, check or workflow they quote changes; `.prettierignore`, the `format`
  globs in `package.json`, `supabase/functions/deno.json` or `scripts/rls-up.mjs` change:
  `local-runs.md`; the browser channel in `playwright.config.ts` or ruleset 18273908 (its merge
  method, up-to-date rule or required checks) changes: `merging.md`.
- `docs/agents/` settings and conventions (`workspace`, `issue-tracker`, `human-follow-up`, `docs`,
  `releases`, `open-pr`, `handoffs`, `triage-labels`, `domain`, `test-proof`) — what the skills read.
  **When:** a convention, route or setting changes; for `test-proof`, a test runner, a `test` script
  or a test folder.
- `docs/agents/dependabot.md` — the settings the `dependabot` skill reads: the bumps reviewed in
  full, the install to reproduce, where each dependency is used, the stack facts a review must not
  get wrong, and the known fix for each kind of bump that has broken before. **When:**
  `.github/dependabot.yml`, a workflow's actions or `with:` inputs, a toolchain pin (`.nvmrc`) or a
  dependency family changes, or a fix to a Dependabot PR is confirmed.
- `docs/agents/guard.md` — the commands `scripts/guard.mjs` denies or asks about here, and the paths
  it protects, on top of its universal rules. **When:** a **Never run** command or a never-remove
  path in `workspace.md` changes, or a documented command starts or stops reaching production.
- `README.md` — human developers: overview, the feature list, the tech stack, setup, the commands
  table, the project structure tree, architecture notes, deploy notes. **When:** a setup step, npm
  script or deployment step changes; a user-visible feature changes (the feature list); a core
  technology or host changes (the tech stack); a top-level `src/` folder, a page in `src/pages/` or
  an Edge Function is added, renamed or removed (the tree); an architecture fact it restates changes
  (the architecture notes).
- `CONTRIBUTING.md` — the workflow and standards. **When:** the development flow, a required
  check, or the commands its job in `.github/workflows/ci.yml` runs change.
- `SUPPORT.md` — where to ask for help. **When:** the issue templates or the support route change.
- `CODE_OF_CONDUCT.md`, `LICENSE` — `owner-only`.
- `THIRD_PARTY_NOTICES.md` — the license notices of third-party files kept here. `owner-only`: report
  the change when a skill's source changes.
- `SECURITY.md` — the security model and the reporting route. **When:** a load-bearing boundary it
  describes (RLS, response headers, auth, backups, branch protection and the bypass actors of
  `main`'s ruleset 18273908) or the reporting route changes.
- `ROADMAP.md` — a pointer to GitHub Issues and the board; it lists nothing. **When:** where planned
  work lives changes.
- `docs/README.md` — the docs index and each folder's lifecycle. **When:** a folder under `docs/` is
  added or its lifecycle changes.
- `docs/runbooks/*.md` — living operational procedures, trusted under pressure. **When:** the
  system a runbook describes changes, in the same PR.
- `.github/PULL_REQUEST_TEMPLATE.md` — the PR body's sections. **When:** the development flow's
  linking rule changes.
- `.claude/agents/code-reviewer.md` — the reviewer subagent's correctness rules. **When:** the
  app/DB boundary, RLS, recurrence or drag-and-drop rules it reviews against change.
- `CHANGELOG.md` — release notes, one dated section per merge, stamped by `version.yml` after each
  merge. `frozen`: a branch's own entries never go here; it edits only the policy text at the top,
  or adds the backfill section `releases.md` describes.
- `changelog.d/README.md` — how a branch writes its fragment, and what the stamp does with it after
  the merge. **When:** the fragment format, `scripts/stamp-changelog.mjs` or the stamp step in
  `.github/workflows/version.yml`, or the fragment rules in `scripts/check-changelog.mjs` change.
- `changelog.d/*.md` other than `README.md` — the branch's changelog fragment, one per branch.
  `ship-owned`.
- `CLAUDE.md` — only an `@AGENTS.md` import; `npm run check:claude-md` fails without it. `frozen`.
- `CONTEXT.md` — the domain glossary, maintained through `domain-modeling` (`docs/agents/domain.md`).
  `frozen` for this skill: report a term the code contradicts instead of editing it.
- `docs/adr/*.md` — accepted decisions, superseded only by another ADR. `frozen`.
- `.out-of-scope/*.md` — rejected enhancement requests, one file per concept, kept by `/triage`
  (`.agents/skills/triage/OUT-OF-SCOPE.md`). `frozen` for this skill.
- `docs/plans/`, `docs/specs/`, `docs/superpowers/` — dated historical records. `frozen`.
- `docs/research/*.md` — dated investigations, superseded by later work. `amend-only`.
- `design/` — the reference-only prototype. `frozen`.
- `.agents/skills/*/**` — skills, mirrored to `.claude/skills/`: the `mattpocock/skills` set and the
  skills from `jwh3times/skills` that the `shared-skills` block in `AGENTS.md` installs, all
  vendored (`skills-lock.json`). `frozen`. **When:** a skill is added, removed or replaced:
  `docs/agents/tooling.md` and `AGENTS.md`.
- `private/README.md` — the companion's index: `Last reconciled`, the `Repository state` line, where
  work is tracked, the current security and operational register, and its document map. **When:**
  every reconciliation (the date and the state line); an accepted risk changes, closes or gains an
  issue (the register); a new dated document lands (its document map). Never a shipped list or a
  next-work ordering: those live in issues and on the board.
- `private/YYYY-MM-DD-*.md` — dated evidence: security reviews, decision records, threat models.
  `amend-only`: extend the amendment section, never rewrite the body. Create one only for a new
  review or decision, never for session notes.
- `private/**/*.md` otherwise — confidential procedures and evidence, under
  `private/OPERATING-POLICY.md`. **When:** a private procedure changes.

**Never in public docs:** the companion's contents (threat models, accepted risks, security reviews,
recovery material); a backlog, status list, shipped-items list or build-order table (GitHub owns
work state); credential values.

## Drift probes

- Migrations: `supabase/migrations/*.sql`
- Pages: `src/pages/*.tsx`
- Mapper conventions: `'inbox'|order_index` in `src/data/mappers.ts`
- Themes: `cork|brutal|glass` in `src/theme/themeConf.ts`
- npm scripts: `scripts` in `package.json`
- CI jobs: the keys under `jobs:` in `.github/workflows/ci.yml`
- Required status checks: `gh api repos/jwh3times/magic-agenda/rules/branches/main`

## Docs validation

- `node scripts/check-docs.mjs`
- `npm run format:check` — Prettier covers every Markdown file outside `.prettierignore`.
- `npm run check:claude-md`
