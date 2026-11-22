### Docs

- **`docs/agents/dependabot.md` holds what the shared `/dependabot` skill needs to review a
  Dependabot pull request here.** It records the install to reproduce, where each dependency is
  used, and the facts about this stack a review must not get wrong: the deploy workflows and the
  backup take their Supabase CLI from the `supabase` pin and run only after a merge, so any bump
  of it is reviewed in full; `vite-plugin-pwa` hard-peers Vite 8 at most; and the Edge Functions
  pin their own `@supabase/supabase-js`. It also records the gates and the known fixes for each
  kind of bump that has broken before: Oxlint and `oxlint-tsgolint` rules (#668, #652), jsdom 31's
  CSS serialization (#653), axe-core rules (#546) and Supabase CLI 3.0 (#639). The Doc map lists
  it.
