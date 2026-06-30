-- Scope the recurrence-instance unique index by user_id (security hardening — review Finding 4).
--
-- The original index (20260629140000_recurrence.sql) was unique on (recur_parent_id, day)
-- *globally*. Inserting a row whose (recur_parent_id, day) collides with ANOTHER user's instance
-- returns a 23505 unique-violation, distinguishable from success — a theoretical cross-tenant
-- existence leak. It is not practically exploitable (recur_parent_id is an unguessable v4 UUID and
-- RLS blocks reading the colliding row), so this is defense-in-depth. Adding user_id also better
-- matches the real invariant: one materialized instance per template per day PER USER.
--
-- Behaviour-preserving for the app: a given recur_parent_id only ever belongs to one user, so the
-- per-user uniqueness (and the StrictMode double-insert 23505 guard in useTasks) is unchanged. The
-- new key is strictly weaker, so all existing rows remain valid — no data migration needed.

drop index if exists public.tasks_recur_instance_uniq;

-- At most one materialized instance per (user, template, day).
create unique index tasks_recur_instance_uniq
  on public.tasks (user_id, recur_parent_id, day)
  where recur_parent_id is not null;
