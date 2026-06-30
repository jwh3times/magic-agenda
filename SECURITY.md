# Security Policy

## Supported versions

Magic Agenda is a continuously deployed web app; the latest release on `main` (and the live site at
[magicagenda.app](https://magicagenda.app)) is the only supported version.

| Version | Supported |
| --- | --- |
| 1.1.x (latest) | ✅ |
| < 1.1 | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

- Preferred: open a private report via **GitHub → Security → [Report a vulnerability](https://github.com/jwh3times/magic-agenda/security/advisories/new)**.
- Alternatively, email **jerryholland00@gmail.com** with the details and reproduction steps.

Please include affected URL/component, impact, and steps to reproduce. We aim to acknowledge within a
few days and will coordinate a fix and disclosure timeline with you.

## Security model

- **Row‑Level Security is the boundary.** Every table enables RLS and default‑denies; policies scope
  every operation to `auth.uid() = user_id`. A user can never read or write another user's rows.
- **The anon key is public by design.** It ships in the browser bundle and is safe *only because* RLS
  default‑denies. This is expected.
- **Never ship the service‑role key.** It bypasses RLS. It must never appear in client code, the repo,
  CI, or any `VITE_`‑prefixed variable (Vite inlines those into the bundle).
- **Secrets are git‑ignored.** `.env`, `.env.local`, and `.env.*.local` are ignored; only
  `.env.example` (placeholders) is committed. Rotate keys in the Supabase dashboard if one leaks.
- **Auth redirect allow‑list.** Supabase Auth only redirects to allow‑listed URLs; keep the list tight
  (production domain, preview hosts, localhost).

## Automated safeguards

This repository runs several automated checks (configured in `.github/`):

- **CodeQL code scanning** (default setup) — findings surface on PRs; the `main` branch ruleset blocks
  merging on medium‑or‑higher severity.
- **Secret scanning + push protection** — blocks commits containing known secret formats.
- **Dependabot** — daily dependency + GitHub Actions update PRs, plus security alerts and updates.
- **Branch protection** — `main` is PR‑only; the `Format` / `Test` / `Build` CI checks and CodeQL must
  pass before a PR can merge.

## Responsible disclosure

We will not pursue legal action against good‑faith security research that respects user privacy, avoids
data destruction, and gives us reasonable time to remediate before public disclosure.
