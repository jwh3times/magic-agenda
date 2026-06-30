# Roadmap

Planned features and fixes for Magic Agenda. This is **aspirational, not a commitment** — items
within a section are unordered, priorities shift, and nothing here has a guaranteed date. For what has
already shipped, see [CHANGELOG.md](./CHANGELOG.md).

**Legend** — status: `[ ]` planned · `[~]` in progress.
Priority: **P1** near-term · **P2** medium · **P3** nice-to-have.

## Tasks & Scheduling

- [ ] **Due time / time-of-day** · **P2** — `day` is date-only today; add an optional time so the
      calendar and agenda can show _when_, not just _which day_.
- [ ] **Priority via pins** · **P2** — there is no priority field; reuse the sticky-note **pin** visual
      (`theme/cardStyles.ts`) to flag important notes and optionally sort/filter by it.
- [ ] **Custom labels / categories** · **P2** — `category` is a hardcoded 5-value enum; let users define
      their own labels and colors.
- [ ] **Overdue handling & roll-forward** · **P2** — surface overdue tasks and optionally roll
      incomplete ones forward to today (the daily-planner pattern).
- [ ] **Richer recurrence** · **P3** — add "weekdays only" / specific weekdays (e.g. Mon/Wed/Fri) and
      "end after N occurrences", beyond the current daily/weekly/monthly + interval + until.

## Sync & Data

- [ ] **Realtime multi-device sync** · **P1** — sync is currently REST + a manual `reload()`, so edits
      only appear on another device after a refresh. Supabase realtime subscriptions would make edits
      appear live and back the "syncs across your devices" promise.
- [ ] **Export / import** · **P2** — JSON export and import for backup and data ownership.
- [ ] **iCal calendar feed** · **P3** — a read-only `.ics` subscription so the board shows up in
      Google / Apple Calendar.

## Mobile, PWA & Notifications

- [ ] **Installable PWA + offline** · **P2** — there is no manifest or service worker today; make the app
      installable and usable offline for a daily-check tool.
- [ ] **Reminders / notifications** · **P2** — web-push or email reminders for scheduled tasks. _Depends
      on the PWA work._

## Productivity & UX

- [ ] **Quick-add & keyboard shortcuts** · **P3** — fast capture (ideally natural-language, e.g.
      "groceries tomorrow") plus a command palette / shortcuts. Includes keyboard-accessible drag — DnD
      is pointer-only today.
- [ ] **Settings page** · **P3** — preferences are scattered across the toolbar and limited to
      theme/default-view; a dedicated screen also unlocks **week-start** and **timezone** config (dates
      are effectively UTC today).
- [ ] **Bulk multi-select** · **P3** — select several notes to move, delete, or recolor at once.
- [ ] **Undo** · **P3** — a toast-based "undo last action", reusing the existing optimistic-rollback
      plumbing.
- [ ] **Completed / archive view + light stats** · **P3** — a history of done tasks plus simple
      streak/throughput insight.

## Auth & Account

- [ ] **Password reset** · **P1** — email-based reset flow via Supabase Auth; users currently have no
      account-recovery path.
- [ ] **Delete account** · **P1** — self-service account and data deletion (a baseline privacy
      expectation); cascades the user's tasks and settings rows.
- [ ] **Privacy & Terms links while logged in** · **P2** — surface the legal pages from inside the app
      (toolbar/footer), not just on the login screen.
- [ ] **Google "G" logo on Continue-with-Google** · **P3** — replace the generic blue "G" with the
      official multi-color Google mark.

## Admin & Access Control

- [ ] **Roles & feature flags** · **P2** — a roles model (e.g. `admin`) plus per-flag gating; the
      foundation the admin dashboard builds on.
- [ ] **Admin dashboard** · **P2** — internal view for users, tasks, and flags. _Depends on roles &
      feature flags._

## Bug Fixes

- [ ] **Recurring-occurrence drag resurrects a copy** · **P1** — moving a recurring instance to another
      day re-creates one on its origin day after reload; instances need to record their origin date.
      _(from the CHANGELOG "Known limitations".)_

## Polish

- [ ] **Public landing page (unblocks Google OAuth branding verification)** · **P3** — Google's branding
      verification currently fails on three counts, all because the root (`magicagenda.app`) routes
      straight to the login wall: (1) the home page is **behind a login**, (2) it **does not explain the
      app's purpose**, and (3) the home-page domain is **not verified as owned**. Add a public landing
      page at `/` (the board moves behind it) that describes the product and links Privacy/Terms without
      requiring sign-in, and **verify domain ownership** of `magicagenda.app` in Google Search Console.
- [ ] **Custom auth domain** · **P3** — the Google consent screen shows the `…supabase.co` callback host
      on the free Supabase tier; a custom auth domain would display a branded host.
      _(from the CHANGELOG "Known limitations".)_

## Bigger bets (Later)

Larger efforts that fit the app's direction but are not near-term.

- [ ] **Shared / collaborative boards** · **P3** — multi-user boards and task sharing; the largest lift,
      and a natural pairing with the **roles & feature flags** work above.
- [ ] **Attachments** · **P3** — file uploads on tasks via Supabase Storage.
