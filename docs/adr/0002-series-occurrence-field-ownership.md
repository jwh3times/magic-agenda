# Every field of a Task belongs to exactly one owner

Each field of a Task is owned by the **Recurrence Rule**, by **Series Content**, by **Occurrence
State**, or by **Occurrence Placement** — never by two of them and never by none. The two scopes
follow from that partition rather than being decided per field: **This Occurrence** may change
anything on one Occurrence, and **This and All Future** may change only Series Content and the
Recurrence Rule, applying them to the edited Occurrence, every later one, and every Occurrence not
yet produced.

The partition is the decision. Before it, the app carried two overlapping lists — the fields whose
change skipped the scope prompt, and the fields an all-future edit copied — which were documented as
"not exact complements". Four fields fell through the gap between them (`day`, `order`, `korder`,
and the checklist), and each gap was a silent data loss rather than an error.

## The partition

| Owner                | Fields                                                                        |
| -------------------- | ----------------------------------------------------------------------------- |
| Recurrence Rule      | how often, from which date, until when, which dates are excluded              |
| Series Content       | title, description, Label, Note Color, due time, Checklist (its Steps)        |
| Occurrence State     | workflow status, Step Completion, pinned                                      |
| Occurrence Placement | Scheduled Day, manual order within a day, manual order within a Kanban column |
| Identity             | the Occurrence's own identity, its Series, and its Occurrence Date            |

Identity is listed for completeness: it is not editable content, so no scope applies to it.

## Considered options

**Checklist ownership.** Making the Checklist entirely per-Occurrence was rejected: a recurring
routine's steps are the clearest case of shared substance there is, and per-Occurrence checklists
mean editing a routine card by card. Formalizing the existing behaviour — the Series changes and
existing Occurrences do not — was rejected because it makes the 90-day materialization horizon a
user-visible boundary, so an edit appears to do nothing for up to three months.

**Reconciling Step Completion.** Matching Steps by position was rejected because inserting or
reordering a Step silently moves every tick onto the wrong Step. Resetting all completion on any
structure change was rejected as destroying real progress for a typo fix.

**Customized Occurrences.** Skipping Occurrences a user had individually edited, or prompting about
them, would each require recording which fields an Occurrence had overridden — new schema, and a new
domain concept — in exchange for making "all future" mean something other than all future.

## Consequences

- **A Checklist Step must keep one identity across its whole Series.** This is the reversal cost:
  Occurrences currently mint fresh Step ids at materialization, so completion can only be matched
  positionally. Once ticks are reconciled by Step identity, moving back to position matching would
  mis-assign existing completion rather than merely behave differently.
- **A renamed Step keeps its ticks; a removed Step takes its ticks with it; a new Step arrives
  unticked.** These follow from identity matching and need no separate rule.
- **"All future" overwrites customizations,** which is a real cost accepted deliberately. The
  alternative was a concept — an Occurrence that remembers what it overrode — that the schema cannot
  express today and that makes the scope prompt harder to predict, not easier.
- **A pin is never inherited.** Pinning is Occurrence State, so a Recurring Series has no pin to pass
  on. This removes a hidden channel in which a Series' pin was fixed when the Series was created and
  could never be changed afterwards.
- **Changing an Occurrence's Scheduled Day or manual order never raises the scope question,** because
  neither has any meaning beyond that one Occurrence. Rescheduling a Series is a change to its
  Recurrence Rule, which is a different operation.
- **The two lists in code stop being independent.** They are complements of one partition, so the
  supported way to add a field to `Task` is to give it an owner; a field with no owner is the bug
  this ADR exists to prevent.
