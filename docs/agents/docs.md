# Docs

Settings the shared `docs-updater`, `end-session` and `ship` skills read (installed from
`jwh3times/skills`). Each `##` heading is one setting.

## Doc map

- `AGENTS.md` — the canonical agent guide and a map, not a manual: commands, the release rules
  summary, the app/DB boundary, the schema workflow, and pointers to the area guides. Area detail
  belongs in the guide. **When:** an npm script is added or renamed (Commands); CI or the release
  process changes (the "Required checks and releases" summary); a migration changes a convention
  ("When changing the schema", "App / DB boundary conventions"); `src/data/mappers.ts` or
  `src/types/task.ts` changes a boundary convention; a page, view or major component lands under
  `src/pages/` or `src/components/` ("What this is"); an area guide is added or renamed (Area
  guides); a skill is added, removed or replaced ("Agent skills", "Agents and docs automation").
- `docs/agents/*.md` area guides — each the canonical account of one area: `auth`, `boards`,
  `labels`, `state-and-sync`, `recurrence`, `completion`, `drag-and-drop`, `ui`, `pwa-offline`,
  `testing`, `supabase-config`, `tooling`, `dev-flow`, `backups`, and the prose of `releases`.
  **When:** the area changes, in the same PR — a migration's policies, grants or lifecycle
  functions: `boards.md`; `src/data/recurrence.ts` or `src/data/series.ts`: `recurrence.md`;
  `src/dnd/`: `drag-and-drop.md`; `src/theme/`: `ui.md`; a workflow or required check:
  `releases.md` and `testing.md`; `.agents/`, `.claude/`, `.codex/` or `scripts/sync-agents.mjs`:
  `tooling.md`.
- `docs/agents/` settings and conventions (`workspace`, `issue-tracker`, `human-follow-up`, `docs`,
  `releases`, `ship`, `handoffs`, `triage-labels`, `domain`) — what the skills read. **When:** a
  convention, route or setting changes.
- `README.md` — human developers: overview, the feature list, the tech stack, setup, the commands
  table, the project structure tree, architecture notes, deploy notes. **When:** a setup step, npm
  script or deployment step changes; a user-visible feature changes (the feature list); a core
  technology or host changes (the tech stack); a top-level `src/` folder, a page in `src/pages/` or
  an Edge Function is added, renamed or removed (the tree); an architecture fact it restates changes
  (the architecture notes).
- `CONTRIBUTING.md` — the workflow and standards. **When:** the development flow or a required
  check changes.
- `SUPPORT.md` — where to ask for help. **When:** the issue templates or the support route change.
- `CODE_OF_CONDUCT.md`, `LICENSE` — `owner-only`.
- `THIRD_PARTY_NOTICES.md` — the license notices of third-party files kept here. `owner-only`: report
  the change when a skill's source changes.
- `SECURITY.md` — the security model and the reporting route. **When:** a load-bearing boundary it
  describes (RLS, response headers, auth, backups) or the reporting route changes.
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
- `CHANGELOG.md` — release notes, one dated section per merge. `ship-owned`.
- `CLAUDE.md` — only an `@AGENTS.md` import; `npm run check:claude-md` fails without it. `frozen`.
- `CONTEXT.md` — the domain glossary, maintained through `domain-modeling` (`docs/agents/domain.md`).
  `frozen` for this skill: report a term the code contradicts instead of editing it.
- `docs/adr/*.md` — accepted decisions, superseded only by another ADR. `frozen`.
- `docs/plans/`, `docs/specs/`, `docs/superpowers/` — dated historical records. `frozen`.
- `docs/research/*.md` — dated investigations, superseded by later work. `amend-only`.
- `design/` — the reference-only prototype. `frozen`.
- `.agents/skills/*/**` — skills, mirrored to `.claude/skills/`: the `mattpocock/skills` set and
  `end-session`, `handoff`, `lets-go`, `ship` and `docs-updater` from `jwh3times/skills`, all
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
