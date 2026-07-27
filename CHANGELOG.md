# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every merge to `main` auto-releases (the `Version` workflow tags `v<major>.<minor>.<build>`), so each
released build gets its own section below — named for the version the merge minted. `Unreleased` holds
only work that is on a branch but not yet merged.

## [Unreleased]

No unreleased changes.

## [1.2.32] - 2026-07-27

### Changed

- **Settings load once per session instead of once per route.** `useSettings` was called
  independently by `BoardPage` (`/`) and `SettingsPage` (`/settings`). Those routes are mutually
  exclusive, so every navigation between them unmounted the hook: settings were refetched, the
  realtime channel was torn down and rebuilt, and — because both pages gate on `loading` with a
  full-page spinner — each trip to settings flashed one. A `SettingsProvider` mounted above
  `<Routes>` now owns that state, so there is one fetch and one channel per session and no spinner
  on the way to settings.

  Returning to the board still shows `Loading your board…`. `useTasks` is deliberately **not**
  hoisted alongside it: `BoardPage` is lazy-loaded precisely to keep dnd-kit and the board data
  layer out of the entry chunk, and lifting `useTasks` up would pull them back in.

  Because the provider sits above the router, it also mounts for signed-out visitors — so
  `useSettings` now no-ops on an empty `userId`. Without that guard every visitor to the public
  landing page would have fired a `user_settings` query for `user_id = ''`. A test pins it, along
  with the single-fetch/single-channel behaviour and the "used outside the provider" error.

  Measured cost: the settings hook moves out of the two lazy page chunks and into the entry chunk,
  which grows 465.7 → 467.3 kB (+0.5 kB gzip). `BoardPage` is unchanged at 90.6 kB.

### Docs

- The public-landing-page spec still read "Approved, not yet implemented" four versions after it
  shipped. It now records v1.2.28 and the v1.2.29 follow-ups.

## [1.2.31] - 2026-07-27

### Fixed

- **The restore runbook was wrong in six places, found by rehearsing it for the first time.** The
  nightly backup itself has been verified since v1.2.27, but the restore had only ever been read. It
  was executed end to end twice against backup run `30265510548` — into a local `supabase start` stack
  and into a throwaway hosted project. Both reached counts matching production with every integrity
  check clean, but not before the file failed in ways that would each have cost time during an outage:

  - **The documented connection host cannot be reached.** `db.<ref>.supabase.co` is IPv6-only —
    Supabase publishes no `A` record for it — so step 3 died on its first command with `could not
    translate host name`. The runbook now connects through the Session pooler
    (`postgres.<ref>@aws-0-<region>.pooler…:5432`) and explains why it must be the session pooler and
    not the transaction one: replica mode is a session setting and the load is one transaction.
  - **Restoring `schema.sql` silently omits `on_auth_user_created`.** That trigger sits on
    `auth.users` and the bundle's schema dump is `public`-only, so the primary documented path built a
    database that passed every check the runbook listed while giving **new signups no `user_settings`
    row**. Existing users would have looked fine; only later registrations would break. Confirmed by
    probe insert on real infrastructure, and the fix is now spelled out with the DDL.
  - **Verification never checked that RLS survived.** RLS is the only authorization boundary in this
    app, so a restore that dropped it would be a security incident that the row counts and both orphan
    queries reported as clean. Step 4 now asserts `relrowsecurity`, the policy count, and the trigger.
  - **The circular foreign key was mis-stated as a restore hazard.** It is not one: the CLI emits a
    single multi-row `INSERT` per table, and foreign keys are `AFTER … FOR EACH ROW` triggers queued to
    end of statement, so row order within it cannot matter. Verified by forcing a recurrence template
    onto the statement's final line at 5,064 rows with replica mode off — it restored cleanly. The
    other stated reason, the `on_auth_user_created` settings-row collision, **is** real and was
    reproduced.
  - **`data.sql` sets and resets replica mode itself** — line 1 and a closing `RESET ALL` — which makes
    the runbook's `-c "SET …"` redundant. It is kept for visibility, now labelled as such, with a
    warning never to strip line 1.
  - **The privilege fallback was incomplete.** Because that `SET` lives inside `data.sql`, a refusal
    aborts the load from within the file, so the advice to drop the trigger and retry would not work
    without also stripping line 1. The privilege itself is fine — `postgres` reports `usesuper = f`
    and the `SET` still succeeds — now verified rather than asserted parenthetically.

  Three further notes went in: the prerequisites do not hold on Windows as written (`gpg` ships with
  Git for Windows and is missing from PowerShell's `PATH`; `psql` need not be installed at all, since a
  `postgres:17` container works and is how this was rehearsed), the `orphan_recur_parents` check is
  **vacuous** on current data because production holds no recurrence rows, and the passphrase in the
  maintainer's password manager does open the bundle — something previously proven only inside CI.

### Docs

- `AGENTS.md` gave the `tasks.recur_parent_id` self-reference as a reason restores need triggers
  disabled. It is not one, and that paragraph now carries the three corrections the rehearsal produced,
  including the `schema.sql` trigger gap and the IPv6-only host.

## [1.2.30] - 2026-07-27

### Fixed

- **`/robots.txt` served robots directives followed by an entire HTML document.** There was no
  `robots.txt` in `public/`, and `_redirects` rewrites every unmatched path to `index.html` with a
  200 — so Cloudflare's managed Content Signals block was prepended to the SPA shell and the two
  were served as one file. Crawlers ignore unparseable lines, so the directives still applied
  (`User-agent: * / Allow: /` — Googlebot was never blocked), but the response was not a valid
  robots.txt. A real file now exists, and it disallows the `/auth/` token-redemption routes, which
  have nothing worth indexing.

  Found while investigating why Google's OAuth branding verification kept failing. It was **not**
  the cause — Googlebot is allowed and the home page serves its full content, name, and purpose to
  a crawler — but a `/robots.txt` that returns markup is a defect regardless of what prompted the
  look. The same catch-all means any unmatched path returns 200 with the SPA shell rather than a
  404; that is deliberate for client-side routes, but worth knowing when adding files crawlers
  fetch by convention.

## [1.2.29] - 2026-07-27

### Fixed

- **The landing page was invisible to anything that doesn't run JavaScript.** This app is a
  client-rendered SPA, so the served `<body>` is an empty `<div id="root">` — every word of v1.2.28's
  landing page arrives only after the bundle executes. A crawler that doesn't evaluate JS therefore
  saw a blank page, which is indistinguishable from the two failures the landing page was built to
  fix ("your home page is behind a login page" and "does not explain the purpose of your app").
  `index.html` now ships a `<noscript>` block carrying the app name, the purpose, and links to sign
  in, Privacy, and Terms. No visual change for real users; the built HTML now contains the app name
  and the purpose sentence as static text.

- **The app name appeared nowhere on the page as text.** Google also rejected the site because the
  OAuth consent screen's app name didn't match the home page's. It couldn't have: the header logo is
  an `<img>`, so "Magic Agenda" existed only as an `alt` attribute and a footer copyright line — and
  the wordmark inside that SVG renders lowercase "magic agenda" where the DOM can't read it at all.
  The header now shows the icon mark beside **Magic Agenda** as real text, matching the configured
  app name exactly, and the hero sentence names the app so the name and the purpose are stated
  together. A test pins it.

### Docs

- The landing-page spec's follow-up predicted that any remaining verification failure would be
  domain ownership rather than page content. That was wrong, and the entry now says so along with
  what the real gaps were — including the escalation if content is still the problem next time
  (pre-render the route at build time, rather than adding more meta tags).

## [1.2.28] - 2026-07-27

### Added

- **`magicagenda.app` has a front door.** Signed out, `/` was a login wall — which is exactly why
  Google's OAuth branding verification fails: the home page didn't explain what the app is. It now
  renders a landing page with the headline, what the product does, the feature list, and links to
  Privacy and Terms. Signed in, `/` still renders your board, so no URL moved and no bookmark broke.
  (ROADMAP 5.1.)

  **The hero shows a live board, not a screenshot.** It renders the real `TaskCard` against the real
  theme tokens using the mock board already in the repo — genuine rotation, pins, DONE stamps,
  per-theme shadows — with a Cork / Neon-Brutalist / Aurora-Glass toggle beneath it. Nothing to
  capture, commit at 2×, or re-take when the UI changes; it cannot drift from the product because it
  *is* the product rendering. The toggle is local to the page and never writes to your saved theme.

- **Privacy and Terms are reachable from the board itself** (ROADMAP 5.3), in the inbox foot. The
  roadmap suggested the mobile toolbar overflow, but no overflow menu exists and the phone toolbar
  is already three stacked rows; the inbox renders in every view and costs no board space.

### Changed

- **The Google sign-in button uses Google's actual mark** (ROADMAP 5.2) — the official multi-colour
  "G" as an inline SVG, replacing a blue letter, per their branding guidelines. Inline because the
  CSP allows no external asset hosts.
- **A task card with no `onToggleDone` renders its checkbox as a status indicator, not a button.**
  It was always a `<button>` with an optional-chained handler, so decorative cards shipped a
  focusable control that did nothing — reachable by keyboard and announced as a button. Found by the
  landing preview's accessibility test.

### Internal

- Per-route `<title>`/description via a small `useDocumentTitle` hook — no new dependency; the static
  og/twitter tags in `index.html` stay as the sitewide default.
- The preview is lazy-loaded inside the landing page. Importing it eagerly grew the entry chunk
  459.7 → 491.7 kB, because the card and theme modules hoist into the chunk every visitor pays for;
  splitting it holds the entry at 465.5 kB (+1.9 kB gzip over baseline) and moves ~27 kB behind
  first paint, where `BoardPage` now shares it — that chunk shrank 100.1 → 90.6 kB.

## [1.2.27] - 2026-07-27

### Fixed

- **The documented restore had two ways to fail, both found by reading a successful backup's log.**
  The first green run printed the tables it captured, which showed `data.sql` already contained the
  `auth` schema — `supabase db dump --data-only` includes Supabase-managed schemas, even though the
  *schema* dump excludes them. The separate `--schema auth` dump added in v1.2.25 was therefore a
  strict subset of `data.sql` (16 KB inside 19 KB), and the runbook's "load `auth.sql`, then
  `data.sql`" would have inserted `auth.users` twice and aborted on a duplicate key — during an
  outage, halfway through a restore.

  Worse, and independent of that: restoring `auth.users` fires `on_auth_user_created`, which seeds a
  **default** `public.user_settings` row; the dump's `COPY` of that user's real settings row then
  collides with it. The trigger's own `on conflict do nothing` guards the trigger's insert, not the
  restore's, and whether it bites at all depends on table order in the dump — the kind of fault that
  passes a rehearsal and fails in production.

  The backup now takes one data dump instead of two, asserts that single file holds **both**
  `public.tasks` and `auth.users` (so a change in that CLI behaviour fails loudly rather than
  silently backing up half a system), and the runbook loads it once under
  `session_replication_role = replica`, which suppresses the self-referencing recurrence foreign key
  and the settings-seeding trigger together. Existing v1.2.25–v1.2.26 bundles remain restorable —
  ignore their redundant `auth.sql`, which the runbook now says explicitly.

## [1.2.26] - 2026-07-27

### Fixed

- **The backup job's own verification rejected a perfectly good dump.** The first real run of the
  v1.2.25 workflow failed with "data.sql contains no public.tasks". The dumps were fine — the
  Supabase CLI quotes identifiers, so the file says `COPY "public"."tasks"`, and the check used
  `grep 'public.tasks'`, where `.` matches exactly one character and cannot span `"."`. The check
  now normalises `COPY "public"."tasks"` / `INSERT INTO public.tasks` to a bare `public.tasks`
  before comparing, and prints the captured table names on both success and failure so the next
  surprise is diagnosable from the log. Those names are filtered to identifier-shaped strings and
  matched only at line start, because `COPY` payload rows are user data and this log is public.

### Security

- **The restore procedure would have failed on the recurrence foreign key.** `pg_dump` warns on
  every run that `tasks` has a circular foreign-key constraint — that is `recur_parent_id`
  referencing `tasks(id)`, the hidden-template link. The consequence lands on restore, not on
  dump: a `--data-only` load inserts rows in file order, so a recurring instance can arrive before
  its template and abort the load on a foreign-key violation. The runbook now loads board data with
  `session_replication_role = replica` inside a single transaction, explains the warning so it is
  not "fixed" by changing what gets dumped, and adds a post-restore check for instances whose
  template did not come back — the exact corruption that disabling FK triggers would otherwise
  hide. Found by running the backup for real rather than by reading it.

## [1.2.25] - 2026-07-26

### Added

- **Nightly encrypted database backups.** The Supabase free tier has **no automated backups at
  all** — until now a dropped table or a bad migration would have lost every user's data with no
  restore path (the app's export/import is per-user and manual, so it was never one). A new
  `Backup` workflow dumps the schema, the `public` data, and the `auth` data each night at 09:00
  UTC, and on demand via **Run workflow**. All three matter: `supabase db dump` excludes
  Supabase-managed schemas by default, so without an explicit `auth` dump every restored task would
  point at a user id that no longer exists.

  **The bundle is GPG-encrypted on the runner before upload**, because this repository is public
  and GitHub Actions artifacts on public repos can be downloaded by anyone — an unencrypted dump
  would publish every user's email address, password hash, and task content. That needs one new
  repository secret, `BACKUP_GPG_PASSPHRASE`; if it is lost, the backups are permanently unreadable.

  The job refuses to run without that passphrase (an unset secret is an empty string, and `gpg`
  would otherwise cheerfully encrypt with nothing), asserts each dump actually contains
  `CREATE TABLE` / `public.tasks` / `auth.users` rather than trusting exit codes, greps the
  encrypted output for plaintext, and decrypts its own bundle to prove it opens. A backup job that
  goes green while storing nothing is the failure mode worth engineering against.

- **`docs/runbooks/restore-from-backup.md`** — the restore procedure, including the ordering trap
  (`auth.sql` before `data.sql`, or foreign keys fail), what to do differently for partial data loss
  versus a lost project, what a restored database does *not* carry (auth config, OAuth client), and
  a standing instruction to rehearse it against a throwaway project. `docs/` now distinguishes its
  historical `plans/` and `specs/` from `runbooks/`, which is living documentation.

## [1.2.24] - 2026-07-26

### Security

- **Closed out the redirect allow-list finding by recording the decision, not by changing it**
  (2026-06-30 review, Finding 3; re-affirmed 2026-07-26). `https://*.magic-agenda.pages.dev/**`
  matches every per-PR Cloudflare preview deploy, which has read as an open item across two
  reviews. It stays: the namespace belongs to this project alone and Cloudflare builds no previews
  for fork PRs, so only someone who can already deploy here could exploit it — while dropping it
  would break Google sign-in on preview deploys. `supabase/config.toml` now carries that reasoning
  next to the list, along with the cases that must stay absent (no bare-host or scheme wildcard, no
  wildcard over a domain we don't control). Comment-only: the pushed config is byte-identical.

### Docs

- **`AGENTS.md` now tells agents that `private/` exists.** The security reviews are git-ignored and
  local to the maintainer's checkout, so an agent had no way to learn that the redirect wildcard,
  tokens in `localStorage`, and the realtime DELETE fan-out are *argued, accepted* risks rather than
  bugs to fix — and reviews that live nowhere discoverable get re-litigated or silently undone.

## [1.2.23] - 2026-07-26

### Internal

- **Dev-dependency bumps** (Dependabot, `npm-minor-and-patch` group): `eslint` 10.6.0 → 10.8.0,
  `globals` 17.7.0 → 17.8.0, `typescript-eslint` 8.63.0 → 8.65.0. No runtime dependencies changed.
  Note that `typescript-eslint` 8.65.0 still peer-requires `typescript <6.1.0`, so the TypeScript 7
  hold added in v1.2.22 stays necessary.

## [1.2.22] - 2026-07-26

### Changed

- **The two auth emails are branded.** Confirm-signup and reset-password were still the four-line
  stock fragments (`<h2>` + a bare link). They now match the auth screen the link actually opens —
  dark navy panel, violet action button, app mark and wordmark — built table-first with inline
  styles so Outlook and Gmail render them, and declaring `color-scheme: dark` so dark-mode clients
  don't re-invert an already-dark email. Both gain a paste-this-link fallback, an explicit
  "expires in 1 hour, single use" note (matching `otp_expiry = 3600`), and a "you can safely ignore
  this" line; the confirmation copy now says you'll be signed straight in, which has been true since
  v1.2.19. **The action URLs are byte-for-byte unchanged** — still
  `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=…`, the form `verifyOtp` redeems — so the
  auth flows themselves are untouched. Completes ROADMAP 5.7.

### Docs

- **Corrected the required-checks list everywhere it was stale.** `Config` became a required check
  when v1.2.20 landed, but `AGENTS.md` still said it was "not yet required", and `README.md`,
  `CONTRIBUTING.md`, and `SECURITY.md` each listed a different, shorter subset. All four now name
  the same seven — `Format`, `Test`, `Build`, `Functions`, `Agents`, `Changelog`, `Config` — plus
  CodeQL. `CONTRIBUTING.md` also records that `Config` has **no** local equivalent on purpose: the
  Supabase CLI has no `--dry-run`, so running it locally would apply to production.
- **README no longer points contributors at the auth dashboard.** Setting up your own project still
  does, but production auth config has been code since v1.2.20 — the deployment section now covers
  `Deploy Auth Config` alongside `Deploy Migrations`.
- The config-as-code design spec's status header said "Approved, not yet implemented"; it shipped as
  v1.2.20 and v1.2.21. The PR template now lists the changelog entry and `npm run codex:check`,
  both of which gate merges.

### Security

- **Recorded the realtime DELETE stream as a cross-tenant disclosure boundary** (2026-07-25 review,
  Finding 2 — Low, accepted). The migration's comment described it only as a client-correctness
  quirk. It now states that DELETE events are fanned out to every subscriber with no owner check
  (Postgres cannot check access to an already-deleted row), that payloads are capped at primary
  keys — for `user_settings` that key *is* the auth user id — and records the two standing rules
  that keep it Low: never put a secret or semantically meaningful value in the primary key of a
  published table, and never disable RLS on one. `AGENTS.md` carries the same rules. Comment-only;
  no schema change, and `db push` treats the already-applied migration as a no-op.

### Internal

- **Held TypeScript at 6.x in Dependabot.** The `lint-and-typescript` group PR for TypeScript 7 had
  been failing since 2026-07-09: `typescript-eslint` peer-requires `typescript <6.1.0`, and its
  latest release (8.65.0) still does, so `npm ci` fails `ERESOLVE` and grouping cannot help —
  there is no compatible `typescript-eslint` to group with. An `ignore` entry for `typescript >=7`
  stops the daily red PR; it comes out once typescript-eslint's peer range admits TS 7.

## [1.2.21] - 2026-07-26

### Internal

- **Auth email templates are now code.** The two templates the app sends — confirm-signup and
  reset-password — live in `supabase/templates/` with their subjects in `config.toml`, deployed
  by the `Deploy Auth Config` workflow on merge. The dashboard is no longer the source of truth
  for them; future changes (including ROADMAP 5.7's branded restyling) are ordinary PR work
  against the HTML files, previewed by the `Config` CI job like any other auth-config change.
  Content matches what the dashboard served byte-for-byte, so this merge changes no user-visible
  email. This completes the second and final follow-up from the 2026-07-25 PKCE auth spec.

## [1.2.20] - 2026-07-26

### Internal

- **`supabase/config.toml` now describes production, and auth config deploys as code.** The file
  had been the stock `supabase init` template since day one — running `supabase config push`
  would have broken production auth outright (localhost site URL, weak password policy, email
  confirmations off, no Google OAuth block, no SMTP block, TOTP MFA off). Every `[auth]` value
  now matches the live dashboard (verified by inventory), secrets are referenced via `env()`
  (two new repo secrets: `RESEND_API_KEY`, `GOOGLE_OAUTH_CLIENT_SECRET` — never committed), and
  two pieces of automation keep it true: a `Deploy Auth Config` workflow applies the file with
  `supabase config push --yes` on merges to `main` touching `supabase/config.toml` or
  `supabase/templates/**`, and a new `Config` CI job previews the pending push on every PR via a
  `yes n |` decline stream — chosen because the CLI's confirmation prompts default to **yes** on
  EOF, so a closed-stdin "preview" would actually apply to production. `deploy-migrations.yml`
  and `deploy-functions.yml` carry the new env vars so the `env()` references cannot break them.
  This merge itself is designed to be a **no-op push** (the file equals production), proving the
  pipeline safely; the email templates move into the repo in a follow-up PR.

### Docs

- The 2026-07-25 PKCE auth spec's status now records it shipped as v1.2.19; new design spec and
  implementation plan for config-as-code added under `docs/specs/` and `docs/plans/`.

## [1.2.19] - 2026-07-25

### Security

- **Closed a session-fixation vector: URL fragment tokens are no longer adopted as sessions.**
  (2026-07-25 security review, Finding 1 — Medium.) The Supabase client previously ran the
  implicit auth flow, so any URL on the origin carrying `#access_token=…` — including one an
  attacker minted for their own account — silently replaced the visitor's session. The client
  now uses PKCE (`flowType: 'pkce'`) with implicit URL detection disabled outright
  (`detectSessionInUrl: () => false`, the function form — the actual control, since `flowType`
  alone does not gate fragment adoption). A regression test pins the config; a vendor-contract
  test pins the `verifyOtp` event behavior the new flows rely on. Neither redemption page will
  act while a session already exists, so a crafted emailed-token link can no longer replace a
  signed-in user's session either.

### Changed

- **Email links are now redeemed explicitly instead of via URL parsing.** Password-reset links
  carry `?token_hash=` and are redeemed on `/auth/reset` (the form appears after redemption;
  reloading mid-reset no longer risks a dead end). Signup-confirmation links land on the new
  `/auth/confirm` page and **sign the user straight in** — the old "confirm, then come back and
  sign in" round trip is gone, and the signup notice copy no longer says "then sign in".
  Google OAuth is unchanged. **Cutover note:** links emailed before this release stop signing
  users in; old reset links show "invalid or expired" (request a new one), and old confirmation
  links still confirm the account server-side but land signed out.

## [1.2.18] - 2026-07-25

### Security

- **Upgraded React Router to v8 to clear a high-severity advisory.**
  [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2) (RSC-mode CSRF bypass)
  affects `react-router` `>= 7.12.0, < 8.3.0`; the app was on 7.18.1. Magic Agenda is a
  client-only SPA with no RSC, no server, and no router actions, so the vulnerable code path was
  never reachable in production — but the dependency is now on a patched version regardless, and
  `npm audit --omit=dev` reports no vulnerabilities.

### Changed

- **`react-router-dom` replaced by `react-router` 8.3.0.** Dependabot could not make this bump on
  its own: `react-router-dom` pins `react-router` to its own exact version, and the
  `react-router-dom` re-export package was **removed** in v8 — so no in-range update existed and
  its daily security-update run had been failing. The 13 import sites now pull from the
  consolidated `react-router` package. Nothing else changed: the app uses `BrowserRouter` in
  library mode rather than `RouterProvider`, so v8's new `react-router/dom` entry point is not
  needed here. React 19.2.8 and Node 26 already satisfy v8's `>=19.2.7` and `>=22.22.0` floors.

### Internal

- **Dependabot config comment** no longer lists `react-router-dom` as an example of a package
  whose majors open as individual PRs.

## [1.2.17] - 2026-07-24

### Internal

- **Codex's agent config is now generated from Claude's, not hand-copied.** `.claude/` is the single
  source of truth: [`scripts/sync-codex.mjs`](./scripts/sync-codex.mjs) converts
  `.claude/agents/<name>.md` into `.codex/agents/<name>.toml` and copies `.claude/skills/<name>/` to
  `.agents/skills/<name>/`, which is where Codex actually looks for each. Both generated trees are
  committed, so a Codex session picks up the same `docs-updater`, `code-reviewer`, and `ship`
  definitions without running anything. Run it with `npm run codex:sync`.
- **`Agents` CI check** runs `npm run codex:check` and fails on any generated file that is missing,
  hand-edited, or left over from a deleted source. It also asserts `CLAUDE.md` still contains its
  `@AGENTS.md` import, so the two guides cannot fork into separate copies again.
- **Fixed the drift already in the Codex copies.** They had been written by substituting `AGENTS.md`
  for `CLAUDE.md` throughout, which produced self-contradictions such as "edit `AGENTS.md`, never add
  content to `AGENTS.md`". Skill prose is now copied byte-for-byte — references to `CLAUDE.md` are
  correct as written for both tools, because it really is just an import. Claude-only frontmatter is
  translated rather than dropped in silence: an agent granted no file-writing tools becomes
  `sandbox_mode = "read-only"`, and `model:` is recorded in a comment as having no Codex equivalent.

### Docs

- **AGENTS.md and CONTRIBUTING.md** document the generated-config pipeline, the rule against editing
  `.codex/` or `.agents/` by hand, and the new `Agents` check in both required-check lists.

## [1.2.16] - 2026-07-22

### Internal

- **`@supabase/supabase-js` 2.110.7 → 2.110.8, `react` and `react-dom` 19.2.7 → 19.2.8,
  `@vitejs/plugin-react` (dev) 6.0.3 → 6.0.4.** (#89)

## [1.2.15] - 2026-07-21

### Internal

- **`prettier` (dev) 3.9.5 → 3.9.6.** (#88)

## [1.2.14] - 2026-07-21

### Internal

- **`@testing-library/jest-dom` (dev) 6.9.1 → 7.0.0.** (#87)

## [1.2.13] - 2026-07-17

### Internal

- **`@supabase/supabase-js` 2.110.6 → 2.110.7.** (#86)

## [1.2.12] - 2026-07-16

### Internal

- **The changelog now names the version each merge mints.** Every merge to `main` auto-releases, so
  each entry is recorded against the build it shipped in rather than accumulating under
  `[Unreleased]`. A new [`scripts/next-version.mjs`](./scripts/next-version.mjs) is the single source
  of truth for that number — the `Version` workflow, the `Changelog` CI guard, and the `ship` agent
  skill all call it. Builds `v1.2.1`–`v1.2.11` are backfilled below from their release tags.
- **`Changelog` CI guard**, now a required status check, runs
  [`scripts/check-changelog.mjs`](./scripts/check-changelog.mjs) to enforce two invariants: the PR
  names the version its merge will mint, and every already-released build has an entry. Dependabot
  PRs are exempt from the first — a bot can't write a meaningful entry — which is exactly what the
  second one covers: a bot merge ships undocumented and takes a build number with it, and the guard
  then fails the next human PR until that gap is backfilled.
- **`ship` agent skill** (`.claude/skills/ship/`) takes a finished branch to an open PR: it refreshes
  the docs, backfills any undocumented released builds, writes the changelog entry for the version the
  merge will mint, runs the fast checks (`format:check`, `lint`, `tsc -b`), and opens or updates the
  PR. It replaces the previous Claude docs-freshness `Stop` hook.

### Docs

- **CONTRIBUTING and AGENTS** now document the named-version changelog model and the `Changelog`
  guard, replacing the previous `[Unreleased]`-cut release step.

## [1.2.11] - 2026-07-16

### Internal

- **`vite` (dev) 8.1.4 → 8.1.5.** (#85)

## [1.2.10] - 2026-07-15

### Internal

- **Dependabot config gains `npm` and `github-actions` PR labels.** (#83)

## [1.2.9] - 2026-07-15

### Internal

- **`actions/setup-node` (GitHub Actions) 6 → 7.** (#81)

## [1.2.8] - 2026-07-15

### Internal

- **`@supabase/supabase-js` 2.110.5 → 2.110.6.** (#82)

## [1.2.7] - 2026-07-15

### Internal

- **Dependabot now runs on a daily schedule (05:00).** (#80)

## [1.2.6] - 2026-07-15

### Internal

- **`@supabase/supabase-js` 2.110.4 → 2.110.5.** (#79)

## [1.2.5] - 2026-07-14

### Internal

- **`@supabase/supabase-js` 2.110.2 → 2.110.4.** (#78)

## [1.2.4] - 2026-07-13

### Internal

- **`supabase/setup-cli` (GitHub Actions) 2 → 3.** (#77)

## [1.2.3] - 2026-07-10

### Internal

- **Prettier 3.9.4 → 3.9.5.** (#76)

## [1.2.2] - 2026-07-09

### Internal

- **Line endings normalized via `.gitattributes`** — every text file is enforced LF in both the
  repository and the working tree (`* text=auto eol=lf`; binaries marked). Ends the local
  `npm run format:check` false-failures on Windows checkouts, where `core.autocrlf` produced CRLF
  working trees that Prettier (default `endOfLine: "lf"`) flagged even though CI passed. (#75)

## [1.2.1] - 2026-07-09

### Docs

- **Docs audit & consolidation** — `AGENTS.md` is now the canonical agent guide (`CLAUDE.md` just
  imports it); the documented required checks match the actual ruleset (`Format` / `Test` / `Build` /
  `Functions` + CodeQL); CONTRIBUTING gains the changelog-cut release step and the `release/*`
  branch-name warning; the completed implementation plans under `docs/` are marked as historical
  records. (#74)

## [1.2.0] - 2026-07-09

### Added

- **Export & import** — download the whole board (tasks, repeating series, settings) as JSON
  from Settings → Data, and import a previous export additively: fresh ids, series links
  preserved, nothing overwritten.
- **Overdue tasks** — unfinished tasks from past days get a red accent, the Today button shows
  their count, and the Agenda pins an Overdue group to the top with one-click "Move all to
  today" (recurring occurrences keep their identity and never regenerate on the old day).
- **Pinned notes** — pin important tasks from the editor or the 📌 button on any card. Cork's
  classic red pin now appears only on pinned notes; brutal gets a corner flash; glass a violet
  glow. A "📌 Pinned" quick filter shows pinned tasks only — manual drag order is never
  re-sorted by pinning.
- **Due times** — tasks can carry an optional time of day: set or clear it in the editor's
  Schedule row, see it as a chip on cards, and the Agenda sorts timed tasks first within each
  day (calendar cells keep manual drag order). Recurring series pass their time to every
  occurrence.
- **Realtime multi-device sync** — edits, drags, and deletions now appear live on every
  signed-in device via Supabase realtime (`postgres_changes` under RLS). A pure reducer
  (`src/data/realtime.ts`) applies remote changes — deduping recurring instances by
  occurrence, keeping templates off the board — while echoes of the device's own writes
  are suppressed. The board also refetches on reconnect, on coming back online, and when
  the tab becomes visible again (fixes stale boards on phones). Theme and default-view
  changes propagate live too.
- **Delete account** — a Danger-zone section on `/settings` permanently deletes the account
  and all data (typed confirmation required). Deletion runs in a JWT-verified `delete-account`
  edge function; Postgres cascades remove the user's tasks and settings.
- **Password reset** — a "Forgot password?" flow on the login page emails a recovery link
  (never revealing whether an account exists); the link lands on a new `/auth/reset` page
  that sets the new password. A recovery session can't reach the board until the password
  is changed.
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

### Changed

- **Theme lives in Settings; the default view is stable** — the cork/brutal/glass switcher moved
  out of the toolbar into Settings → Appearance (theme still syncs live across devices).
  Switching view tabs no longer changes your saved default view — the default is set only in
  Settings and is the view you land on when you open the app; the view you pick during a session
  is remembered for that tab (across refreshes) and resets on a new tab or sign-out.

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

- **Release versioning** — the `Version` workflow now creates standard three-part SemVer releases
  (`v<major>.<minor>.<build>`) on every merge to `main`, auto-incrementing the build per major/minor
  line while allowing a new line to start at `x.y.0`.
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

[Unreleased]: https://github.com/jwh3times/magic-agenda/compare/v1.2.30...HEAD
[1.2.30]: https://github.com/jwh3times/magic-agenda/compare/v1.2.29...v1.2.30
[1.2.29]: https://github.com/jwh3times/magic-agenda/compare/v1.2.28...v1.2.29
[1.2.28]: https://github.com/jwh3times/magic-agenda/compare/v1.2.27...v1.2.28
[1.2.27]: https://github.com/jwh3times/magic-agenda/compare/v1.2.26...v1.2.27
[1.2.26]: https://github.com/jwh3times/magic-agenda/compare/v1.2.25...v1.2.26
[1.2.25]: https://github.com/jwh3times/magic-agenda/compare/v1.2.24...v1.2.25
[1.2.24]: https://github.com/jwh3times/magic-agenda/compare/v1.2.23...v1.2.24
[1.2.23]: https://github.com/jwh3times/magic-agenda/compare/v1.2.22...v1.2.23
[1.2.22]: https://github.com/jwh3times/magic-agenda/compare/v1.2.21...v1.2.22
[1.2.21]: https://github.com/jwh3times/magic-agenda/compare/v1.2.20...v1.2.21
[1.2.20]: https://github.com/jwh3times/magic-agenda/compare/v1.2.19...v1.2.20
[1.2.19]: https://github.com/jwh3times/magic-agenda/compare/v1.2.18...v1.2.19
[1.2.18]: https://github.com/jwh3times/magic-agenda/compare/v1.2.17...v1.2.18
[1.2.17]: https://github.com/jwh3times/magic-agenda/compare/v1.2.16...v1.2.17
[1.2.16]: https://github.com/jwh3times/magic-agenda/compare/v1.2.15...v1.2.16
[1.2.15]: https://github.com/jwh3times/magic-agenda/compare/v1.2.14...v1.2.15
[1.2.14]: https://github.com/jwh3times/magic-agenda/compare/v1.2.13...v1.2.14
[1.2.13]: https://github.com/jwh3times/magic-agenda/compare/v1.2.12...v1.2.13
[1.2.12]: https://github.com/jwh3times/magic-agenda/compare/v1.2.11...v1.2.12
[1.2.11]: https://github.com/jwh3times/magic-agenda/compare/v1.2.10...v1.2.11
[1.2.10]: https://github.com/jwh3times/magic-agenda/compare/v1.2.9...v1.2.10
[1.2.9]: https://github.com/jwh3times/magic-agenda/compare/v1.2.8...v1.2.9
[1.2.8]: https://github.com/jwh3times/magic-agenda/compare/v1.2.7...v1.2.8
[1.2.7]: https://github.com/jwh3times/magic-agenda/compare/v1.2.6...v1.2.7
[1.2.6]: https://github.com/jwh3times/magic-agenda/compare/v1.2.5...v1.2.6
[1.2.5]: https://github.com/jwh3times/magic-agenda/compare/v1.2.4...v1.2.5
[1.2.4]: https://github.com/jwh3times/magic-agenda/compare/v1.2.3...v1.2.4
[1.2.3]: https://github.com/jwh3times/magic-agenda/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/jwh3times/magic-agenda/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/jwh3times/magic-agenda/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/jwh3times/magic-agenda/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/jwh3times/magic-agenda/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/jwh3times/magic-agenda/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/jwh3times/magic-agenda/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/jwh3times/magic-agenda/releases/tag/v1.0.0
