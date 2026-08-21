# Magic Agenda Domain

Magic Agenda organizes personal and shared work on Boards. This glossary names the concepts whose
meaning must stay consistent across the product, documentation, and code.

## Board content

**Board**:
A workspace that owns its Tasks, Recurring Series, and Label vocabulary.

**Task**:
A unit of work contained by one Board. Every Task is either standalone or an Occurrence of a
Recurring Series, and may be Unlabeled or assigned one Label.
_Avoid_: item, entry, to-do

**Scheduled Day**:
The day a Task currently sits on, or the Inbox when it has none. Freely changed by rescheduling,
and never an identity.
_Avoid_: task date, origin date

**Inbox**:
The state of a Task that has no Scheduled Day. It is a property of the Task, not a container that
holds it.
_Avoid_: backlog, unscheduled list

## Recurrence

**Recurring Series**:
A Task that repeats under one Recurrence Rule, appearing on its Board only as its Occurrences. A
standalone Task becomes a Recurring Series when a Recurrence Rule is added to it, and a Series ends
when its Recurrence Rule is removed — it produces no further Occurrences, and the Occurrences it
has already produced remain what they are.
_Avoid_: template, parent task, repeating task

**Recurrence Rule**:
The schedule of a Recurring Series: how often it repeats, from which date, until when, and which
dates are excluded.
_Avoid_: recurrence pattern, repeat config, schedule

**Occurrence**:
A single Task that a Recurring Series produces for one Occurrence Date, edited, rescheduled,
completed, and deleted independently of every other Occurrence. An Occurrence whose Series no
longer exists is a standalone Task.
_Avoid_: instance, materialized task, child task, repeat

**Occurrence Date**:
The date within a Recurring Series that an Occurrence represents. Fixed for the life of the
Occurrence and unchanged by rescheduling, so it — not the Scheduled Day — is what identifies an
Occurrence within its Series.
_Avoid_: origin date, series date

**Excluded Date**:
An Occurrence Date a Recurring Series no longer produces, because its Occurrence was deleted. A
Series never regenerates an Occurrence on an Excluded Date.
_Avoid_: skipped date, cancelled occurrence, exception date

**Series Content**:
The shared substance of a Recurring Series — what the work is — carried by every Occurrence it
produces. A Recurring Series owns one copy of it, and changing it can be applied to the whole
Series ahead.
_Avoid_: template fields, shared fields, parent content

**Occurrence State**:
What a person has done to one Occurrence: its workflow status, which of its Checklist Steps are
complete, and whether it is pinned. It belongs to that Occurrence alone and is never shared with
the Recurring Series or with any other Occurrence.
_Avoid_: instance state, per-occurrence fields, progress

**Occurrence Placement**:
Where one Occurrence sits: its Scheduled Day and its manual position within that day or Kanban
column. It belongs to that Occurrence alone, so moving one Occurrence never moves another.
_Avoid_: position, ordering, layout

**This Occurrence**:
The editing scope that changes one Occurrence and nothing else. It is available for any change, and
it is the only scope that can change Occurrence State or Occurrence Placement.
_Avoid_: single, this one only, just this

**This and All Future**:
The editing scope that changes Series Content or the Recurrence Rule for the edited Occurrence, every
later Occurrence, and every Occurrence the Series has yet to produce. It overwrites Occurrences that
were customized individually, and it never changes Occurrence State or Occurrence Placement.
Removing the Recurrence Rule under this scope ends the Series at the edited Occurrence: earlier
Occurrences are left alone, the edited Occurrence becomes a standalone Task, and no later Occurrence
survives or is produced.
_Avoid_: all following, the rest of the series, future only

**Checklist**:
The ordered list of Steps describing how a Task is carried out. On a Recurring Series it is Series
Content, so every Occurrence carries the same Steps.
_Avoid_: subtasks, todo list, sub-items

**Step Completion**:
Which of an Occurrence's Checklist Steps are done. It is Occurrence State, so completing a Step on
one Occurrence never affects another, and editing a Series' Checklist preserves the completion of
every Step that survives the edit.
_Avoid_: checklist progress, subtask status

## Classification and appearance

**Label**:
A Board-owned classification that may be assigned to a Task. Label names preserve display casing
but are trimmed and unique without regard to case within their Board; deleting a Label leaves its
Tasks Unlabeled.
_Avoid_: Category, tag

**Seeded Label**:
An ordinary Label created with a Board to provide a useful starting vocabulary. Seeded Labels have
no permanent or privileged status and may be edited or deleted.
_Avoid_: Built-in category, system label

**Unlabeled**:
The absence of a Label assignment on a Task, not a special Label.
_Avoid_: Unlabeled label, default label

**Label Color**:
The visual accent belonging to a Label and communicating that Label's identity.
_Avoid_: Category color

**Note Color**:
The visual appearance of a Task's note or card. It carries no classification meaning and is
independent of Label Color.
_Avoid_: Label color, category color
