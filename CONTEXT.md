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
standalone Task becomes a Recurring Series when a Recurrence Rule is added to it.
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
