# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Planned features and fixes are tracked in [ROADMAP.md](./ROADMAP.md)._

### Added

- **Settings page** — a `/settings` route (gear button in the toolbar) with theme and
  default-view controls and Privacy/Terms links; built as a section registry that account,
  data, and preference features will extend.
- **Mobile‑responsive layout** — the board now adapts to phone‑width screens: the toolbar stacks into
  compact rows, Week view becomes a vertical day list, the month Calendar pans sideways at a readable
  width, Kanban columns swipe horizontally with snap points, and the Inbox docks full‑width below the
  board as a collapsible panel. The task editor opens as a bottom sheet and form fields use 16px text
  on phones so iOS Safari no longer zooms on focus. Layout branches on a new `useIsMobile()`
  matchMedia hook (`src/lib/useMediaQuery.ts`), since the inline‑style theming can't use CSS media
  queries. The shell also sizes with `100dvh` so the collapsing mobile URL bar no longer cuts off the
  bottom of the board.
- **Touch drag‑and‑drop** — dragging now works on touch screens: a long‑press (250ms) picks up a card
  while a plain swipe scrolls the board. Previously cards set `touch-action: none` and the pointer
  sensor treated any 6px touch movement as a drag, which made touch scrolling impossible.

### Fixed

- **Recurring‑occurrence drag no longer resurrects a copy** — moving a recurring instance to a
  different day used to re‑create a duplicate on its original day after reload (and delete/edit
  "all future" on a moved occurrence trimmed the series at the wrong boundary). Instances now record
  an immutable `recur_origin_day`; materialization, the delete skip‑list, series edit/delete scope,
  and the `tasks_recur_instance_uniq` index all key off the origin occurrence instead of the movable
  `day`. Existing instances are backfilled to `recur_origin_day = day`; any instance already moved,
  inboxed, or deleted‑while‑moved before this release has an unrecoverable origin and may regenerate
  a duplicate one final time.

### Security

- **Security response headers** — `public/_headers` (served by Cloudflare Pages) adds a
  Content‑Security‑Policy, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
  and a minimal `Permissions-Policy`. (#33)
- **Per‑user recurrence index** — `tasks_recur_instance_uniq` is now scoped by `user_id`
  (`(user_id, recur_parent_id, day)`), closing a theoretical cross‑tenant existence leak. (#33)

### Internal

- **Edge Function scaffolding** — `supabase/functions/` with a shared JWT-verification helper
  (`requireUser`), CORS handling, a `hello` template function, Deno tests in a new CI `Functions`
  job, and a `Deploy Functions` workflow that ships functions to production on merge to `main`.
- **Auto‑deploy migrations** — a `Deploy Migrations` GitHub Actions workflow applies Supabase migrations
  to production on merge to `main` (changes under `supabase/migrations/**`) via `supabase db push`. (#34)
- **Repo health** — added `CODEOWNERS` and a `FUNDING.yml` sponsor button. (#32)

## [1.1.1] - 2026-06-30

Maintenance release — dev‑toolchain upgrades and documentation. No user‑facing feature or behavior
changes.

### Internal

- **Vite 6 → 8, Vitest 3 → 4, `@vitejs/plugin-react` 4 → 6** — combined major dev‑toolchain upgrade.
  The three move in lockstep (plugin‑react 6 requires Vite `^8`; Vitest 4 spans the gap), so they were
  bumped atomically to avoid an unsatisfiable peer range in CI. Vite 8 is Rolldown‑powered and
  plugin‑react now drives React Refresh via Oxc. (#27)
- **`@supabase/supabase-js` 2.108 → 2.110** plus a follow‑up **Vite 8.1.0 → 8.1.1** patch. (#30)
- **Prettier 3.9.3 → 3.9.4.** (#23)
- **Dependabot** now runs on an explicit schedule (time/timezone) with PR labels, and a `vite`‑ecosystem
  group keeps the interdependent major bumps landing together. (#29, #27)

### Docs

- **Added [ROADMAP.md](./ROADMAP.md)** and normalized formatting across the project docs. (#28)

## [1.1.0] - 2026-06-29

Maintenance release — dependency and toolchain modernization. No user‑facing feature or behavior
changes; the app already ran cleanly on the new versions.

### Internal

- **React 18 → 19** — `react`, `react-dom`, and their `@types` upgraded together (one atomic bump, since
  the pair must move in lockstep); no source changes required (the app was already on `createRoot`). (#21)
- **TypeScript 5.9 → 6.0.** (#9)
- **ESLint 9 → 10** — `eslint`, `@eslint/js`, and `eslint-plugin-react-hooks` bumped atomically. (#20)
- **`@dnd-kit/sortable` 8 → 10.** (#11)
- **Test/lint tooling** — `jsdom` 25 → 29 (#10) and `globals` 15 → 17 (#6), plus a grouped batch of
  minor/patch updates. (#18)
- **CI on Node 26** with an `engines` field (`node >=26`) now declared; `actions/checkout` 4 → 7 and
  `actions/setup-node` 4 → 6. (#19, #2, #1)

## [1.0.1] - 2026-06-29

### Added

- **Legal pages** — Privacy Policy and Terms of Service, linked from the app. (#14)
- **Branding** — wordmark/logo, social (Open Graph / Twitter) meta tags, and app icons/favicons. (#15)

### Fixed

- **Theme and default‑view preferences now persist.** Changing the theme or default view updated local
  state but never reached the database: the Supabase `user_settings` upsert was built but never executed
  (a query builder only issues its request when awaited / `.then`‑ed), so the preference reset to Cork /
  Calendar on every reload. The write now fires and logs failures.
- **Larger logo** in the toolbar and on the login screen. (#16)

### Internal

- CI split into separate **Format / Test / Build** jobs; added Dependabot and a `CLAUDE.md` contributor
  guide.

## [1.0.0] - 2026-06-29

Initial public release — [magicagenda.app](https://magicagenda.app).

### Added

- **Accounts** — email/password and Google (OAuth) sign‑in via Supabase Auth, with route gating.
- **Per‑user data** — Postgres with Row‑Level Security; each user sees only their own tasks. A signup
  trigger seeds a `user_settings` row.
- **Views** — Calendar (month grid), Week, Agenda, and Kanban; the default view is persisted.
- **Themes** — Cork, Neon‑Brutalist, and Aurora‑Glass; the selected theme is persisted.
- **Drag‑and‑drop** — reorder within and move across days/weeks/columns/inbox (dnd‑kit), with a drag
  ghost and a 6px click‑vs‑drag threshold.
- **Task editor** — title, description, colour, category, checklist, status, and schedule.
- **Search & filter** — live client‑side filtering by text, category, and status.
- **Recurring tasks** — daily/weekly/monthly with interval and end date, materialized over a rolling
  90‑day horizon, with this‑occurrence / all‑future edit and delete and a deleted‑occurrence skip‑list.
- **Optimistic CRUD** with rollback and error toasts on sync failures.
- **Deployment** — Cloudflare Pages, auto‑deploying from GitHub `main`, on the custom domain
  `magicagenda.app` with SPA deep‑link fallback.

### Known limitations

- Dragging a recurring occurrence to a different day may cause a copy to reappear on its original day
  after reload (instances don't yet record their origin date).
- The Google consent screen shows the `…supabase.co` callback host on the free Supabase tier.

[Unreleased]: https://github.com/jwh3times/magic-agenda/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/jwh3times/magic-agenda/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/jwh3times/magic-agenda/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/jwh3times/magic-agenda/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/jwh3times/magic-agenda/releases/tag/v1.0.0
