# Magic Agenda Domain

Magic Agenda organizes personal and shared work on Boards. This glossary names the concepts whose
meaning must stay consistent across the product, documentation, and code.

## Board content

**Board**:
A workspace that owns its Tasks, Recurring Series, and Label vocabulary.

**Task**:
A unit of work contained by one Board. A Task may be Unlabeled or assigned one Label.

**Recurring Series**:
A rule that produces related Task occurrences while remaining part of one Board.

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
