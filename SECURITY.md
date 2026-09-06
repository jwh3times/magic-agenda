# Security Policy

## Supported versions

Magic Agenda is a continuously deployed web app; the latest release on `main` (and the live site at
[magicagenda.app](https://magicagenda.app)) is the only supported version.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

- Preferred: open a private report via **GitHub → Security → [Report a vulnerability](https://github.com/jwh3times/magic-agenda/security/advisories/new)**.
- Alternatively, email **jerryholland00@gmail.com** with the details and reproduction steps.

Please include affected URL/component, impact, and steps to reproduce. We aim to acknowledge within a
few days and will coordinate a fix and disclosure timeline with you.

## Security model

- **Row-Level Security is the authorization boundary.** Application tables enable RLS and
  default-deny. Access to Boards, Tasks, and Labels is scoped through current Board Membership:
  members may read, Owners and Editors may write Tasks, and only Owners may manage Labels or
  rename/delete Boards. Settings and account profiles are self-scoped; Membership rows are visible
  only to the account they belong to. Column grants restrict which fields clients can change, and
  Board creation creates its Owner Membership atomically through an RPC. See
  [Board ownership](AGENTS.md#board-ownership-containment-is-the-authorization-boundary) for the
  policy, grant, and containment constraints.
- **The anon key is public by design.** It ships in the browser bundle and is safe _only because_ RLS
  default‑denies. This is expected.
- **Keep the service-role key server-side.** It bypasses RLS, so it must never appear in client
  code, committed files, logs, or any `VITE_`-prefixed variable (Vite inlines those into the bundle).
  The production use is the account-deletion Edge Function described below.
- **Secrets are git‑ignored.** `.env`, `.env.local`, and `.env.*.local` are ignored; only
  `.env.example` (placeholders) is committed. Rotate keys in the Supabase dashboard if one leaks.
- **Auth redirect allow‑list.** Supabase Auth only redirects to allow‑listed URLs; keep the list tight
  (production domain, preview hosts, localhost).
- **Security response headers.** Production is served with a `Content-Security-Policy` (scripts limited
  to our own origin, `frame-ancestors 'none'`) plus `X-Frame-Options: DENY`, `X-Content-Type-Options:
nosniff`, `Referrer-Policy`, and a minimal `Permissions-Policy`, via `public/_headers` (Cloudflare
  Pages).
- **HTTPS transport.** `public/_headers` configures HSTS for one year with `includeSubDomains` and
  `preload`. Keep HTTPS available on the apex and every subdomain. The `preload` directive does not
  submit the domain to browser preload lists; submission remains a separate maintainer decision.
- **Production DB credentials stay in CI secrets.** The `Deploy Migrations` workflow applies schema
  changes using a Supabase access token + database password held as **encrypted GitHub Actions
  secrets** — never in client code or a `VITE_`‑prefixed variable.

## Where things live

- **Privileged account deletion:** [`delete-account`](supabase/functions/delete-account/handler.ts)
  reads the service-role key from the Edge Function's server-side secret environment. It verifies
  the caller's JWT before creating the privileged client and deletes only that verified account.
- **Backups:** the [Backup workflow](.github/workflows/backup.yml) encrypts nightly database dumps
  before uploading them as public-repository artifacts retained for 90 days. Accounts, password
  hashes, Task content, and enrolled MFA factors remain sensitive even though session and temporary
  auth tables are excluded. See the [restore runbook](docs/runbooks/restore-from-backup.md), including
  its handling rules for older bundles that still contain session state.
- **Preview deployments:** Cloudflare Pages previews use the production Supabase project. Treat
  writes from a preview as production writes; the preview hostname is not a data-isolation boundary.
- **Accepted tradeoffs:** the preview redirect wildcard is explained in
  [`supabase/config.toml`](supabase/config.toml), and realtime DELETE metadata fan-out is explained
  in the [publication migration](supabase/migrations/20260704090000_realtime_tasks.sql). Include
  that context when reporting a finding, especially if the assumptions behind a tradeoff no longer
  hold.

## Automated safeguards

This repository runs several automated checks (configured in `.github/`):

- **CodeQL code scanning** (default setup) — findings surface on PRs; the `main` branch ruleset blocks
  merging on medium‑or‑higher severity.
- **Secret scanning + push protection** — blocks commits containing known secret formats.
- **Dependabot** — daily dependency + GitHub Actions update PRs, plus security alerts and updates.
- **Branch protection** — `main` is PR-only. See the
  [required checks and merge rules](AGENTS.md#required-checks-and-releases), which link to the
  authoritative GitHub ruleset for scanning thresholds and review-thread resolution.
- **Auth configuration as code** — the production `[auth]` settings (redirect allow‑list, password
  policy, OTP and rate limits, MFA) live in `supabase/config.toml` and deploy from CI, so a weakening
  change is reviewable in a PR diff and previewed by the `Config` check rather than made silently in a
  dashboard. Secrets are `env()` references resolved from encrypted Actions secrets, never committed.

## Responsible disclosure

We will not pursue legal action against good‑faith security research that respects user privacy, avoids
data destruction, and gives us reasonable time to remediate before public disclosure.
