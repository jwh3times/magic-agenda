# Completion: Workflow Status is the app-domain source of truth

`Task.status` uses the app-owned tokens `todo`, `doing`, and `completed`; there is no Task-level
`done` boolean. The database's frozen `done` token is translated only by `rowToTask` / `taskToRow`,
and the `done` member on a Checklist Step is a separate concept. `completionDecision()` is the one
pure transition seam for card Complete/Reopen, editor changes, and Kanban moves. Its caller supplies
the timestamp. Quick Reopen restores `reopenStatus`, while an explicit move to an active status uses
that destination; every Reopen also clears Completion and Archive state. The editor reconciles the
final draft against the original Task on Save, so an ordinary edit to a Completed Task preserves its
timestamp and changing status away and back before Save is a no-op.

**Since #241 the client's answer is a guess and the database's is the record.**
`enforce_task_completion_lifecycle` is a `before insert or update` trigger on `tasks` — invoker
security, empty `search_path`, schema-qualified throughout — and it rewrites the three lifecycle
columns on every write. The one thing to understand about it is **which row it reads**: entering
Completed takes the remembered active status from `old.status`, never from the payload. That is what
lets a client from before v1.8.58, which knows only `status`, still produce a coherent row instead of
a contradictory one, and it is why status-changing PostgREST writes request and reconcile the
authoritative returned rows rather than keeping the optimistic guess.

The rest of the transition table falls out of that: remaining Completed preserves the stored
`completed_at`, so an ordinary edit cannot move it even though `taskToRow` re-sends the column on
every write; entering an active status clears Completion and Archive and records the status just
entered; and Archive is its own transition, where the **first** one is stamped by the server, so a
supplied instant cannot backdate it and staying Archived preserves the original. The single
exception is INSERT, which keeps a supplied `completed_at` and `archived_at` — that is how a v3
backup restores the instants its file recorded, and the only case where a client value survives.

Three named invariants back the trigger up: `tasks_completed_at_matches_status`
(`completed_at` present exactly when the status is `done`), `tasks_archived_at_requires_completed`,
and `tasks_reopen_status_active` on a now-NOT NULL column. They are named rather than anonymous
because error mapping and tests key on SQLSTATE plus a constraint name, never message prose. They
are **not** redundant with the trigger: `data.sql` restores under `session_replication_role =
replica`, which fires no triggers at all, so a restore meets the constraints and nothing else.
`tests/rls/completion_lifecycle.test.ts` reaches them the same way, by disabling the trigger.
`reopen_status` also carries `default 'todo'`, which is never observable — the trigger overwrites it
on every insert — and exists solely so NOT NULL does not make the column a _required_ field in the
generated Insert type, forcing every caller to name a value the database is about to discard.

`Task.reopenStatus` is correspondingly non-nullable. Every stored row now has a remembered active
status, so a Task without one is a state the domain no longer admits — the same narrowing #205 made
for `Occurrence.occurrenceDate`, and it deletes the `?? 'todo'` fallbacks rather than adding any. The
nulls that remain are foreign input, normalized where it enters: `ExportTask.reopenStatus` stays
nullable because v3 shipped before the backfill and files already written can carry null, and
`fromExportTask` reopens those to To Do exactly as ADR-0003 says a legacy Task does.

The backfill itself was one migration and two statements, and both of its judgement calls are worth
keeping. `updated_at` is the proxy for a historical Completion — migration time would invent a spike
on one date, `created_at` describes when the Task was written rather than when the work finished, and
the true instant does not exist. And it runs with `tasks_set_updated_at` and `tasks_stamp_attribution`
**disabled**, because a backfill must not look like an edit: the first would overwrite the very
column the proxy reads, and the second would bump `revision` on every row and stamp a null
`last_editor_id`, rewriting the attribution #291 deliberately declined to backfill.

Export (v3 onward) writes the canonical Workflow Status and preserves `completedAt`, `reopenStatus`,
and `archivedAt`. The v1/v2 formats remain frozen with the `done` token and still parse without a
Completion instant, because the file never recorded one and `parseExport` has no clock — but the
write now supplies one, so **importing a legacy Completed Task dates its Completion to the import**.
That is forced rather than chosen: a Completed Task must have a Completed At, and import time is the
only value in existence. Offline Task snapshots went to version 7 for the same domain-shape break.
No Archive affordance ships yet, so the Archive paths above are reachable only by import and by
direct Data API writes.
