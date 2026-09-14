# AGENTS.md

This file provides guidance to coding agents when working with code in this repository. It holds
what applies to **every** change; the detail for one area lives in `docs/agents/`, listed under
[Area guides](#area-guides). Read an area's guide before changing that area.

## What this is

Magic Agenda is a drag-and-drop task board (calendar / week / agenda / kanban views — the four
`ViewName`s — recurring tasks, three visual themes) built as a pure React + TypeScript SPA on Supabase
(Postgres + Auth), deployed to Cloudflare Pages at [magicagenda.app](https://magicagenda.app). Pages
live in `src/pages/`: `BoardPage` (the app), `SettingsPage`, `Landing` (the public marketing page at
`/` for signed-out visitors), `Login`, `AuthCallback`, `AuthConfirm`, `ResetPassword`, and the static
legal pages `Privacy` / `Terms` (both rendered through `src/components/LegalLayout.tsx`).

## Commands

```bash
npm run dev            # Vite dev server at http://localhost:5173
npm run build          # tsc -b (typecheck) && vite build -> dist/
npm test               # vitest run (all tests once)
npm run test:watch     # vitest watch mode
npm run lint           # Oxlint, including TypeScript 7 type-aware linting
npm run lint:fix       # apply Oxlint's safe fixes
npm run format         # prettier --write (src, tests, scripts, and all .md; see .prettierignore)
npm run format:check   # prettier --check (the CI "Format" job runs this + lint)
npm run codex:sync     # regenerate Codex's agent config from .claude/
npm run codex:check    # verify it is in sync (the CI "Agents" job runs this)
npm run sync:main      # move public + private repos to main and fast-forward origin/main

# Run one test file or one test by name:
npx vitest run src/dnd/reorder.test.ts
npx vitest run -t "persists a cross-lane move"

# Database (Supabase CLI; project is linked):
npx supabase db push                                              # apply supabase/migrations/*
npx supabase gen types typescript --linked > src/types/database.types.ts
```

Tests are hermetic: `vite.config.ts` injects dummy `VITE_SUPABASE_*` env, so they never hit the real
project. Local dev needs a real `.env.local` (copy `.env.example`); `src/lib/supabase.ts` throws at
startup if the two `VITE_SUPABASE_*` vars are missing.

The lint policy, the three test layers, and what each CI check actually runs:
[Testing layers and lint policy](docs/agents/testing.md).

## Required checks and releases

`main` is **protected: PR-only, no direct pushes** (no admin bypass). Land changes via a branch and
a PR. Nine required status checks — `Format`, `Test`, `Build`, `Functions`, `Agents`, `Changelog`,
`Config`, `RLS`, `E2E` — plus the CodeQL gate must pass and review threads must be resolved; 0
approvals are required, so you can self-merge once green.

**Every merge to `main` is a release**, so every PR adds a `## [x.y.z]` section to `CHANGELOG.md`
naming the exact version its merge will mint (`node scripts/next-version.mjs`). The `ship` skill
automates the whole flow.

Version computation, the `Changelog` backfill rule, the two-PRs-one-version clash, the protected
`release/` branch namespace, and what each merge deploys:
[Required checks and releases](docs/agents/releases.md).

## Architecture (the parts that span multiple files)

**When changing production host redirects or checking preview routing**, read the
[canonical-host runbook](docs/runbooks/canonical-host.md). It describes account-level Bulk Redirects for the two production aliases while
keeping deployment preview subdomains direct. The redirect JSON records the desired configuration;
merge does not deploy it. Check #299 and run the live verifier before treating it as active.

Pure SPA -> Supabase, no server of our own. Postgres **Row-Level Security is the only authorization
boundary** (every table default-denies; `user_settings` scopes to `auth.uid() = user_id`, while
`tasks`, `labels`, and the Board tables all scope through **Membership** — see
[Boards](docs/agents/boards.md)); the anon key
is public by design.

This paragraph said `tasks` scoped to `user_id` until #180, which was left behind by the v1.2.78
authorization cutover and contradicted by [Boards](docs/agents/boards.md) itself. Worth noticing
how it survived: it is the summary, so it is what a reader trusts before they know enough to doubt
it, and nothing executable depends on it. `tasks.user_id` was never an authorization input under the
Board model, and the column itself is gone (#197).

Dated security reviews live in `private/` — **git-ignored here, and a separate private Git
repository of its own** (the "private companion"), so it is absent from a fresh clone until
`npm run bootstrap:private` installs it. They are where accepted risks and open findings are
recorded, with the reasoning. If that directory is present, read the newest one before changing
auth, RLS, realtime publication, or the Edge Functions; several non-obvious decisions in this repo
(the redirect allow-list wildcard, tokens in `localStorage`, the realtime DELETE fan-out) are
accepted risks argued there, not oversights to "fix". If it is absent, treat those decisions as
load-bearing and ask before changing them — **its absence never authorizes weakening a boundary**.

The companion's rules, in brief (`private/OPERATING-POLICY.md` is authoritative once it is
present): `private/.git` existing is the test for "installed", not the directory existing; pull it
`--ff-only` at the start of a session before trusting its index; never force-push it or
auto-resolve a divergence; and nothing in it — content, remote URL — may enter this repository, an
issue, a PR, a log, or a chat transcript. **The one exception is the commit SHA of a push you just
made**, which the operating policy requires you to report so the maintainer can confirm the push
landed; a bare SHA of a repository they alone can read discloses nothing. Its staged diff is
likewise **inspected, not printed** — describe what changed and hand over the command, and the
maintainer reads it locally. Its durable records stay Markdown.
**1Password is the credential authority**, reached through the `op` CLI: `op://` secret
_references_ may cross into the companion's `onepassword/*.env.tpl` templates, but resolved values
may not appear in either repository. `private/` is `.prettierignore`d and outside every lint and
test project, so the public checks never see it. Contributors without access to the companion
work from public code and docs alone; see `docs/runbooks/maintainer-workstation-recovery.md` for
what a maintainer does on a new machine.

### Area guides

Each file under `docs/agents/` is the canonical account of one area. Read the guide before changing
the area it covers; do not rely on this page's summaries for it.

- [**Auth**](docs/agents/auth.md) — `src/auth/`, the blocking emailed-token bootstrap in `public/`,
  the `authGateway` seam (the only module that may call `supabase.auth`), PKCE vs. `#access_token`
  fragments, single-use email-token redemption and the session-fixation guard, and the two-factor
  step-up gate.
- [**Boards, membership, and account administration**](docs/agents/boards.md) — `boards` /
  `board_memberships` / `account_profiles`, the Membership-scoped policies and column grants,
  `create_board` / `handle_new_user` / `handle_account_deletion`, task attribution, admin roles and
  feature flags.
- [**Labels and the import/export file format**](docs/agents/labels.md) — Board-owned Label
  vocabulary, Owner-only management, the retired Category bridge, and `src/data/exportImport.ts`
  import planning.
- [**Client state and realtime sync**](docs/agents/state-and-sync.md) — which provider mounts where,
  `BoardPage` / `TaskBoardContext` ownership, `useSyncedTable` and its three adapters, offline
  snapshots and the `hasSession` write-gate.
- [**Recurrence**](docs/agents/recurrence.md) — hidden Series definitions, materialized Occurrences,
  the pure planners in `src/data/series.ts`, the `Task` union, and the Rule fields (weekdays, count,
  Excluded Dates).
- [**Completion**](docs/agents/completion.md) — the Workflow Status vocabulary,
  `completionDecision()`, the database lifecycle trigger that is the record, and durable Archive
  plus Completion History (Settings → History).
- [**Drag-and-drop**](docs/agents/drag-and-drop.md) — the pure decision modules, dnd-kit as an
  adapter, the keyboard bindings, and why the unfiltered board must be the one passed in.
- [**UI: responsive layout, dates, and theming**](docs/agents/ui.md) — `useIsMobile()` branching
  instead of media queries, the timezone context, the inline-style-object theme model, and the
  reference prototype.
- [**Installable PWA and offline read**](docs/agents/pwa-offline.md) — the hand-authored service
  worker, network-first navigation, what is never cached, the CSP in `public/_headers`, and the
  `localStorage` snapshot envelopes.
- [**Testing layers and lint policy**](docs/agents/testing.md) — the hermetic unit suite, the RLS
  integration project, Playwright E2E against a deployed build, explicit Data API grants, and
  `.oxlintrc.json`.
- [**When changing Supabase config**](docs/agents/supabase-config.md) — `supabase/config.toml` is
  production, the CLI-version wiring, the two auth email templates, and retiring an Edge Function.
- [**Agents, skills, and docs automation**](docs/agents/tooling.md) — the two authored trees and
  their generated mirrors, `npm run codex:sync`, and which documents a change must keep aligned.
- [**Backups**](docs/agents/backups.md) — the nightly encrypted dump, what the bundle must contain,
  and what a restore actually requires.

### Required human follow-up

Whenever completed agent work leaves a required human action, follow
[the human follow-up workflow](docs/agents/human-follow-up.md) before reporting completion:
record or update a private follow-up issue labeled `ready-for-human`, place it on the private
board, and publish cross-linked step-by-step instructions in the private wiki. Verify all three
surfaces; report any access blocker explicitly. The final summary or a temporary wizard is not
the durable record. Keep private identifiers and contents within private surfaces.

### App / DB boundary conventions: get these wrong and data breaks subtly

- **`'inbox'` <-> `NULL`**: the app `Task.day` is the literal `'inbox'` (unscheduled) or `'YYYY-MM-DD'`.
  The `'inbox'` sentinel stays everywhere in app/DnD logic and maps to a `NULL` `day` **only** in
  `src/data/mappers.ts`.
- **`order` is reserved SQL** -> the column is `order_index`; the app keeps `order`/`korder`.
- **Workflow Status vocabulary is translated at the seam**: the app uses `completed`, while the
  database's frozen token remains `done`. Checklist Step `done` is independent and is stored inside
  `checklist` JSON.
- These conversions live entirely in `mappers.ts` (`rowToTask` / `taskToRow`). Everything else works in
  app-domain `Task` objects (`src/types/task.ts`).

**Task content limits live in `src/data/taskLimits.ts` and database CHECK constraints (#290).**
Consult both when changing editor validation, import payloads, or Task persistence. The editor
counts Unicode code points for title/description fields, matching PostgreSQL `char_length`, and
`intendSave` blocks invalid drafts, including those loaded from old snapshots. Database constraints
remain the boundary for imports and callers that bypass the editor.

Checklist size means UTF-8 bytes of PostgreSQL's canonical `jsonb::text`, including JSON escaping
and spacing. `checklistBytes()` mirrors that representation for the persisted fields;
`tests/rls/task_content_limits.test.ts` compares it directly with PostgreSQL and checks INSERT/UPDATE
refusals and exact boundaries. Keep this measure stable: `pg_column_size` depends on TOAST
compression, so the same logical content can have different stored sizes. Unit and editor coverage
lives in `taskLimits.test.ts` and `TaskEditor.test.tsx`.

**Whole-Board Task reads use `src/data/loadBoardTasks.ts`** for both `useTasks.reload()` and
`DataSection` export. PostgREST can return success while capping rows, so the reader pages in stable
id order and checks exact counts and duplicate ids before publishing any rows. A failed or
inconsistent page returns no partial data. `useTasks` revokes its successful-load flag on every
reload, and Series plans can execute only after a complete authenticated load; offline snapshots
cannot authorize a definition deletion that cascades to unseen Occurrences. Pagination is not a
transactional snapshot: simultaneous edits with unchanged row counts can still race across pages.

## When changing the schema

Add a new file under `supabase/migrations/`. Migrations **auto-apply to production on merge to `main`**
via the `Deploy Migrations` workflow (`.github/workflows/deploy-migrations.yml`, which runs
`npx supabase db push`); run `npx supabase db push` yourself only to apply to a local/branch DB or to
get the schema in place before regenerating types. Regenerate `src/types/database.types.ts` with
`supabase gen types` once the schema is applied (`gen types --linked` reads the remote DB). Keep the
`mappers.ts` conventions above intact.
Prefer test-first for pure logic in `src/data` and `src/dnd` (these have thorough unit tests).

Two standing rules for any table in the `supabase_realtime` publication (today `tasks`,
`user_settings`, and `labels`): **never put a secret or semantically meaningful value in the primary key**, because
DELETE events are fanned out to every subscriber without an owner check (Postgres cannot check access
to an already-deleted row), and **never `disable row level security`** on one — that is the single
change that would escalate the leak from primary keys to full deleted rows. See the header comment on
`supabase/migrations/20260704090000_realtime_tasks.sql`.

**A `not null default` does not protect a multi-row insert, and the reason is PostgREST rather than
Postgres.** PostgREST unions the keys across the rows of one batch and sends an explicit `NULL` for
every row that omits one, so a batch where _some_ rows name a column is refused on that column's
NOT NULL rather than taking its default. The app never meets this — `taskToRow` names every column
on every row, and the generated `Insert` type is what keeps it honest — but a test fixture or a
one-off script that varies its payload per row will, and the failure names the column rather than
the batch. Measured while adding `recur_weekdays`; `tests/rls/recurrence_rule_columns.test.ts`
inserts one row per case for exactly this reason and says so.

## Testing layers

Three layers, and each exists because the one below it cannot reach the failure: `npm test`
(hermetic Vitest under jsdom, Supabase mocked), `npm run test:rls` (a separate Vitest project
against a real local stack — where the authorization boundary is actually exercised), and
`npm run test:e2e` (Playwright against a **real deployed build**, because `public/_headers` is
Cloudflare-specific and cannot be reproduced locally).

What belongs in each layer, the RLS structural/baseline split, the E2E preview-URL and
encrypted-trace machinery, the a11y baseline's strict-equality rule, and the explicit Data API
grants: [Testing layers and lint policy](docs/agents/testing.md).

## When changing Supabase config

`supabase/config.toml` and `supabase/templates/**` describe **production**, and merging to `main`
pushes them (`Deploy Auth Config`). Every edit there is a production change, not local scaffolding.
**Never run `supabase config push` locally** — it deploys straight to production, bypassing the PR
preview.

The `Config` preview job's exact invocation, the CLI-version wiring, the email templates'
constraints, and why deleting an Edge Function directory does not delete the function:
[When changing Supabase config](docs/agents/supabase-config.md).

## Agents and docs automation

`AGENTS.md` is the **canonical agent guide**; `CLAUDE.md` is only an `@AGENTS.md` import so Claude
Code loads the same content. Edit `AGENTS.md` — never duplicate content into `CLAUDE.md` — and put
area detail in `docs/agents/` rather than growing this page. Keep `AGENTS.md`, `README.md`, and
`CHANGELOG.md` aligned when a change affects project behavior, commands, architecture, or release
notes.

The project subagents, the `ship` and `end-session` skills, and the two authored trees whose
generated mirrors (`.codex/`, `.claude/skills/`) must never be hand-edited:
[Agents, skills, and docs automation](docs/agents/tooling.md).

## Backups

The free Supabase tier has **no automated backups**, so `.github/workflows/backup.yml` takes a
nightly logical dump, GPG-encrypted on the runner before upload. **Treat every artifact this repo
uploads as public**: never add a step that uploads anything unencrypted, and never echo dump
contents to the log.

What the bundle must contain, why each verification assertion exists, and what restoring actually
requires: [Backups](docs/agents/backups.md).

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for jwh3times/magic-agenda. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix), used as-is. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
