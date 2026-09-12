# Labels and the import/export file format

Board-owned classification vocabulary, the retired Category compatibility layer, and
`src/data/exportImport.ts`. Read before changing Label management, the `labels` policies, or the
export file format.

`labels` is Board-owned vocabulary. Every current member may SELECT definitions; only an Owner may
create, rename, recolor, reorder, or delete them. The grants carry part of that boundary: INSERT is
limited to `(board_id, name, dot_color, position)` and UPDATE to `(name, dot_color, position)`, so a
client cannot move a Label across Boards even if its RLS predicate would otherwise accept the row.
There is deliberately no `service_role` grant.

A Task has zero or one Label. The composite foreign key
`(board_id, label_id) -> labels(board_id, id)` makes cross-Board assignment impossible, and its
column-list `on delete set null (label_id)` preserves the Task's NOT NULL Board containment when a
Label is deleted. `Unlabeled` is therefore `label_id = NULL`, never a Label row. Label Color is the
definition's dot/accent and is independent from the Task's visual Note Color.

**The Category compatibility layer is gone entirely** (window declared closed 2026-08-19).
`tasks_sync_legacy_category_label`, `labels.legacy_category`, `tasks.category`,
`tasks.label_assignment_explicit`, `tasks.user_id`, and `user_settings.default_view` no longer
exist. The app domain uses
`Task.labelId: string | null`; Category survives only in the **v1 file parser** in
`src/data/exportImport.ts`, where legacy Categories normalize into synthetic source Labels and go
through the same explicit destination mapping as v2.

**Retiring it took three releases, and each boundary was forced by a different race.** Both are
about writes only — reads were never affected, since `select('*')` simply returns fewer columns and
`rowToTask` never read `category`.

1. **Migration first** (#180, v1.8.2). Dropped the bridge and the alias, and relaxed
   `tasks.user_id` to nullable. The client kept sending `user_id` here.
2. **Client next** (#199, v1.8.3). Stopped sending `user_id`. It could not be folded into step 1,
   because **`Deploy Migrations` and the Cloudflare Pages build race on every merge** — a client
   that stopped sending a `NOT NULL` column could reach users before the migration relaxed it. E2E
   proved this rather than predicting it: the preview build ran against production, where the
   constraint was still in force, and could not create a task at all.
3. **Drop the columns** (#197). Could not be folded into step 2 either, because the mirror race
   applies: a drop landing before the new client deploys leaves the still-deployed client sending a
   column that no longer exists, which PostgREST answers with `400 PGRST204`.

**Only `user_id` needed all three steps.** `category` and `label_assignment_explicit` have column
defaults, so omitting them is valid on both sides of a migration and they came out in step 1.
`user_id` was `NOT NULL` with no default, which is the whole reason it was the awkward one.

Two things step 3 took with it, worth knowing rather than rediscovering:

- **`tasks_user_day_idx` and `tasks_user_status_idx` went with the column**, and that is fine only
  because `tasks_board_day_idx` and `tasks_board_status_idx` already cover the same shapes on
  `board_id`. Checked against a local stack before writing the migration rather than assumed — those
  two were the board's hot-path indexes back when the board was an account-wide task list.
- **`tasks_user_id_fkey ... ON DELETE CASCADE` was what deleted an Account's Tasks** when its
  `auth.users` row went away. That guarantee now rests entirely on `handle_account_deletion`
  dropping the Account's Private Boards, with `tasks.board_id`'s own cascade doing the rest. Same
  outcome, different mechanism, and it was untested on both sides of the move — `boards.test.ts`
  now covers it, mutation-checked by disabling the Board drop. One behavioural difference for when
  sharing exists: the old foreign key deleted a departing Account's Tasks even from a Board it did
  not own, and the new path does not. That is the better answer, and it is moot while every Board
  has exactly one Membership.

Two traps this uncovered, both of which would have shipped silently:

- **Dropping the bridge trigger and dropping `label_assignment_explicit` from the payload must be
  atomic.** Once the client omits that flag it defaults to `false`, which is exactly the signal the
  bridge read as "a stale client omitted `label_id`" — so with the trigger still in place, every new
  Unlabeled Task would have been assigned the Work Label from `category`'s `'work'` default. Safe
  together, destructive apart, in either order.
- **`handle_new_user` and `create_board` both seeded the five Labels _with_ the alias**, so dropping
  the column without rewriting them fails every signup — the function runs inside the signup
  transaction. The local RLS suite surfaced it as `Database error creating new user`; nothing in the
  app would have.

`tasks.user_id` is the one column that needed a schema change rather than just a quieter client:
it was `NOT NULL` with **no default**, unlike the others, so there was no state in which a client
could simply stop sending it. It has not been an authorization input since the v1.2.78 cutover —
attribution lives in `author_id` / `last_editor_id`.

**`src/data/exportImport.ts` is the complete file-format and import-planning module.** V2 is a
one-Board format containing Label definitions plus nullable Task/Series Label references; Account
Preferences are excluded, and v1 settings are discarded on parse. `parseExport()` validates any
supported version (v1 through v4) into one `ImportBundle`; `referencedSourceLabels()` exposes only
definitions that need choices;
and `prepareImport()` requires every one to map explicitly to an existing destination Label or
Unlabeled before it freshens ids and produces destination-scoped rows. It never matches by name or
creates Label definitions. `DataSection` owns only file/download and Supabase I/O, keeps the
template-first batch cursor for retry, freezes mapping after a partial write, and uses
`transferContent` for import versus Owner-only `exportBoard` for export. Separate Task/Label export
reads fail closed if a concurrent vocabulary change would create a dangling reference.

**`ExportTask` is the on-disk Task, and it is deliberately not `Task`.** Until #204 they were the
same type, so `serializeExport` stringified `Task[]` straight to disk and the file format tracked
every field rename in `src/types/task.ts` silently. Renaming `recurOriginDay`/`recurSkip` to the
domain vocabulary would therefore have invalidated every previously exported v2 file — files this
app does not control and cannot migrate. The format is now frozen at the v1/v2 names and
translated at the seam, exactly as `mappers.ts` translates at the database boundary. Two tests pin
it: one asserts the serializer still writes `recurSkip`/`recurOriginDay`, the other imports a
hand-written pre-#204 file. **Any future rename of a `Task` field is a file-format decision**, and
the answer is almost always to extend `ExportTask` rather than let the format follow.

`LabelDirectoryProvider` is mounted inside `BoardDirectoryProvider` above `<Routes>`. Its
`useLabels(userId, boardId, hasSession)` adapter loads the selected Board's definitions, keeps a
per-Board snapshot, reloads on visibility/online catch-up, and since #179 also owns the
Owner-only management writes. Cards and drag overlays resolve names/colors through this provider; a
null or missing definition renders the neutral Unlabeled presentation. Label Color supplies the
accent only; Note Color still chooses the paper.

**Labels are published to realtime, and the route there is worth knowing.** #177 deferred it on a
conjunction — no shipped UI mutated definitions, **and** publishing another RLS table would widen
the DELETE fan-out for no freshness benefit. #179 shipped Owner-only management and expired both
halves at once, but kept catch-up anyway on the narrower argument that one Owner needs no push. That
argument confuses one _person_ with one _surface_: `visibilitychange` and `online` are catch-up's
only triggers, so it never fires for a tab that stays open and focused, and a laptop beside an awake
phone is one person with two of them. #188 published the table.

The edge that closed was not cosmetic staleness, and its ordering is the instructive part. `tasks`
was published and `labels` was not, so another focused surface re-rendered its cards as Unlabeled
correctly the moment the Label foreign key's column-list `on delete set null` fired — while its
Label directory stayed stale, so `TaskEditor` went on offering a chip for the deleted definition and
the save was then rejected by `tasks_label_same_board`. **Partial freshness is worse than uniform
staleness**: the board looked trustworthy while the vocabulary under it was not.

`useLabels` is now a third `useSyncedTable` adapter beside `useTasks` and `useSettings`, filtered on
`board_id` for the same reason `tasks` is — an account-scoped subscription would deliver definitions
for every Board the account belongs to. Two consequences of joining it are easy to get wrong:

- **Every mutation must `markWrites`, including a reorder's whole batch.** A reorder rewrites
  several rows, so marking only the dragged id lets the untouched-looking siblings echo back and
  undo the local order.
- **The hand-rolled catch-up listener had to go.** `useSyncedTable` registers its own, and keeping
  both meant every wake and reconnect issued two identical loads — caught by a test asserting a
  reload count, which is the only reason it was noticed at all.

`src/labels/labelRealtime.ts` holds the payload normalizer and the pure reducer, mirroring
`src/data/realtime.ts`. INSERT and UPDATE collapse into one `UPSERT` case deliberately: the reducer
has to be idempotent anyway, since a reconnect replays a reload over whatever arrived during the
outage, so branching on which one it was would add a path with no consequence. The result is always
re-sorted by `(position, id)` — a remote reorder arrives as several independent UPDATEs, and nothing
constrains `(board_id, position)` to be unique, so ties must break deterministically or the list
flickers as the rest of the batch lands.

**`src/labels/labelIntent.ts` is the decision half of Label management** — `checkName`, `checkColor`,
`moveLabel`, `changedPositions`, `labelProblemFromError`, `explainProblem` — with `useLabels` left
holding only state, Supabase, and rollback. It follows `series.ts` / `editIntent.ts`, and the
payoff is the same: one vocabulary of refusals rendered identically whether the client caught the
problem or PostgREST did. `LabelProblem` is app-owned and keyed on SQLSTATE plus _constraint names_,
never on message prose, the same bargain `authOutcome.ts` makes.

**A uniform vocabulary is not the same as a visible one, and the gap between them was a real bug.**
Every refusal used to render in one `role="alert"` at the foot of `LabelsSection` — below the whole
Label list _and_ the "New label" form, so on a phone a refused rename reported itself off-screen
while the field went on showing the rejected draft. That reads exactly like the app silently losing
the edit, which is what #235 was reported as and what #237 fixed: `problem` is now a `ScopedProblem`
carrying the Label it belongs to (`null` for the new-Label form), `run()` requires that id at every
call site, and each row renders its own. One refusal is visible at a time, next to the control that
caused it.

The section's unmount flush (below) is the one refusal that **cannot** be reported, and it is
accepted rather than overlooked: it runs outside `run()` because there is no `setProblem` left to
render into. Screening the draft with `checkName` first would change nothing observable — the write
path already checks it — so it would only add a second copy of the question.

Two schema facts shape the write path and are not guessable from the UI. The INSERT grant is
`(board_id, name, dot_color, position)`, so **the client cannot supply an `id`** — creation reads
the row back rather than inventing a temporary id — and PostgREST upsert, which is
`INSERT ... ON CONFLICT` and needs the key, is therefore **unavailable for reorder**. Reorder is one
UPDATE per moved row, which is why `changedPositions` exists; nothing constrains
`(board_id, position)` to be unique, so a partially applied reorder is a cosmetic ordering rather
than a broken row, and the next move renumbers densely over it. Deletion clears assignments through
`on delete set null (label_id)` — a _column list_, so the Task keeps its NOT NULL Board — which is
why the UI can promise "tasks become Unlabeled" without touching `tasks` itself.

`can.manageLabels` only hides controls; the Owner-only policies and column grants are the boundary.
`tests/rls/labels.test.ts` is what makes that hiding cosmetic rather than load-bearing: an Editor
and a Viewer are each refused create/rename/delete while still reading, a non-member sees nothing,
an ended Membership grants nothing even to a former Owner, and the column grants return `403` for a
client trying to move a Label across Boards. The role-refusal tests carry
positive controls on purpose — without one, a membership seed that quietly failed would make every
refusal pass for the wrong reason.
