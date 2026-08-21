-- An Occurrence must carry the Occurrence Date it represents.
--
-- `recur_origin_day` is what identifies an Occurrence within its Series, and since #205 the app
-- type says so: `Occurrence.occurrenceDate` is non-null, and `rowToTask` reads a parented row with
-- no date as a standalone Task rather than as a broken Occurrence. This constraint is what makes
-- that reading safe rather than optimistic.
--
-- It also closes a hole that is easy to miss, and is the reason this is a constraint rather than a
-- comment. Occurrence uniqueness is a *partial* index:
--
--   create unique index tasks_recur_instance_uniq
--     on public.tasks (board_id, recur_parent_id, recur_origin_day)
--     where recur_parent_id is not null;
--
-- NULLs are distinct in a unique index, so a row with a parent and a NULL origin is not constrained
-- by it at all — any number of them can exist for the same (Board, Series). That is exactly why
-- `20260813210200` had to *detach* the legacy NULL-origin rows instead of letting the index sort
-- them out; its own comment notes they "sat outside" it. Nothing has prevented new ones since.
--
-- No client path creates one today: `makeInstance` and `planPromoteToSeries` both always set the
-- date. This is defence in depth for a class of bug whose symptom would be duplicate cards that no
-- constraint refuses.

-- Idempotent re-run of the 20260813210200 cleanup: detach rather than delete, for the reason given
-- there — these behave as ordinary inbox tasks already, and the text is something a person wrote.
-- Expected to affect zero rows; present so the constraint below cannot fail on legacy data.
update public.tasks
   set recur_parent_id = null
 where recur_parent_id is not null
   and recur_origin_day is null;

alter table public.tasks
  add constraint tasks_occurrence_has_date
  check (recur_parent_id is null or recur_origin_day is not null);
