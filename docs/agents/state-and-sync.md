# Client state and realtime sync

Who owns board state, which provider mounts where, and the one `postgres_changes` module its three
adapters share. Read before adding a hook that loads or subscribes to a table, or before moving a
provider.

## Data ownership: `BoardPage` owns state; task operations cross one context seam

`pages/BoardPage.tsx` wires `useTasks(userId, boardId, hasSession)` + `useSettingsContext()` +
`useBoardDirectoryContext()` / `useBoardSession()` + `useLabelDirectoryContext()` +
`ThemeProvider`, then wraps the rendered board in `DueClockProvider` and publishes the
board-facing half of `useTasks` through `TaskBoardContext`. `boardId` is the session-wide Board
Directory's resolved selection (`selectedBoardId`, see below), not something `BoardPage` decides
itself: while the directory is still loading it is `null`, `useTasks` guards on `!boardId` the same
shape as its existing `!userId` guard, and `BoardPage` gates its own render on `boardsLoading` too —
rendering before the directory resolves would show the board's empty state, indistinguishable from a
genuinely empty board. It also waits for Labels; a Directory, Task, or Label snapshot makes the
whole board read-only, since a stale Membership role or only half of the Board vocabulary is unsafe
to edit against. `snapshotFallback.ts` classifies the final PostgREST response by stable status
(`0` transport, `401`/`403` auth, everything else request failure), never message prose, and
`BoardPage` gives the most actionable reason to `OfflineBanner`. The snapshot remains readable for
every failure, but only a transport failure is called Offline; a successful live load remains the
only path that clears fallback state and allows the Board Directory to purge revoked snapshots.
`Board` holds only
**UI** state (view, anchor date, editing modal, pop animation, filter); its props are account
settings/navigation plus the derived `assignLabels` capability, not task operations. This keeps
`Board` testable without Supabase: `Board.test.tsx` supplies the same `TaskBoard` interface with a
stateful in-memory adapter. Tests that mock `useTasks` itself start from `fakeUseTasks()`, and tests
that mock the Board Directory start from `fakeBoardDirectory()` (`src/board/fakeBoardDirectory.ts`),
while Label Directory consumers start from `fakeLabelDirectory()`
(`src/labels/fakeLabelDirectory.ts`). These follow the same typed-fake precedent as `fakeUseTasks`
and `fakeAuthGateway`, so interface additions cannot leave partial, untyped return objects behind.
`useTasks` remains the single source of truth for board tasks: optimistic CRUD with rollback, plus
`persistReorder` (upserts only the changed lanes) and, since #270, `bulkUpdate` / `bulkDelete`.
These are one batched write per selection, planned by `src/data/bulk.ts` and `planBulkDelete`; see
[Recurrence](recurrence.md) for how bulk delete treats Occurrences.

**Undo (#271) is one level, row-scoped, and owned by `useTasks`.** After a successful
Complete/Reopen, plain or single-Occurrence delete, drag, roll-forward, or bulk change, the hook
records the prior version of exactly the rows that action wrote (`captureUndo`,
`src/data/undo.ts`) and publishes `lastUndo` for `Board`'s 6-second toast. Two rules keep it
honest. **Any other write from this client forgets the entry**, because undoing past a later edit
would silently revert that edit. **A drag's "before" is the board when the drag began:**
`previewReorder` records that origin on its first hover, since by drop time `tasksRef` already holds
the preview. The origin is stamped with the write generation, a board generation (bumped by
reloads and remote changes), and the Board, so a cancelled drag's origin can never be inherited by a
later drag; a drop whose origin went stale offers no undo rather than a wrong one. The same write
generation closes the in-flight race: an action may offer undo only if no later write started
while it awaited, or undoing it would revert that later write. An entry also records its Board,
and switching Boards hides and refuses it, because undo writes with the current `board_id`. A
re-inserted row is new to the attribution trigger, so an undone delete is re-authored by whoever
clicked Undo. Undo writes definitions before Occurrences, reconciles returned rows, writes
attachments last, needs the same complete authenticated load as a Series plan, and reloads on
failure. It is last-write-wins
against other devices, and the post-undo notice (`UNDONE_NOTICE`) says so. Series-level
operations (edit or delete this-and-future, promotion, ending a Series) are excluded, as is any
editor save. Its raw React setter is private; drag-over uses
the narrower `previewReorder(next)` command.

**An undo entry also carries the attachment rows a delete cascaded away (#404).** They are the one
thing in it that does not come from the board snapshot: `task_attachments` is not part of client
state and is not read until an editor asks for it. So a delete reads them from the server, in the
window **after the optimistic removal and before the DELETE** — the only moment where the rows
still exist and the user has already seen the Task go. `removeTask` and `runPlan` each take a
`beforeWrites`-shaped callback for exactly that, and the capture
(`captureTaskAttachments`, `src/data/attachments.ts`) **never throws**: a read that cannot answer
costs the undo its attachments, never the user their delete. Restoring goes last, because the
composite foreign key gives the rows nowhere to point until the Task is back, and it is an
`ON CONFLICT DO NOTHING` insert — an entry covers every id its action touched rather than only the
deleted ones, and UPDATE on that table grants `filename` alone, so a merging upsert would be
refused outright. The original ids come back with the rows, which is what matters: `storage_path`
is generated from `id`, so a restored row addresses the same object — and it is still there
because deleting a Task deliberately leaves its files in storage. Between the delete and the
restore no member can read that file: the object policy requires a row for its path
([Boards](boards.md)).

Board snapshots are an offline cache, so old data is repaired at its read seam as well as at the
database mapper. A current-version snapshot written before #369 may contain Inbox plus Due Time;
`readBoardSnapshot()` clears that Due Time before publishing Tasks while preserving the rest of the
cache. This is a semantic invariant, not a shape change, so it does not spend a snapshot version.

Default View is a **Membership Preference, not an Account Preference**, and since #180 it is only
that. `board_memberships.default_view` describes how this Account experiences _this_ Board, so
`BoardPage` and `SettingsPage` read `board?.defaultView ?? DEFAULT_VIEW` and write it through
`useBoardDirectory`'s `setDefaultView()` (via the column-level `grant update (default_view)` in [Boards](boards.md)).
`DEFAULT_VIEW` lives in `src/board/selection.ts` and is **not** a user preference or a fallback for
a missing one — every Membership row carries `default_view` NOT NULL with its own `'calendar'`
default, so it only covers the window before that row is in hand.

`user_settings.default_view` carried a second copy through the Board cutover, and `SettingsPage`
wrote _both_ on every change so the then-deployed client kept reading a value it understood. That
dual write is gone: `Settings` no longer has a `defaultView` field, `saveView()` no longer exists,
and `SettingsPage.test.tsx` asserts the `user_settings` upsert is **not** called when the view
changes — the absence is what stops the two sources silently diverging again. The column itself is
gone too, dropped with the rest of the retired columns (see [Labels](labels.md)).

`BoardActionContext` is the internal UI seam below `Board`. It publishes editor/add/card actions and
the done-pop id at their use sites, so the view modules pass tasks and layout parameters rather than
relaying a handler bag through `CalendarView` -> `DayCell` -> `SortableCard` -> `TaskCard`. With no
provider, `TaskCard` is deliberately decorative; the landing preview relies on that default. To
follow a write end-to-end, read the consuming card/cell -> `Board` -> `TaskBoardContext` ->
`useTasks`.

**`user_settings.keyboard_shortcuts` (#269) ships a release ahead of its client, and every reader
defaults it on.** It is the WCAG 2.1.4 off switch for the board's single-letter shortcuts, an Account
Preference by the maintainer's decision. Adding a column the client writes takes two releases here:
`useSettings.persist` upserts every settings field it knows, so a client sending `keyboard_shortcuts`
before the column existed would have **every** settings save refused with `400 PGRST204`. The
migration (`20260913120000`, `boolean not null default true`) therefore ships alone, and
`tests/rls/settings_keyboard_shortcuts.test.ts` pins that the then-deployed client's exact upsert
still succeeds and does not reset a preference that is off. On the reading side **a missing value is
on everywhere**: a row read in the deploy window (`data.keyboard_shortcuts ?? true`), a realtime
payload, and an offline settings snapshot written before the field existed — the snapshot fallback
spreads over `DEFAULTS` rather than trusting the stored shape, which is why the shared snapshot
version did not need a bump.

**`user_settings.reminder_lead_minutes` (#267) follows the same database-first release rule.** The
nullable integer is an Account Preference: NULL is off and 0–10080 is the lead in minutes. The
database requires a real IANA `timezone` whenever it is non-NULL because the scheduled sender has
no browser whose Automatic zone it can follow. It shipped in v1.12.8 before the client began naming
it. Readers default a missing column or older settings snapshot to NULL, so the deploy window and
offline cache both remain safely off.

Settings are **session-scoped, not page-scoped**: `SettingsProvider` (`src/data/SettingsProvider.tsx`)
owns the single `useSettings(userId, hasSession)` call above `<Routes>` in `App.tsx`, so navigating
between `/` and `/settings` no longer refetches or rebuilds the realtime channel. It mounts for
signed-out visitors too, which is why `useSettings` no-ops on an empty `userId`.
`BoardDirectoryProvider` (`src/board/BoardDirectoryProvider.tsx`) is mounted the same way, above
`<Routes>` beside `SettingsProvider`, and for the same reason — `/` and `/settings` are mutually
exclusive, and `DataSection` on `/settings` writes tasks on import, so it needs a Board id just as
much as the board itself does. Unlike `useTasks`, hoisting it costs nothing at the entry chunk: it
is one small query plus a pure selection, with no dnd-kit or board data layer behind it. `useTasks`
is deliberately **not** hoisted with either — `BoardPage` is lazy-loaded to keep dnd-kit and the
board data layer out of the entry chunk.

**`useTasks`, `useSettings`, and `useBoardDirectory` all take `userId` and `hasSession` as separate
arguments, on purpose.** `userId` may resolve from the last-known id in `localStorage` with no live
session behind it (the offline-boot fallback), which is fine for _reading_ a snapshot — but a
snapshot _write_, or trusting an empty server response, requires the stricter `hasSession`.
Collapsing the two is not hypothetical: a signed-out visitor with a stale `ma-last-user` queries
`user_settings` from the public landing page, RLS returns zero rows **with no error**, and treating
that as "no row yet" overwrites the user's saved settings snapshot with `DEFAULTS`. The same
conflation lets a sessionless reconnect persist an empty board — or would let `useBoardDirectory`
purge every cached Board snapshot on a device that is merely offline rather than actually revoked.
`useTasks` and `useSettings` share **one implementation** of the write-gate, `canPersistSnapshot()`
in `src/data/snapshot.ts`, whose docstring explains why each of its five clauses is load-bearing; it
previously had two implementations and three prose copies, one of which smuggled the rule in as a
positional boolean argument named `persistSnapshot`. `useBoardDirectory` checks `hasSession`
directly for its own purge decision rather than calling `canPersistSnapshot` — "trust an empty Board
list" is a related but distinct question from the one that function answers. `useTasks` additionally
takes a `boardId`, the Board Directory's resolved selection, and refuses to load or write without
one — the same shape of guard as its `!userId` check.

## Realtime sync is one module, not two copies

`src/data/useSyncedTable.ts` owns the `postgres_changes` channel, echo suppression for this client's
own writes (`useOwnWrites`, a 5s per-id TTL), reconnect with capped exponential backoff, and
catch-up on `visibilitychange`/`online`. `useTasks`, `useSettings`, `useLabels`, and `useBoardDirectory` are its four
adapters and keep only their own load, state shape, and snapshot envelope.

**Echo suppression is revision-aware for `tasks` (#432).** Id-keyed suppression used to drop a
genuine edit to the same row from another device inside the 5s window. Every `tasks` row now
carries a server-stamped `revision` (#291), so each `useTasks` write reports its outcome to the
registry: `settleWrites(rows)` with what the write returned (whole rows where it reconciles,
`.select('id, revision')` where it does not) or `abandonWrites(ids)` on failure. Within the TTL an
event is then suppressed only up to the revision our own write produced, and anything newer is
delivered. Realtime can deliver an echo **before** the HTTP response that names its revision, so
while a write is pending the newest revisioned payload for that row is held rather than judged, and
released when the write settles if it proves newer (the channel drops it if it has been torn down,
since a Board switch would otherwise land it on the wrong Board). DELETE payloads carry no revision:
one counts as ours while any write to the row is pending (which is every delete of ours, since a
DELETE is never settled) and as another writer's once all have settled. Two things keep the old
behaviour on purpose: `user_settings` and `labels` have no `revision`, so they stay plain id + TTL;
and a write that never reports degrades to exactly that, dropping what it held at expiry. Non-status
writes read their returned rows for the revision **only** — reconciling them would let a slow
response overwrite a newer optimistic edit, which is why only status changes (trigger-stamped
Completion values) replace the optimistic row.

**`useTasks` is bound to the Board it loaded.** On a Board switch `reload()` first clears the
Board-bound state (tasks, Series definitions, revisions, offline flags). Its in-flight guard is
per-Board, and a load for another Board supersedes the running one through `loadSeq`; the
superseded load re-checks after each await so its rows never land, and `materialize` likewise
drops its outcome after a switch. Every Task write that targets one row (`updateTask`, the
compare-and-swap save, `toggleCompletion`, `removeTask`) also filters `.eq('board_id', boardId)`.

**Editor saves of one Task or Occurrence are compare-and-swap (#433).** `useTasks` keeps the last
server revision it saw per Task, from loads, realtime events, and every write that returns rows
(`revisionOf`). `Board` records it when the editor opens, and `saveTask` passes it down, so the
save is `UPDATE … WHERE id = ? AND revision = ?`, never an upsert. A zero-row result means nothing
was written: the optimistic change is undone, and `explainMissedSave` re-reads to tell three
cases apart, because the server does not distinguish them for the caller:

- The row is still visible: someone saved first (`stale-revision`). The board now shows their
  version.
- It is gone, but the caller is still a member: the Task was deleted (`task-deleted`), and it
  leaves the board.
- Access is gone (`membership-ended`).

`ConflictDialog` offers "Keep theirs" or "Overwrite with mine" for a stale save only. Overwrite is
a new, deliberate save against the reported revision, and it can itself conflict. A deleted Task
offers nothing to retry, since saving over it would resurrect it. Small actions — pin, complete, a
Step — keep writing their own field against the latest row. Series-wide edits, reorders, and bulk
changes go through `apply_task_writes` in one transaction instead (#434; see [Recurrence](recurrence.md)).
`tests/rls/task_compare_and_swap.test.ts` pins the database half.

**The filter is part of the adapter's spec, not hardcoded.** It was `user_id=eq.<userId>` for both
tables until the authorization cutover; `tasks` and, since #188, `labels` filter on `board_id` (a
user-scoped subscription would deliver changes for every Board the Account belongs to, including
rows this client is not loading), while `user_settings` stays on `user_id` because that genuinely is
what scopes it. The channel topic is scoped by the filter value for the same reason — two Boards
sharing one topic would reuse a subscription bound to the wrong filter. An empty filter value opens
no channel, exactly as an empty `userId` does: the Board Directory resolves asynchronously, and an
unfiltered subscription in that window is the realtime twin of an unfiltered load.

**`useBoardDirectory` is the fourth adapter, and it exists for revocation (#439).** The server never
says "you were removed": it stops returning the Board, and a `board_id`-filtered task channel goes
quiet rather than announcing anything. So `board_memberships` is published, and the directory
subscribes filtered to `account_id=eq.<userId>`: an Owner ending your Membership is an UPDATE to
your own row, which the table's own-rows SELECT policy lets Realtime deliver to you and nobody else
(`tests/rls/membership_realtime.test.ts` checks both halves against the real Realtime service).
Three things re-ask which Boards are still reachable, all as **background** revalidations: that
channel, `useSyncedTable`'s reconnect and visibility/online catch-up (which replaced a hand-rolled
copy in the directory), and a `REVALIDATE_INTERVAL_MS` (5 min) heartbeat for a visible tab whose
socket died silently. A background revalidation **never sets `loading`**: `BoardPage` shows a
full-page spinner while the directory loads, so one that did would unmount the Board, and the
editor, on every focus and heartbeat. The pre-#439 focus catch-up did exactly that.

The reload that follows already purges the snapshots of unreachable Boards and reselects, so
revocation needs no new cleanup path. A Board that vanished during a background revalidation is
named in `lostAccess`, which `BoardPage` shows as a notice that does not say whether it was removed
or deleted, because the server does not tell a former member which. Two details: DELETE events
fan out to every subscriber, so the directory ignores a DELETE for a Membership id it does not
hold, or a Board deleted by anyone would make every client re-read; and `setDefaultView` marks its
own write, so a Default View change does not echo back as a revalidation.

This was two divergent copies until v1.2.57, and the divergence was a live bug, not just
duplication: **`useSettings` had no reconnect path at all.** Its entire subscription tail was
`.subscribe()` — no status callback, no backoff, no catch-up listener — so a settings channel that
errored after a phone slept stayed dead for the session while the board kept syncing, and
cross-device theme/week-start/timezone changes silently stopped arriving. This paragraph used to
describe both hooks as reloading and resubscribing with backoff; only one of them did (#130).

Two details worth keeping: `rowIdOf` reads `payload.old` for DELETE and `payload.new` otherwise,
because a DELETE payload carries **only** the primary key (replica identity is DEFAULT, and
Supabase forces that for RLS-enabled tables) — reading `new` would make every delete look like
another client's write. And the primary key differs per table (`tasks.id` and `labels.id` vs
`user_settings.user_id`), which is why the id extraction could not stay inline in any of the hooks.

Remote task changes still flow through the pure reducer in `src/data/realtime.ts` (instance dedupe
by `(recurParentId, occurrenceDate)`, templates routed to `templatesRef`).
