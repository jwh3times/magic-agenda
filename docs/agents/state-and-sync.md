# Client state and realtime sync

Who owns board state, which provider mounts where, and the one `postgres_changes` module its three
adapters share. Read before adding a hook that loads or subscribes to a table, or before moving a
provider.

## Data ownership: `BoardPage` owns state; task operations cross one context seam

`pages/BoardPage.tsx` wires `useTasks(userId, boardId, hasSession)` + `useSettingsContext()` +
`useBoardDirectoryContext()` / `useBoardSession()` + `useLabelDirectoryContext()` +
`ThemeProvider`, then publishes the
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
`persistReorder` (upserts only the changed lanes). Its raw React setter is private; drag-over uses
the narrower `previewReorder(next)` command.

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
catch-up on `visibilitychange`/`online`. `useTasks`, `useSettings`, and `useLabels` are its three
adapters and keep only their own load, state shape, and snapshot envelope.

**The filter is part of the adapter's spec, not hardcoded.** It was `user_id=eq.<userId>` for both
tables until the authorization cutover; `tasks` and, since #188, `labels` filter on `board_id` (a
user-scoped subscription would deliver changes for every Board the Account belongs to, including
rows this client is not loading), while `user_settings` stays on `user_id` because that genuinely is
what scopes it. The channel topic is scoped by the filter value for the same reason — two Boards
sharing one topic would reuse a subscription bound to the wrong filter. An empty filter value opens
no channel, exactly as an empty `userId` does: the Board Directory resolves asynchronously, and an
unfiltered subscription in that window is the realtime twin of an unfiltered load.

`useBoardDirectory` registers its **own** `visibilitychange`/`online` catch-up, deliberately not
folded in here. Nothing pushes "you were removed" to a client — the server just stops returning the
Board, and a `board_id`-filtered channel goes quiet rather than announcing anything — so access has
to be revalidated rather than awaited. Note this covers waking and reconnecting, **not** a tab that
stays open and focused; a heartbeat for that belongs with sharing, when someone else can revoke you.

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
