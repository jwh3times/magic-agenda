-- Drop the four retired compatibility columns. Step 3 of 3.
--
-- The sequence, and why it took three releases rather than one:
--
--   1. v1.8.2 (#180) dropped the Category bridge and relaxed `tasks.user_id` to nullable.
--   2. v1.8.3 (#199) stopped the client writing `user_id`. It could not be folded into step 1,
--      because `Deploy Migrations` races the Cloudflare Pages build on every merge — a client that
--      stopped sending a NOT NULL column could reach users before the migration relaxed it. E2E
--      demonstrated exactly that on #180's own pull request.
--   3. This migration. It could not be folded into step 2 for the mirror reason: a drop landing
--      before the new client deploys leaves the still-deployed client sending a column that no
--      longer exists, which PostgREST answers with `400 PGRST204`.
--
-- Only `user_id` needed all three. `category` and `label_assignment_explicit` have column defaults,
-- so omitting them was valid on both sides of their migration and the client stopped sending them
-- in step 1.

-- ---------------------------------------------------------------------------
-- What goes with these columns, checked rather than assumed
-- ---------------------------------------------------------------------------
-- Dropping a column takes its indexes and constraints with it. Three of those are worth naming,
-- because two are fine and one is a guarantee moving house:
--
--   * `tasks_user_day_idx (user_id, day, order_index)` and
--     `tasks_user_status_idx (user_id, status, korder)` were the board's hot-path indexes when the
--     board was an account-wide task list. They are **already superseded**: `tasks_board_day_idx`
--     and `tasks_board_status_idx` cover the same shapes on `board_id`, and shipped with the board
--     work. Verified against a local stack before writing this — the drop is index-neutral, not
--     merely believed to be.
--
--   * `tasks_category_check` and `user_settings_default_view_check` are enum-ish CHECKs on columns
--     nothing reads. They go with their columns and are not replaced.
--
--   * `tasks_user_id_fkey ... ON DELETE CASCADE` is the one that matters. It is what used to delete
--     an Account's Tasks when its `auth.users` row went away. That guarantee now rests entirely on
--     `handle_account_deletion`, which drops the Account's Private Boards, and `tasks.board_id`'s
--     own `ON DELETE CASCADE` doing the rest. Same outcome, different mechanism — and it was
--     untested in both the before and after states, so `boards.test.ts` now covers it.
--
--     One behavioural note for when sharing exists: the old foreign key deleted a departing
--     Account's Tasks even from a Board it did not own. The new path does not — a Shared Board is
--     not dropped, so the content stays with the Board. That is the better answer, and today it is
--     moot because every Board has exactly one Membership.

alter table public.tasks
  drop column user_id,
  drop column category,
  drop column label_assignment_explicit;

alter table public.user_settings
  drop column default_view;
