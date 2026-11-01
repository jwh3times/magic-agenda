# Workspace

Settings the shared `end-session`, `handoff`, `lets-go`, `ship` and `docs-updater` skills read
(installed from `jwh3times/skills`; each skill's `settings/` folder defines them). Each `##` heading
is one setting.

## Private companion

`private/` — an independent Git repository (not a submodule), git-ignored here and cloned by
`npm run bootstrap:private`. `private/.git` existing is the test for "installed", not the directory.
Repository: `discover: git -C private remote get-url origin`. `private/README.md` indexes it and
`private/OPERATING-POLICY.md` binds it. Nothing in it — its contents — may enter this repository, an
issue, a PR, a log or a chat transcript; a bare commit SHA may.

## Safe-to-remove paths

- `test-results/`, `test-results-visual/`, `playwright-report/` — Playwright output. Traces in
  `test-results/` hold a bearer token for the E2E account: delete them, never attach them anywhere.
- `dist/` — build output (`npm run build`).
- `supabase/.temp/pgdelta/` — a regenerable schema-diff cache, and the only cache under
  `supabase/.temp/`.
- `*.tsbuildinfo` — the incremental typecheck cache; deleting it only makes the next `tsc -b` slow.

## Never-remove paths

- `.env.local` — local Supabase credentials; `.env.example` is a template, not a backup.
- `private/` — the companion checkout; its uncommitted work exists nowhere else.
- `tests/e2e/.auth/` — Playwright storage state for the E2E account.
- `supabase/.temp/` (all but `pgdelta/`) and `supabase/.branches/` — Supabase CLI link state.
  Deleting it unlinks the project, and relinking needs the database password.
- `node_modules/`, `supabase/functions/node_modules/` — reinstallable, but not cleanup.
- `.superpowers/` — workflow scratch that may still be mid-flight: ask first.

## Dev stack

`npx supabase status` shows the local stack; `npm run test:rls:down` stops it — only when this
session started it (`npm run test:rls:up`). Left running, the hermetic unit suite has something live
to reach by accident.

- **Never run:**
  - `npx supabase config push` — it deploys straight to production; the `Config` CI job previews it
    and the `Deploy Auth Config` workflow applies it on merge.
  - `npx supabase db reset --linked`, or any `--linked` write outside a documented runbook.
  - Any Supabase CLI command fed an empty stdin to "accept" prompts: they default to **yes** on EOF.

## Generated-config check

`npm run sync:agents:check && node scripts/check-skills.mjs`; regenerate with `npm run format`, then `npm run sync:agents` — in that
order, since `.claude/agents/*.md` is formatted and is the source for `.codex/agents/*.toml`. Run
it always: it is quick, and the required `Agents` check runs it.
