# Magic Agenda

A tactile, multi-user task board — a draggable sticky‑note calendar that syncs across your devices.

[![CI](https://github.com/jwh3times/magic-agenda/actions/workflows/ci.yml/badge.svg)](https://github.com/jwh3times/magic-agenda/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

🔗 **Live:** [magicagenda.app](https://magicagenda.app)

Magic Agenda turns a desktop calendar/kanban board into a real product: sign up, get a private board
that persists and syncs, and organize tasks by dragging sticky notes across days and columns — in one
of three hand‑built themes.

## Features

- **Four views** — Calendar (month), Week, Agenda, and Kanban (To Do / In Progress / Completed). Set
  your default view in Settings — that's where you land when you open the app; whichever view you
  switch to during a session is remembered for that browser tab.
- **Three themes** — Cork (corkboard), Neon‑Brutalist, and Aurora‑Glass — each with its own typography,
  shadows, and feel. Your choice persists.
- **Drag‑and‑drop** — reorder within a day/column and move tasks across days, the week, columns, and the
  inbox, with a floating drag ghost (powered by [dnd‑kit](https://dndkit.com)).
- **Rich task editor** — title, description, colour, category, checklist, status, schedule, an
  optional due time, and a pin toggle for priority.
- **Search & filter** — by text, category, status, and a "📌 Pinned" quick filter; non‑matching
  cards hide live.
- **Recurring tasks** — daily / weekly / monthly with an interval and end date, materialized over a
  rolling 90‑day horizon, with **this‑occurrence vs. all‑future** edit and delete semantics.
- **Due times & priority pins** — give a task an optional time of day (shown as a card chip and
  sorted first in the Agenda) and pin the notes that matter most, with a themed visual on every
  card.
- **Overdue handling** — unfinished past‑due tasks get a red accent, a count badge on the Today
  button, and an Agenda "Overdue" group with one‑click "Move all to today".
- **Export & import** — back up your whole board as JSON from Settings → Data, and import it back
  in additively (fresh ids, recurring series links preserved).
- **Accounts & sync** — email/password and Google sign‑in; every task is private to you via Postgres
  Row‑Level Security; optimistic updates with rollback.
- **Works on your phone** — responsive layouts for every view (stacked week, swipeable kanban,
  collapsible inbox, bottom‑sheet editor) and long‑press touch drag‑and‑drop.

## Tech stack

| Area        | Choice                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------- |
| Frontend    | [Vite](https://vite.dev) + [React](https://react.dev) 19 + TypeScript (SPA, React Router) |
| Backend     | [Supabase](https://supabase.com) — Postgres + Auth + Row‑Level Security                   |
| Drag & drop | `@dnd-kit/core` + `@dnd-kit/sortable`                                                     |
| Hosting     | [Cloudflare Pages](https://pages.cloudflare.com) (static SPA, auto‑deploy from GitHub)    |
| Tests       | [Vitest](https://vitest.dev) + Testing Library (jsdom)                                    |

## Getting started

### Prerequisites

- **Node.js 26+** and npm
- A free **Supabase** project (for the database + auth)

### 1. Clone & install

```bash
git clone https://github.com/jwh3times/magic-agenda.git
cd magic-agenda
npm install
```

### 2. Set up the database

The schema (tables, indexes, RLS policies, triggers) lives in [`supabase/migrations/`](./supabase/migrations).
Apply it to your Supabase project with the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

> `<your-project-ref>` is the subdomain of your project URL: `https://<ref>.supabase.co`.

### 3. Configure environment

Copy the example env file and fill in your project's **URL** and **anon key**
(Supabase dashboard → Project Settings → API):

```bash
cp .env.example .env.local
```

```dotenv
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

> The anon key is **public by design** — it ships in the browser bundle and is safe because RLS
> default‑denies. Never put the **service‑role key** in the app. See [SECURITY.md](./SECURITY.md).

### 4. Configure auth

In the Supabase dashboard → **Authentication → URL Configuration**, add `http://localhost:5173/**`
to the redirect allow‑list. For Google sign‑in, enable the Google provider and add a Google Cloud
OAuth client whose redirect URI is `https://<ref>.supabase.co/auth/v1/callback`.

### 5. Run

```bash
npm run dev      # start the dev server at http://localhost:5173
```

## Scripts

| Command                | Description                                   |
| ---------------------- | --------------------------------------------- |
| `npm run dev`          | Start the Vite dev server                     |
| `npm run build`        | Type‑check and build for production (`dist/`) |
| `npm run preview`      | Preview the production build locally          |
| `npm test`             | Run the test suite once                       |
| `npm run test:watch`   | Run tests in watch mode                       |
| `npm run lint`         | Lint with ESLint                              |
| `npm run format`       | Format with Prettier                          |
| `npm run format:check` | Check formatting without writing (run in CI)  |

## Project structure

```
src/
├─ auth/         AuthProvider + ProtectedRoute
├─ components/   Board, views (Calendar/Week/Agenda/Kanban), TaskEditor, Toolbar, …
├─ data/         useTasks / useSettings hooks, mappers, selectors, filters, recurrence
├─ dnd/          pure reorder logic (unit‑tested) + dnd‑kit wiring
├─ lib/          supabase client, date + id helpers
├─ pages/        Login, AuthCallback, BoardPage
├─ theme/        constants, per‑theme tokens, card styles, ThemeProvider
└─ types/        domain + generated database types
supabase/migrations/   SQL schema (CLI‑managed)
design/                the original prototype (reference only — not built)
```

## Architecture notes

- **Pure SPA + Supabase** — the browser talks directly to Supabase over HTTPS; there is no server of
  our own. Cloudflare Pages serves static assets.
- **Per‑user isolation via RLS** — every table has policies scoped to `auth.uid() = user_id`.
- **`'inbox'` ↔ `NULL`** — unscheduled tasks use the `'inbox'` sentinel in app/DnD logic and map to a
  `NULL` `day` only at the database boundary.
- **Recurrence** uses a hidden "template" row plus materialized instance rows; deleted occurrences are
  remembered in a skip‑list so they're never regenerated.

## Deployment

[Cloudflare Pages](https://pages.cloudflare.com) builds and deploys `main` (framework preset **Vite**,
build `npm run build`, output `dist`). The `VITE_SUPABASE_*` variables are set in the Pages project for
Production and Preview; `public/_redirects` provides the SPA deep‑link fallback, and `public/_headers`
sets security response headers (Content‑Security‑Policy, `X-Frame-Options`, `nosniff`, `Referrer-Policy`).

Database migrations apply to production automatically: merging a change under `supabase/migrations/` to
`main` triggers the **Deploy Migrations** workflow (`supabase db push`).

`main` is **protected** — it's PR‑only (no direct pushes), and a PR can't merge until the CI checks
(`Format`, `Test`, `Build`) and CodeQL pass. Because Cloudflare deploys `main`, **production only ships
after a PR closes with all checks green.** See [CONTRIBUTING.md](./CONTRIBUTING.md) for the workflow.

Every merge to `main` also creates a GitHub Release tagged `v<major>.<minor>.<build>`. The build number
auto-increments per major/minor line; new major/minor lines may start at `x.y.0`.

## Roadmap

Planned features and fixes are tracked in [ROADMAP.md](./ROADMAP.md); shipped work lives in the
[changelog](./CHANGELOG.md).

## Contributing

Contributions welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). By participating you agree to the
[Code of Conduct](./CODE_OF_CONDUCT.md). For help, bug reports, and feature requests, see
[SUPPORT.md](./SUPPORT.md); for vulnerability reports, see [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © Jerry Holland. See the [changelog](./CHANGELOG.md) for release history.
