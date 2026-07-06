-- Optional due time for a task. NULL = all-day. No backfill needed; the app treats
-- a missing/NULL value as all-day, so old and new app versions tolerate each other
-- during the deploy window.
alter table public.tasks add column at_time time;
