-- Publish `labels` to realtime, closing the stale-vocabulary edge that Label management opened.
--
-- WHY THIS IS SAFE TO ADD, against the two standing rules on the publication (see the header of
-- 20260704090000_realtime_tasks.sql, which is the authoritative statement of them):
--
--   1. NEVER put a secret or semantically meaningful value in a published table's primary key.
--      `labels.id` is `uuid default gen_random_uuid()` — opaque, and carrying no Board, Account, or
--      name. A DELETE is fanned out to every subscriber without an owner check, capped at the
--      replica identity, so that uuid IS the entire content of a cross-tenant broadcast here. What
--      leaks is the same activity metadata `tasks` already leaks: that some label somewhere was
--      deleted, and when. `tests/rls/structure.test.ts` asserts every published table is uuid-keyed
--      and now covers this one for free.
--   2. NEVER `disable row level security` on it. RLS stays on; the five Owner/member policies from
--      20260816134515_board_labels.sql are untouched by this migration.
--
-- WHY NOW, when #177 deliberately deferred it. The original reason was a conjunction: no shipped UI
-- mutated Label definitions, AND publishing would widen the DELETE surface for no freshness
-- benefit. #179 shipped Owner-only management and expired both halves at once. The deferral then
-- rested on "one Owner needs no push", which confuses one *person* with one *surface*: catch-up
-- fires on `visibilitychange` and `online`, so it never fires for a tab that stays open and focused,
-- and a laptop plus an awake phone is one person with two of them.
--
-- The edge that argument left open is not cosmetic staleness. `tasks` is published and `labels` was
-- not, so a second focused surface re-renders its cards as Unlabeled correctly the moment a Label
-- is deleted — while its Label directory stays stale, so the editor goes on offering the deleted
-- definition and the save is then rejected by `tasks_label_same_board`. Partial freshness is worse
-- than uniform staleness: the board looks trustworthy while the vocabulary under it is not.
--
-- Guarded, for the same reason the original is: the publication may already contain the table (a
-- dashboard toggle, a re-run), and a bare `alter publication ... add table` would 42710 and wedge
-- the auto-applied migration pipeline.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'labels'
  ) then
    alter publication supabase_realtime add table public.labels;
  end if;
end $$;
