# Contributing to Magic Agenda

Thanks for your interest! This guide covers how to set up, make changes, and submit them.

By participating, you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Getting set up

Follow the [Getting started](./README.md#getting-started) section of the README (Node 26+, a Supabase
project, `.env.local`). Then:

```bash
npm install
npm run dev
```

## Workflow

`main` is protected: **no direct pushes** — every change lands through a Pull Request whose checks pass.

1. **Open an issue first** for non‑trivial changes so we can agree on the approach.
2. Create a branch from `main` (e.g. `feat/week-view-keyboard-nav`). Don't start the name with
   `release/` — that namespace is protected by a repository ruleset and the push will be rejected;
   use a prefix like `chore/release-vX.Y.Z` instead.
3. Make your change with tests (see below).
4. Ensure everything is green locally — these mirror the required CI checks:
   ```bash
   npm run format:check && npm run lint     # the "Format" check
   npm test                                 # the "Test" check
   npm run build                            # the "Build" check
   cd supabase/functions && deno test       # the "Functions" check (edge functions; must run from
                                            # inside supabase/functions — see below)
   ```
   Also add a `## [x.y.z]` changelog section for the version this merge will mint — run
   `node scripts/next-version.mjs` to get it (see [Versioning](#versioning)); the `Changelog` check
   verifies it.
5. Open a Pull Request against `main` and fill in the template. The **`Format`, `Test`, `Build`, and
   `Functions`** checks plus **CodeQL** must pass and any review threads must be resolved before it
   can merge — no approvals are required, so you can self‑merge once it's green. A **`Changelog`**
   check also runs on every PR (except Dependabot's), verifying the changelog names the version the
   merge will mint; add it to the required checks in branch protection to gate merges on it too.

## Versioning

Releases use three-part SemVer tags `v<major>.<minor>.<build>`, where the patch component is an
auto-incrementing build number. **Every merge to `main` is a release**: the `Version` workflow computes
the next version with [`scripts/next-version.mjs`](./scripts/next-version.mjs), tags the merge commit,
and creates a GitHub Release — and Cloudflare Pages deploys the same merge, so a tag and a production
deploy are one and the same.

For normal merges, leave `package.json` on the current major/minor line and the build increments
automatically. To start a new major or minor line, set `package.json` to `x.y.0` and match
`package-lock.json` (two spots: the top-level `version` and the `packages[""].version` entry — don't
touch dependency entries that happen to share the number); if no `v<x>.<y>.0` tag exists yet, the
workflow releases `v<x>.<y>.0` exactly and does not force it to `v<x>.<y>.1`.

### Changelog

Because every merge ships, each PR must add a **`## [x.y.z]` section naming the version its merge will
mint** to [CHANGELOG.md](./CHANGELOG.md). Compute that version with `node scripts/next-version.mjs` —
the same script the `Version` workflow uses — then add the section (grouped under Keep a Changelog
headings) and update the compare links at the bottom of the file. The **`Changelog` CI check** enforces
this: it fails any PR whose changelog doesn't name its target version. `## [Unreleased]` stays as a
header holding only work on a branch that hasn't merged yet (`No unreleased changes.` at rest).

Dependabot PRs are **exempt** from the `Changelog` check (a bot can't write a meaningful entry); their
versions are backfilled into the changelog the next time a human ships a branch. Agents can do this
whole flow — compute the version, write the entry, run the checks, open the PR — with the `ship` skill
(see [AGENTS.md](./AGENTS.md)).

## Standards

- **Tests are required.** Pure logic (`src/data`, `src/dnd`, `src/theme`) is unit‑tested with Vitest;
  prefer **test‑first** for new behaviour and bug fixes (write a failing test, then make it pass).
  Reproduce bugs with a failing test before fixing.
- **TypeScript strict** — no `any` escape hatches without good reason; `npm run build` type‑checks.
- **Formatting & linting** — Prettier + ESLint. Run `npm run format` before committing; `npm run
format:check` and `npm run lint` must both pass (together they are the CI `Format` check).
- **Line endings are LF everywhere**, enforced by `.gitattributes` — no editor or `core.autocrlf`
  configuration needed. If a checkout that predates `.gitattributes` shows Prettier line-ending
  failures, refresh it once with `git rm --cached -r . && git reset --hard`.
- **Styling model** — the UI uses per‑theme inline style objects (ported from the prototype), not a CSS
  framework. Match the surrounding code; keep theme branching in `src/theme`.
- **Commits** — clear, imperative messages ("Add week keyboard navigation"). Keep PRs focused.

## Conventions to honour

- **`'inbox'` ↔ `NULL`** — the `'inbox'` sentinel stays in app/DnD logic; map it to a `NULL` `day` only
  in the DB mappers (`src/data/mappers.ts`).
- **`order` is reserved SQL** → the column is `order_index`; `done` is derived from `status`, never
  stored. Reindex both source and destination on cross‑container moves.
- **`design/` is reference only** — the original prototype. Don't edit it or let formatters touch it
  (it's in `.prettierignore`).
- **Schema changes** go through a new file in `supabase/migrations/` (CLI‑managed) and **auto‑apply to
  production on merge** via the `Deploy Migrations` workflow; regenerate `src/types/database.types.ts`
  with `npx supabase gen types` once the schema is applied.

## Edge functions

Server-side code lives in `supabase/functions/` (Deno 2, not Node). Each function is a
directory with `handler.ts` (the exported, testable request handler) and `index.ts`
(just `Deno.serve(handler)`); shared helpers live in `supabase/functions/_shared/`.
Every function verifies the caller's JWT via `requireUser()` before doing anything,
and only uses the service-role key after that check.

- Test: `cd supabase/functions && deno test` (Deno only picks up the dir's deno.json from inside it; the CI `Functions` job does the same).
- Serve locally: `npx supabase start` (needs Docker), then `npx supabase functions serve <name>`.
- Deploy: automatic on merge to `main` via the `Deploy Functions` workflow.

Node tooling deliberately ignores this directory (`eslint.config.js` ignores,
Vitest `test.exclude`) — Deno code doesn't parse under the Node toolchain.

## Project layout

See [Project structure](./README.md#project-structure) in the README.

Questions? Open a [discussion or issue](https://github.com/jwh3times/magic-agenda/issues). Thank you!
