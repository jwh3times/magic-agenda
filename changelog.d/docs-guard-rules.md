### Docs

- **`docs/agents/guard.md` holds this repository's own rules for the shared PreToolUse guard,
  `scripts/guard.mjs`, on top of the ones it applies everywhere.** It denies the Supabase commands
  that reach production outside a deploy workflow (`config push`, `functions deploy`, an
  undocumented `--remote` write, `--yes` or `SUPABASE_YES` against a hosted target) and
  `npx skills update`; asks before `supabase db push --remote` and `supabase functions delete`; and
  protects `.env.local`, `private/`, the E2E storage state, the Supabase CLI link state,
  `node_modules/` and `.superpowers/`. The Doc map in `docs/agents/docs.md` names it and when it
  changes, and `docs/agents/tooling.md` lists it with the other settings files.
