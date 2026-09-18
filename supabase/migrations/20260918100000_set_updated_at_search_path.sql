-- Give `set_updated_at()` an empty `search_path` (#390).
--
-- The Supabase security advisor reports `function_search_path_mutable` for this function, and
-- since #384 it is the last one in `public` or `app_private` without `set search_path = ''`.
-- Every other function here -- the four other invoker trigger functions, both `security definer`
-- `auth.users` triggers, `create_board`, the two admin RPCs, `reminder_candidate_rows`, and both
-- `app_private` helpers -- already carries one and schema-qualifies its body.
--
-- The finding is narrow today and that is the point. `set_updated_at` is `security invoker`, so it
-- borrows no privilege from its owner, and #384 made it owner-only, so no API role can call it at
-- all. What a mutable `search_path` costs is future-tense: it is the property that would turn a
-- later edit to this body -- or a `security definer` flip -- into a hijack surface, because an
-- unqualified name could then resolve to an object in whatever schema the caller can create in.
-- Closing it now means no function in this schema carries that property, which is a rule a
-- reviewer can check rather than an exception they have to remember.
--
-- `pg_catalog` is searched implicitly whatever `search_path` says, so `now()` would still resolve
-- unqualified. It is qualified anyway: the repo's rule is that a hardened body names its schemas,
-- and a body that only works by implicit fallback teaches the next editor the wrong habit.
-- `new` is a PL/pgSQL record variable, not a schema object, so it stays as it is.
--
-- `create or replace` preserves the existing ACL rather than re-consulting `pg_default_acl`, so
-- this cannot reintroduce the production grants #384 removed -- those apply at CREATE only, and
-- #384 additionally revoked them from the default-privileges template. `tests/rls/baseline.test.ts`
-- asserts the resulting owner-only ACL locally and
-- `scripts/verify-function-grants.mjs` asserts it against production on the next
-- `Deploy Migrations` run, so a regression here fails a required check rather than going unseen.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;
