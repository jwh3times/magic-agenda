# A Task has one date commitment

Magic Agenda treats a Task's **Scheduled Day** as both its calendar placement and the day on which
it is due, with an optional **Due Time** refining the deadline within that day. There is no separate
due date or scheduled start time. This keeps the calendar about planned commitments, preserves the
existing drag-and-drop model, and gives Overdue and Reminders one predictable source.

## Boundary rules

- A timed Task becomes Overdue when the current instant is later than its Due Moment. An untimed
  Task's Due Moment is the first instant of the next local day, and it becomes Overdue when that
  instant is reached. This avoids an implementation-dependent “end of day” precision.
- Due Moments are interpreted separately in each Account's Timezone. Automatic timezone follows
  the browser for interactive use, but server-side Reminders require the Account to choose a
  concrete IANA timezone.
- A fixed Timezone stays fixed when an Account travels; Automatic follows the current browser.
  Therefore two Board members can see the same Task become Overdue, and receive its Reminder, at
  different instants.
- A local Due Time repeated by a daylight-saving fallback uses its first occurrence. A local Due
  Time skipped by a daylight-saving jump moves forward by the size of the gap. Client and sender
  implementations must use that same compatible disambiguation.
- Rescheduling changes the Scheduled Day and therefore the Due Moment. Moving an Occurrence never
  changes its Occurrence Date.
- Rolling Overdue work forward changes only its Scheduled Day. Its Due Time remains intact, so a
  Task moved to today after that time has passed remains Overdue until completed, retimed, or moved
  again.
- Inbox Tasks have no Due Moment and cannot carry a Due Time or Reminder. Moving a timed Task to
  the Inbox clears its Due Time; for an Occurrence, that combined change applies to This Occurrence
  only.
- Completion suppresses a pending Reminder. Reopening before the Due Moment makes the Task eligible
  again, with immediate delivery if its reminder window has already opened; Reopening after the Due
  Moment does not replay a missed Reminder. Archived Tasks are Completed and therefore suppressed.

## Considered options

A separate due date and schedule date were rejected. They would require the calendar, drag actions,
recurrence scopes, Overdue grouping, and Reminders to explain which date they use, while the product
has no second visual surface or user need that justifies that distinction. Treating the optional
time as a scheduled start was also rejected: the UI already presents it as a Due Time, and a start
time gives no boundary for Overdue or reminder delivery.

## Consequences

- Due Time remains Series Content under ADR-0002, while Scheduled Day remains Occurrence Placement.
  Dragging one Occurrence moves its deadline date without changing the Series' shared clock time.
- Reminder delivery is per Account and Due Moment. A Task-level “last notified” value cannot prevent
  duplicates correctly when Board members use different Timezones or reminder lead times.
- Before Reminders ship, the app and database must enforce that Due Time requires a Scheduled Day.
  The editor and drag-and-drop flow must clear Due Time when sending a Task to the Inbox; import
  must reject an invalid pair; and a migration must clean existing invalid rows before adding the
  database constraint.
- Overdue evaluation must accept a current instant and Timezone, compare timed Tasks precisely, and
  refresh when a Due Moment or local-day boundary passes. Roll-forward tests must cover timed Tasks
  whose Due Time has already passed on the destination day.
