-- Two more Recurrence Rule parameters: specific weekdays, and an end-after-N-Occurrences cap.
--
-- Schema only. The deployed client neither reads nor writes these columns, and that separation is
-- deliberate rather than incidental: `Deploy Migrations` and the Cloudflare Pages build race on
-- every merge, so a client that started sending a column could reach users before the column
-- existed and PostgREST would answer every task write with `400 PGRST204`. The client half ships
-- in the following release, against a production database that already has these. Both columns
-- carry defaults, so the currently-deployed client — which names neither — keeps writing valid
-- rows throughout.
--
-- `recur_weekdays` is 0=Sunday .. 6=Saturday, matching JavaScript's `Date.getDay()`, because the
-- only consumer is `occurrenceDates` and translating the vocabulary at this seam would put a
-- second numbering in play for no gain. An empty array means "the anchor's own weekday", which is
-- exactly what a weekly Rule has always meant, so every existing Series keeps its behaviour
-- without a backfill.
--
-- `recur_count` is the Rule's other way of ending. It is not mutually exclusive with `recur_until`
-- in the data — the editor offers one or the other, but a file or an API write may carry both, and
-- whichever ends first wins. Its ceiling is 1000 because that is `MAX_OCCURRENCES`, the backstop
-- every walk in `recurrence.ts` already shares: a Rule may not name more Occurrences than the
-- walker will ever produce, or the cap would silently stop meaning what it says.

alter table public.tasks
  add column recur_weekdays int[] not null default '{}'::int[],
  add column recur_count int;

alter table public.tasks
  -- Shape, domain, and size in one predicate: this answers "is this a well-formed weekday set".
  -- The size cap is not redundant with the domain cap — duplicates are permitted (the walker reads
  -- the array as a set), so without it an arbitrarily long array of legal values is accepted.
  --
  -- A NULL element needs no clause of its own, which is worth stating because the opposite is the
  -- natural guess: `<@` answers **false** rather than NULL for an array holding one, so the check
  -- rejects it like any other non-member. Measured against this stack, not assumed.
  add constraint tasks_recur_weekdays_valid check (
    coalesce(array_ndims(recur_weekdays), 1) = 1
    and coalesce(array_length(recur_weekdays, 1), 0) <= 7
    and recur_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]
  ),
  -- A weekday set is meaningless on anything but a weekly Recurrence Rule, and on an Occurrence it
  -- is worse than meaningless: `resolveSave`'s this-occurrence path spreads the editor draft, which
  -- carries the Series' Rule so the Repeat controls have something to edit. Without this the
  -- Series' weekdays would persist onto the Occurrence row and the row would read back as a
  -- weekly-looking task that is not one. The client resets them there; this is what makes the
  -- reset load-bearing rather than a convention.
  add constraint tasks_recur_weekdays_weekly_only check (
    recur_freq = 'weekly' or coalesce(array_length(recur_weekdays, 1), 0) = 0
  ),
  add constraint tasks_recur_count_range check (
    recur_count is null or recur_count between 1 and 1000
  ),
  -- Same reasoning as the weekday coupling: a count on a row that carries no Rule is a value
  -- nothing will ever read, arriving by the same spread.
  add constraint tasks_recur_count_requires_rule check (
    recur_count is null or recur_freq <> 'none'
  );

-- PostgREST upserts include every supplied column in both INSERT and UPDATE, so the `taskToRow`
-- payload must be writable in full. Column-scoped grants are the only thing keeping attribution
-- and database timestamps out of a client's reach (see 20260906173252), which is why these are
-- extended rather than replaced with a table-level grant.
grant insert (recur_weekdays, recur_count) on public.tasks to authenticated;
grant update (recur_weekdays, recur_count) on public.tasks to authenticated;
