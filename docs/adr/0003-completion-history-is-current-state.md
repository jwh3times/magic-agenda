# Completion is a workflow transition and history is current state

A Task has exactly one **Workflow Status**: To Do, In Progress, or Completed. **Completion** is the
transition into Completed, not a second boolean fact, and **Completion History** is derived from the
Tasks that are currently Completed rather than from an append-only ledger of every transition. This
keeps the Board's history aligned with its current truth, accepting that Reopening or deletion
changes past statistics instead of preserving an audit trail.

## The state model

| Operation                                            | Result                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| Complete a To Do or In Progress Task                 | Remember its active status, enter Completed, establish Completed At              |
| Reopen a Completed Task                              | Return to its remembered active status and remove Completed At                   |
| Move a Completed Task explicitly to an active status | Reopen to the chosen status, which becomes the remembered active status          |
| Archive a Completed Task                             | Keep it Completed and preserve Completed At, but remove it from the active Board |
| Unarchive an Archived Task                           | Return it to the active Board still Completed, with Completed At unchanged       |
| Reopen an Archived Task                              | Unarchive it, return to its remembered active status, and remove Completed At    |

A legacy Task with no remembered active status reopens to To Do. Completing every Checklist Step
does not perform Completion; Step Completion and Workflow Status remain independent Occurrence
State.

## Considered options

**Completion as a separate fact from Workflow Status** was rejected. It admits contradictory states
such as an In Progress Task that is also complete and leaves every view and command to decide which
dimension wins. The existing derived `done` value demonstrates the duplication without adding a
second domain concept.

**An append-only completion-event ledger** was rejected for this feature. It would count work the
Board later says is incomplete, retain records for deleted Tasks, and require new identity,
idempotency, deletion, transfer, and authorization rules. If Magic Agenda later needs immutable
audit or analytics, that is a new event model rather than an extension of Completion History.

**Always reopening to To Do** was rejected because it silently loses an In Progress Task's place.
**Always prompting for a destination** was rejected because the common Complete/Reopen control
would become a choice dialog. Remembering the prior active status preserves intent, while an
explicit Kanban move or editor choice remains authoritative.

**Archive as a presentation filter** was rejected because changing a filter would change whether a
Task was considered archived. Archive is durable Board state with a real lifecycle; ordinary
filtering may hide a Task without archiving it.

## Consequences

- **Completed At describes only the current Completion.** Reopening clears it; recompleting creates
  a new value. A Task therefore contributes at most once to Completion History and moves to the new
  period when recompleted.
- **Throughput counts Tasks, not transitions or Checklist Steps.** A standalone Task and each
  Occurrence count independently. Archived Tasks count; Reopened and deleted Tasks do not.
- **Completion Streak uses the same current-state data.** Calendar buckets are interpreted in the
  viewing Account's Timezone, so members may group the same shared completion instant into
  different dates without changing the Board-owned record.
- **Archive is available only to Completed Tasks.** Unarchiving preserves Completed status;
  Reopening also unarchives. An Archived Occurrence remains attached to its Recurring Series and
  occupies its Occurrence Date, so Archive never creates an Excluded Date.
- **Completion fields are Occurrence State under ADR-0002.** The remembered active status,
  Completed At, and Archive state never propagate through This and All Future, and a Recurring
  Series definition carries no meaningful values for them.
- **The app-domain `done` boolean is redundant.** Follow-up work should make Workflow Status the
  single source of truth and translate any frozen database or export-file token at those seams
  rather than preserving duplicate state in `Task`.
- **Completion History is not an audit promise.** A future requirement to retain every completion,
  reopening, or deletion must introduce a separate event model and revisit this decision
  explicitly.
