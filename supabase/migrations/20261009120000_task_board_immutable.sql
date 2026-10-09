-- ---------------------------------------------------------------------------
-- A Task stays in the Board it was created in
-- ---------------------------------------------------------------------------
-- `tasks_update_editor` asks only that the caller can edit the row's Board before and after the
-- write. A caller who can edit two Boards satisfies both halves, so one UPDATE could carry a Task
-- from a private Board into a shared one, where every member can read it. Nothing else refused
-- it: `board_id` is in the UPDATE grant because every client write resends the whole row, and the
-- composite foreign keys and the assignee trigger stop only a Task that has a Label, a Series,
-- an attachment, or an assignee who is not a member of the target.
--
-- No feature moves a Task between Boards, so the column is made immutable rather than the move
-- being authorized more carefully. Resending the unchanged value is untouched, which is what
-- every legitimate write does. `apply_task_writes` already scoped its updates to one Board; this
-- covers the single-row UPDATEs and any caller that bypasses the app.
--
-- Security invoker: it reads no table, so it borrows nothing. It raises `task-board-immutable`.

create function public.enforce_task_board_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '23514', message = 'task-board-immutable';
end;
$$;

create trigger tasks_enforce_board_immutable
  before update of board_id on public.tasks
  for each row
  when (old.board_id is distinct from new.board_id)
  execute function public.enforce_task_board_immutable();

-- Owner only: it runs as a trigger, never as an RPC.
revoke all on function public.enforce_task_board_immutable()
  from public, anon, authenticated, service_role;
