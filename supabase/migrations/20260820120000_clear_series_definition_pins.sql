-- Clear the pin on every Recurring Series definition.
--
-- Pinning is Occurrence State (docs/adr/0002-series-occurrence-field-ownership.md), so a Series has
-- no pin to hold. Until #215 `makeInstance` copied `tmpl.pinned` onto every Occurrence it built,
-- while nothing after promotion ever wrote that column — so a definition's pin was frozen at
-- whatever the Task's pin happened to be at the moment it was promoted, and every future Occurrence
-- was born carrying it with no way to change it.
--
-- The client fix alone ends the user-visible bug, because the new `makeInstance` does not read the
-- column at all. This migration is tidiness rather than correctness: it clears a value that used to
-- mean something and now means nothing, so a future reader does not find a set field and infer a
-- purpose for it. That inference is exactly how the bug survived.
--
-- Neither deploy order can hurt, which is why this ships alongside the client change rather than
-- one release behind it (`Deploy Migrations` and the Cloudflare Pages build race on every merge):
--
--   * migration first — the still-deployed old client reads `false` and builds unpinned
--     Occurrences, which is the behaviour being shipped anyway;
--   * client first — the new client ignores the column, so the stale value is inert until this
--     lands.
--
-- Occurrences are untouched. A pin a user put on a real card is theirs and stays.

update public.tasks
   set pinned = false
 where recur_freq <> 'none'   -- carries a Recurrence Rule
   and recur_parent_id is null -- and is not itself an Occurrence: i.e. a Series definition
   and pinned;
