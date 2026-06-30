# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/jwh3times/magic-agenda/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/jwh3times/magic-agenda/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/jwh3times/magic-agenda/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/jwh3times/magic-agenda/releases/tag/v1.0.0
