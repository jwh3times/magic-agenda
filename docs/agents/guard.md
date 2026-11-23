# Guard

The commands and paths `scripts/guard.mjs` stops here, on top of the rules it applies everywhere.
Each `##` heading is one setting, defined in `.agents/skills/ship/settings/guard.md`.

## Deny commands

- `^(npx (-y |--yes )?)?supabase config push\b` — it deploys `supabase/config.toml` straight to
  production; the `Config` CI job previews the push and `Deploy Auth Config` applies it on merge.
- `^(npx (-y |--yes )?)?supabase functions deploy\b` — it deploys Edge Functions straight to
  production; `Deploy Functions` deploys them on merge. Serve one locally with
  `npx supabase functions serve <name>`.
- `^(npx (-y |--yes )?)?supabase (db reset|migration (repair|up|down|squash)|storage (rm|cp|mv)|seed)\b.*\s--(remote|linked|project-ref|db-url)\b` — a
  `--remote` write to the production project that no runbook documents. Run the bare command, which
  targets the local stack since Supabase CLI v3.
- `^(npx (-y |--yes )?)?supabase\b(?=.*\s--yes\b)(?=.*\s--(remote|linked|project-ref|db-url)\b|\s(functions (deploy|delete)|config push)\b)` — `--yes`
  skips the only question Supabase CLI v3 asks before a hosted change, and its default is no. Drop
  `--yes` and let the owner answer, or leave the change to the deploy workflow.
- `^(export SUPABASE_YES=|\$env:supabase_yes\b)` — `SUPABASE_YES` answers yes to every hosted-change
  question the Supabase CLI asks for the rest of the shell. Never set it.
- `^npx (-y |--yes )?skills update\b` — it leaves `.claude/skills/` linked to its source instead of
  copied. Re-run the `npx skills add ... --copy` install in `AGENTS.md` instead.

## Ask commands

- `^(npx (-y |--yes )?)?supabase db push\b.*\s--(remote|linked|project-ref|db-url)\b` — it applies
  migrations to the hosted project. `Deploy Migrations` does that on merge; by hand it belongs only
  to first-time setup and `docs/runbooks/restore-from-backup.md`, on the owner's word.
- `^(npx (-y |--yes )?)?supabase functions delete\b` — it removes a deployed Edge Function from
  production; retiring one is run by the owner holding the access token
  (`docs/agents/supabase-config.md`).

## Protected paths

- `^\.env\.local$` — local Supabase credentials; `.env.example` is a template, not a backup.
- `^private/` — the private companion checkout; its uncommitted work exists nowhere else.
- `^tests/e2e/\.auth/` — Playwright storage state for the E2E account.
- `^supabase/\.temp/(?!pgdelta(/|$))` — Supabase CLI link state; deleting it unlinks the project,
  and relinking needs the database password. Only `supabase/.temp/pgdelta/` is a cache.
- `^supabase/\.branches/` — Supabase CLI link state, as `supabase/.temp/`.
- `^(supabase/functions/)?node_modules/` — reinstallable, but removing it is not cleanup.
- `^\.superpowers/` — workflow scratch that may still be mid-flight: ask the owner first.
