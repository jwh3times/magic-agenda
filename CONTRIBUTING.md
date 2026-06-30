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
2. Create a branch from `main` (e.g. `feat/week-view-keyboard-nav`).
3. Make your change with tests (see below).
4. Ensure everything is green locally — these mirror the required CI checks:
   ```bash
   npm run format:check && npm run lint   # the "Format" check
   npm test                               # the "Test" check
   npm run build                          # the "Build" check
   ```
5. Open a Pull Request against `main` and fill in the template. The **`Format`, `Test`, and `Build`**
   checks plus **CodeQL** must pass and any review threads must be resolved before it can merge — no
   approvals are required, so you can self‑merge once it's green.

## Standards

- **Tests are required.** Pure logic (`src/data`, `src/dnd`, `src/theme`) is unit‑tested with Vitest;
  prefer **test‑first** for new behaviour and bug fixes (write a failing test, then make it pass).
  Reproduce bugs with a failing test before fixing.
- **TypeScript strict** — no `any` escape hatches without good reason; `npm run build` type‑checks.
- **Formatting & linting** — Prettier + ESLint. Run `npm run format` before committing; `npm run
format:check` and `npm run lint` must both pass (together they are the CI `Format` check).
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

## Project layout

See [Project structure](./README.md#project-structure) in the README.

Questions? Open a [discussion or issue](https://github.com/jwh3times/magic-agenda/issues). Thank you!
