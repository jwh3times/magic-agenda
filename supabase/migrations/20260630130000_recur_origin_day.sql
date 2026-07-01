-- Record each recurring instance's origin occurrence date, and key instance uniqueness off it.
--
-- Bug: dragging a recurring instance to another day changed its `day`, so on the next load
-- materialization saw the original occurrence date as unfilled and resurrected a duplicate there
-- (deleting a moved instance had the same failure — it skip-listed the moved day, not the origin).
-- Root cause: the mutable `day` was used as the identity of the occurrence an instance covers.
--
-- Fix: `recur_origin_day` stores the occurrence date an instance was materialized for and never
-- changes when the card is moved. Materialization, the delete skip-list, and the uniqueness index
-- all key off origin instead of `day`.

alter table public.tasks
  add column recur_origin_day date;

-- Backfill existing instances: their origin is their current day. (Instances already in the inbox
-- have day NULL and no recoverable origin; they keep NULL — NULLs are distinct in the unique index
-- below, so this is safe, and new instances always carry a real origin even once moved to inbox.)
update public.tasks
  set recur_origin_day = day
  where recur_parent_id is not null and day is not null;

-- Uniqueness is now one materialized instance per (user, template, origin occurrence) — not per day.
-- This also lets two occurrences of the same series legitimately share a day (previously a 23505),
-- while still catching the StrictMode double-insert the app guards against. The new key equals the
-- old one for every existing non-inbox row (origin = day), so no row becomes invalid.
drop index if exists public.tasks_recur_instance_uniq;

create unique index tasks_recur_instance_uniq
  on public.tasks (user_id, recur_parent_id, recur_origin_day)
  where recur_parent_id is not null;
