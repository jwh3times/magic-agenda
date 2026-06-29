# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/jwh3times/magic-agenda/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/jwh3times/magic-agenda/releases/tag/v1.0.0
