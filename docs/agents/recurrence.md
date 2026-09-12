# Recurrence is a hidden-template model

The most complex subsystem. Read before touching `src/data/series.ts`, `src/data/recurrence.ts`,
`src/data/editIntent.ts`, the `Task` union, or anything that materializes or deletes Occurrences.

**`template` and `instance` are implementation words and stay inside this subsystem.** The domain
names are in [`CONTEXT.md`](../../CONTEXT.md): a **Recurring Series** (the hidden row plus its
**Recurrence Rule**) produces **Occurrences**, each identified within its Series by an immutable
**Occurrence Date** — never by its movable **Scheduled Day** — and a deleted Occurrence leaves an
**Excluded Date** behind. Use those words in issues, commit messages, product copy, and any new
public API; `template` and `instance` are fine in the code that already speaks them, and #204
renamed the two fields that were not implementation words at all — `Task.recurOriginDay` is
`occurrenceDate` and `Task.recurSkip` is `excludedDates`. The old names survive in exactly two
places, both deliberately: the database columns (`recur_origin_day`, `recur_skip`), translated in
`mappers.ts`, and the **export file format**, translated by `ExportTask` in `exportImport.ts`. Why
Occurrences are real rows rather than computed from the Rule on read is
[ADR-0001](../adr/0001-materialized-occurrences.md).

A recurring series is a **hidden template row** (`recurFreq != 'none'`, `recurParentId === null`, see
`isTemplate()`) that is **kept out of the board `tasks` list** (held in a separate ref inside
`useTasks`) plus **materialized instance rows** (`recurFreq 'none'`, `recurParentId = template id`).
Keeping templates out of the board list is what keeps reorder/DnD math clean. On load, `useTasks`
materializes any missing instances over a rolling window that runs from today to 90 days out —
**from today, not from the Rule's anchor** (#210); deleted occurrences are remembered
in a per-template `excludedDates` array so they are never regenerated. `reload()` has an in-flight guard
because React StrictMode double-invokes the load effect, which otherwise double-inserts instances and
trips the `(recur_parent_id, day)` unique index (Postgres 23505).

**`src/data/series.ts` owns this model, and everything it decides is pure.** It holds `instanceKey`
(occurrence identity), `makeInstance`, `pendingInstances`, the scope resolvers (`resolveSave` /
`resolveDelete`), and a **plan** for each series operation — the next board, the next templates, the
rows to upsert, the deletions to run, the ids to mark as our own writes. `src/data/recurrence.ts` is
its pure date core. `useTasks.runPlan` is the only effectful part: it applies the optimistic state,
sends the writes, and honours each step's `FailureHandling`.

That split is what made this subsystem testable. Before it, the three scope operations were a
207-line block inside `useTasks` that **no test reached** — `deleteSeriesFuture`, the branchiest
function in the data layer, had zero — while the cheap date maths in `recurrence.ts` had 22 tests.

Eight details worth keeping:

- **Promotion keeps the row and creates the template, not the other way round.** Adding a
  Recurrence Rule to a standalone Task routes through `resolveSave` -> `planPromoteToSeries`: a
  **new** row becomes the hidden template, and the existing row becomes the Series' first
  Occurrence by pointing at it. The obvious shape is the reverse — turn the row into the template
  in place and let materialization build the first Occurrence — and that is what shipped until
  #206. It silently discarded the user's `status`, checklist done-state, and `order`/`korder`,
  because `makeInstance` resets all of them: it builds _future_ Occurrences, where resetting is
  exactly right. The first Occurrence is not a future one. Keeping the row also keeps its id, so
  nothing still referencing that card is left pointing at a row that has left the board.
- **Ending a Series is not an edit that happens to clear the Rule.** Removing the Recurrence Rule
  with all-future scope used to route through `planEditSeriesFrom` like any other all-future edit,
  which copies the draft's Rule fields onto the definition — so it wrote `recurFreq: 'none'` onto
  the hidden row instead of removing it. That row was no longer `isTemplate`, so it never returned
  to the board, and `missingInstanceDates` produced `[]` for it forever, so it stopped
  materializing anything while its existing Occurrences went on pointing at it (#220).
  `resolveSave` now recognizes a Rule _removal_ under `future` scope as its own `end-series-at` op,
  resolved by the pure planner `planEndSeriesAt`. It tests the **stored** row as well as the draft
  via the exported predicate `removesRule(orig, draft)`
  (`draft.recurFreq === 'none' && orig.recurFreq !== 'none'`), and both halves are required:
  `Board.openTask` merges the Series' Rule onto a draft only if it finds the definition, so a
  lookup that missed is indistinguishable from a removal on the draft alone — and reading it as one
  routes a plain rename to a plan that deletes rows. The plan: the Series is capped the day before
  the edited Occurrence (or deleted outright if no Occurrence survives before it — see
  `noOccurrenceSurvives` below), the edited Occurrence is detached into a standalone Task carrying
  the edits saved alongside the removal, earlier Occurrences are untouched, and later ones are
  deleted. Two orderings inside it are load-bearing: the detached row is upserted **before** the
  definition is deleted, with `FATAL` failure handling, because `tasks.recur_parent_id` cascades and
  would otherwise delete the very row being kept; and the trim is scoped `occurrence-after`
  (strictly after the cut) rather than `occurrence-from`, so it cannot reach the kept Occurrence even
  independent of that ordering. `removesRule` is `resolveSave`'s own inline test pulled out to a
  named export (#229), not new logic, because it has a second caller that must agree with it: the
  editor's scope prompt (`ScopePrompt`'s `endsSeries`) reads it to warn that later Occurrences will
  be removed, and a second,
  independently-worded copy of the same question is how a warning and the plan it describes drift
  apart. **Rule _shortening_** — moving `recurUntil` earlier, which also deletes Occurrences and has
  done since long before #220 — is deliberately outside `removesRule` and unwarned; #229 scoped the
  copy to removal rather than to every deleting save.
- **A Series definition carries no pin, and that is a fix rather than an omission.** `makeInstance`
  used to copy `tmpl.pinned`, while nothing after `planPromoteToSeries` ever wrote that column — so
  a Series' pin was frozen at whatever the Task's pin happened to be when it was promoted, and every
  future Occurrence was born carrying it with no way to change it (#215). Pinning is Occurrence
  State (ADR-0002), so the channel was removed rather than made editable: `makeInstance` builds
  unpinned Occurrences, `planPromoteToSeries` resets `pinned` on the definition alongside `status`
  and the checklist done-state, and `20260820120000_clear_series_definition_pins.sql` clears the
  column on existing definitions. That migration is tidiness, not correctness — the client fix alone
  ends the bug, because the new `makeInstance` never reads the column. Note the first Occurrence
  **keeps** the user's pin: it is their card, exactly as #206 established for the rest of its state.
- **A Recurrence Rule without a Scheduled Day is refused in the editor, not the data layer.** An
  unscheduled anchor yields no Occurrence Dates at all (`missingInstanceDates` returns `[]` when
  `!isScheduled(template.day)`), so saving one used to file the Task away as a template that
  materialized nothing — the card left the board with no error (#209). `TaskEditor` gates Save on
  it; the warning under the Repeat field had said so since long before it bound.
- **The materialization window starts at today; the anchor is only the Rule's phase.**
  `occurrenceDates` takes `from` and `horizonEnd` and both are **required** — a `from` defaulting
  to the anchor is the unbounded backfill of #210 wearing a default. Until then the walk had no
  lower bound, so adding a Rule to a Task scheduled a year ago inserted ~455 rows, a three-year-old
  one hit a 1000-iteration ceiling and was silently truncated, and the same backfill repeated on
  every horizon refresh rather than only the first. Two things fall out of this that look like
  micro-optimizations and are not: the daily/weekly **fast-forward** exists because the old walk's
  cost was proportional to the anchor's _age_, which is exactly how it failed to reach the window
  at all; and **monthly is deliberately never fast-forwarded**, because `addMonths` overflows
  rather than clamps (Jan 31 + 1 month is Mar 3), so n single steps do not land where one n-month
  step does and jumping would silently re-phase the Rule. The fast-forward floors and the loop
  still filters, so it can only save iterations, never change the result — pinned by a test that
  compares it against a naive walk.
- **Scope is always by Occurrence Date, never by the card's day.** `occurrenceDateOf` is what stops a
  dragged instance from being scoped wrongly, from resurrecting as a duplicate, or from
  false-triggering the whole-series branch of a delete.
- **The whole-Series branch of a trim is chosen by counting survivors, not by testing the anchor.**
  `planDeleteSeriesFrom` and `planEndSeriesAt` both used to ask `cut <= template.day` — does the cut
  land on the Series' anchor — which is a different question from whether any Occurrence is left
  behind it. Deleting an Occurrence individually leaves an Excluded Date, so a Series whose earlier
  Occurrences had each been deleted one at a time could be trimmed down to a Rule that produces
  nothing while the anchor test still reported a survivor — a valid but meaningless
  `SeriesDefinition`, hidden from the board, harmless to render, and carried into every backup by
  `exportBoard` (#228). The `from`-not-`anchor` materialization window (above) is a second,
  unnamed source of the same rows: a long-running Series whose earliest Occurrences were never
  materialized has nothing surviving before a present-day cut either, and the anchor test counted
  that as a survivor too. Both planners now call the private `noOccurrenceSurvives(state, template,
cut)`, which counts by Occurrence Date and requires `state.tasks` to be the whole board — safe
  today only because `reload()` selects with no date window and an offline board is read-only; a
  windowed load would turn this from tidiness into deleting rows the user can still see. Definitions
  already orphaned in existing accounts are deliberately left alone (triaged as fix-new plus
  document-old, not a sweep).
- **A single-Occurrence delete asks a different question, and reusing `noOccurrenceSurvives` for it
  is the trap.** Deleting the last Occurrence of an already-capped Series reached the same orphaned
  shape by a path the trim fix did not touch, because `planDeleteOccurrence` recorded the Excluded
  Date and stopped (#231). That predicate does not answer it: it asks whether anything survives a
  **cut**, and here there is no cut. Nor is "owns no Occurrences" sufficient on its own — deleting
  the only materialized Occurrence of a _live_ Series is ordinary, and materialization creates the
  next one. A definition may only go when the Rule can produce nothing **more**, which has a
  clock-free answer: an unbounded Rule always produces more, so `ruleIsSpent` checks that the Rule
  is bounded and every Occurrence Date in `[day, recurUntil]` is already excluded. No `today` has
  to be threaded into a planner that takes none. Three things about it are easy to get wrong. It is
  tested against the state the delete **produces**, since the exclusion being recorded is usually
  the one that empties the Rule. Its cost is **asymmetric**, and only the `true` side is bounded by
  the exclusions: a `true` means every date the walk visited was excluded, so it cannot outrun
  `excludedDates.length`. `false` gets no matching shortcut — `occurrenceDates` collects the whole
  set rather than stopping at the first unexcluded date, so an unspent Rule walks its entire window,
  capped only by the `MAX_OCCURRENCES` ceiling every caller shares (measured: a weekly Rule bounded
  a year out walks 52, a daily one bounded six years out stops at 1000). That is cheap for the
  Rules users actually write and is why no short-circuit was added — one would mean either a second
  walk or a `recurrence.ts` variant, and duplicating that module's fast-forward and monthly-overflow
  rules to save microseconds is the worse trade. And the unbounded early return is enforced by the
  **typechecker**, not a test: `recurUntil` is `string | null` while `occurrenceDates`' `horizonEnd`
  is `string`. It is deliberately partial in one direction — a Rule dead by _clock_ rather than by
  exclusion (capped in the past, its Occurrence Dates never materialized because the window starts
  at today) is not spent by this test, and catching it would cost the clock-free property for a case
  that is narrow in practice.
- **`FailureHandling` is two independent questions** (`abort` and `recover`) because the original
  behaviour answered them independently: a failed content upsert aborts the trim that follows it,
  while a failed `excludedDates` write must _not_ stop the occurrence being deleted.
- **`pendingInstances` takes the board as a required argument.** It used to default to a ref whose
  own docstring called the default unsafe — `setTasks` writes that ref inside a deferred React
  updater, so passing it right after a load makes every occurrence look missing and re-inserts rows
  that already exist. Three of the four call sites took the default and none was tested.

`Board` no longer knows any of this: the editor's scope prompt produces a `RecurScope`, and
`saveTask` / `deleteTask` resolve it. The four-way save dispatch and three-way delete dispatch that
used to live in the UI shell — including the rule-stripping on the this-occurrence path, enforced by
nothing but a comment — are `resolveSave` / `resolveDelete`.

**`Task` is a discriminated union of the three shapes, narrowed at the database boundary.** #205
replaced the flat interface with `StandaloneTask | SeriesDefinition | Occurrence` over a shared
`TaskBase`, plus `BoardCard` (the two that can appear on a Board). The payoff is
`Occurrence.occurrenceDate: string` — non-null — so the `?? day` fallback covers a state the type
no longer admits. `asTask()` is the **one** place a flat row becomes a shape, and `rowToTask`,
the file parser, and every test factory funnel through it.

Four things about it are load-bearing:

- **A parented row with no Occurrence Date is read as standalone**, not as a broken Occurrence.
  That is not new policy — `20260813210200` detached exactly those rows in production for the same
  reason — and `tasks_occurrence_has_date` now stops more being written. The constraint matters
  more than it looks: `tasks_recur_instance_uniq` is _partial_ on `recur_parent_id`, and NULLs are
  distinct in a unique index, so such a row was not constrained by it **at all**.
- **`TaskDraft` is the editor's shape and is deliberately not a `Task`.** `Board.openTask` merges
  the Series' Rule onto an Occurrence so the Repeat controls have something to edit, producing a
  row that names a parent _and_ carries a Rule — which no Task does. It was typed as `Task`, which
  simply asserted something untrue.
- **`cleanDraft` must not narrow.** Running the draft through `asTask` there reads it as an
  Occurrence and forces `recurFreq` back to `'none'`, silently discarding every all-future Rule
  change. Narrowing happens per branch in `resolveSave`, once the scope says which shape results.
  A `useTasks` test caught this; it is the sharpest edge in the union.
- **`SeriesState.templates` is `readonly SeriesDefinition[]`, and narrowing it is the regression
  guard for #220, not tidiness.** It was `readonly Task[]` because `planEditSeriesFrom` copied the
  draft's Rule fields onto the definition, so removing the Rule under all-future scope produced a
  definition carrying `recurFreq: 'none'` — a hidden row that materialized nothing and was no
  longer reachable as a Series (see `planEndSeriesAt` above, which is what that operation routes to
  now instead). With the type narrowed, `planEditSeriesFrom` and `planPromoteToSeries` check
  `isSeriesDefinition` on the row they build and return `SeriesPlan | null` — `null` for a shape
  that cannot occur given how `resolveSave` dispatches, which is why both call sites in `useTasks`
  simply skip a `null` plan rather than handling a real failure. `SeriesState.tasks` stays
  `readonly Task[]`, not `BoardCard[]`: definitions are excluded from the board by `useTasks`, not
  by this type, and narrowing it is a separate change with its own fallout.

Spreading a union member and overriding a recurrence field yields a shape matching no member, so
construction sites either state the target shape (`asOccurrence`, `asSeriesDefinition`) or funnel
through `asTask`. That friction is the type doing its job: it is exactly the set of places that
were previously free to invent a combination the domain does not have.

**`src/data/editIntent.ts` is the editor's half of the same split.** `series.ts` decides _which
occurrences_ an operation touches; `editIntent.ts` decides _whether the editor may proceed at all_
and _whether it has to ask first_ — `cleanDraft`, `changedTaskKeys`, `onlyPerOccurrenceChanged`,
`intendSave`, `intendDelete`. All pure, and all previously private to a 739-line
`TaskEditor.tsx`, which is why its eight tests reached them by clicking through the DOM and why the
fail-safe property documented on `changedTaskKeys` was asserted by nothing.

Two facts that used to be undeclared and now live in types:

- **`onSave`'s scope is definite for a recurring instance.** It was `undefined` on the
  per-occurrence-only path, and `Board` had to know that meant "this occurrence". `resolveSave`
  still defends against `undefined` — that default is tested — but nothing produces it for an
  instance now.
- **`onDelete` carries only an id**, and `useTasks.deleteTask` looks the row up in its own state.

The delete seam is worth understanding, because the obvious framing of it is the wrong one.
[#132](https://github.com/jwh3times/magic-agenda/issues/132) asked whether deleting should act on
the edited draft or on the stored task, since the editor passed a whole `Task` and the two differ.
Both answers left the same hazard: `onDelete(task: Task)` promised far more than the delete path
used — it reads only `id`, `recurParentId`, `occurrenceDate` and `day` — so any field read from it
later would silently start depending on unsaved edits, with no test failing. Passing an id removes
the question instead of answering it, and is strictly more correct than either option was, because
`initial` is **not** the stored row: `Board.openTask` merges the template's
`recurFreq`/`recurInterval`/`recurUntil` onto an instance before handing it to the editor.

An unknown id is a **no-op**, which is what an already-deleted-elsewhere row looks like.

(For the record, the original bug was inert: of the four fields the path reads, only `day` is
editable, and it is reached only via `occurrenceDateOf`'s `occurrenceDate ?? day` fallback — which
`20260630130000_recur_origin_day.sql` backfilled for every instance that had a day. The null-origin
rows left are inbox instances from before that migration, for which `occurrenceDateOf` already
returns the meaningless `'inbox'`.)

`PER_OCCURRENCE_FIELDS` and `seriesContent()` are **derived from one table**, not maintained
separately. `src/data/fieldOwnership.ts` maps every `Task` field to its owner — Recurrence Rule,
Series Content, Occurrence State, Occurrence Placement, or identity — per
[ADR-0002](../adr/0002-series-occurrence-field-ownership.md), and the two lists fall out as
complements of that partition. `FIELD_OWNER` is a mapped type over `keyof Task`, so **a field added
to `Task` without an owner is a compile error** (TS2741), not a fifth silent gap.

`AGENTS.md` used to call the two lists "deliberately kept separate ... not exact complements", and
that was the bug rather than the design: `day`, `order`, `korder` and `checklist` were in neither,
and each gap was a silent write loss. #168 measured them with the real planner; #213 closed three:

- **Occurrence Placement no longer raises the scope question.** Changing an Occurrence's day or
  manual order says nothing about the Series, so it saves straight through. It used to prompt, and
  choosing all-future then discarded the change — a `TaskEditor` test asserted that prompt _and_
  clicked through it, pinning the bug's surface without catching the bug.
- **All-future keeps the edited Occurrence's own state.** Affected Occurrences are rebuilt from the
  stored row, which is right for every Occurrence except the one being edited; without the
  exception, a pin toggled in the same save as a rename was dropped on that very card.
- **`excludedDates` is Rule-owned but never copied from a draft.** `RULE_EDITABLE_FIELDS` exists for
  this one trap: a draft is an _Occurrence_, whose own `excludedDates` is always empty, so spreading
  every Rule field from it would erase the Series' Excluded Dates and resurrect every Occurrence the
  user has deleted.

**The fourth gap is closed too, and it needed a new invariant rather than a bigger copy.**
`checklist` is Series Content, but copying it by value would reset every Occurrence's Step
Completion — the option ADR-0002 rejects. `src/data/checklistSteps.ts` reconciles instead:
`reconcileSteps` takes the Series' Steps and carries each Occurrence's `done` across **by Step
identity**, so a renamed Step keeps its tick, a removed one takes its tick with it, a new one
arrives unticked, and reordering changes nothing. `SERIES_CONTENT_RECONCILED` names it as the one
Series Content field `pick()` must not copy verbatim, and a test asserts that set is exactly
`{checklist}`.

Three consequences, none of them obvious from the reconciler alone:

- **`makeInstance` preserves the definition's Step ids instead of minting fresh ones.** That shared
  identity is the whole mechanism; without it there is nothing to match on. Only `done` resets,
  because a future Occurrence starts with nothing ticked.
- **`remapIds` remaps Step ids through one map for the whole bundle**, not per task. Freshening per
  task would sever every _imported_ Series' Steps from its Occurrences' — the feature would work
  everywhere except on a restored backup, which is exactly the kind of hole that goes unnoticed.
- **A text fallback exists for Occurrences materialized before ids were stable.** Those carry the
  definition's Step _text_ under unrelated ids, so identity alone would reset their ticks. Leftovers
  unclaimed by identity are matched on exact text, as a strictly second pass — an id match always
  wins, so a Step renamed in the same edit keeps its own tick rather than stealing the tick of
  whichever Step still carries its old words. It becomes dead weight once every Occurrence has been
  rebuilt with stable ids, which is cheaper than a jsonb migration over user checklists.

The edited Occurrence is the exception to reconciliation: it takes `draft.checklist` outright,
ticks included, because reconciling it against its own stored row would hand back the completion
the user just changed in the editor.

**A weekly Rule can name weekdays, and any Rule can end after N Occurrences** (#268,
`tasks.recur_weekdays` / `tasks.recur_count`, schema in `20260911190000` one release ahead of the
client for the `PGRST204` reason [Labels](labels.md) gives in the other direction). Five decisions
here are load-bearing and none is recoverable from the code alone.

- **`occurrenceDates` takes the Rule as an object**, with `from` and `horizonEnd` left outside it as
  required positional arguments. That split is the #210 lesson kept alive: the window bounds are the
  two parameters that must never acquire a default, and a Rule-shaped bag is exactly where such a
  default would hide.
- **An empty weekday set means "the Start Day's weekday"**, and a non-empty one **always includes it
  anyway** (`effectiveWeekdays`). Strict filtering is the obvious alternative and it breaks
  `planPromoteToSeries`, which turns the promoted row into the Series' _first Occurrence_ at its own
  day (#206) — a Rule that did not yield its own Start Day would leave that Occurrence Date unfilled
  forever. Forcing it in the pure walk rather than only in the editor is what makes the guarantee
  hold for imports and Data API writes. The editor shows that chip on and disabled; the `disabled`
  attribute is the entire guard, since a disabled button fires no click.
- **Week blocks are anchored on the Start Day, not on a Sunday or the user's week start.** Block
  _k_ spans `[day + 7·interval·k, +6]` and covers each weekday exactly once, so "every other week on
  Mon and Fri" means something without consulting `weekStart` — which would otherwise drag an
  Account Preference into a pure function and make one Series render differently for two members of
  the same Board.
- **The count is measured from the Series' first Occurrence, and Excluded Dates spend it.** Two
  independent traps. The window's lower bound is today (#210) while the count's is the Start Day, so
  a count tallied over the window silently lengthens every Rule whose Series began earlier — the
  `generated` counter exists to keep those apart, and the fast-forward is **disabled** whenever a
  count is present because a jump skips exactly the Occurrences it would have counted. Nothing is
  lost by walking: a count is capped at `MAX_OCCURRENCES`, which bounds the walk by itself, and that
  shared ceiling is why the cap is 1000 rather than a rounder product number. Exclusions then remove
  from the generated set rather than extending it (RFC 5545's COUNT/EXDATE reading), so deleting one
  Occurrence of a Series of five leaves four.
- **`allOccurrenceDates(rule: BoundedRule)` is what lets `ruleIsSpent` see a counted Rule.** Bounded
  now means by date **or** by count; reading `recurUntil !== null`, which is what that predicate did
  before, would leave every counted Series unable to retire (#231's bug, reintroduced). The type is
  load-bearing exactly as the old `horizonEnd: string` was: deleting the guard is a compile error,
  not a test failure.

Three smaller consequences worth not rediscovering. `NO_RULE_PARAMS` exists because **three** places
turn an editor draft into an Occurrence — `makeInstance`, `resolveSave`'s this-occurrence path, and
`planPromoteToSeries`'s first Occurrence — and only `recurFreq`/`recurUntil` are caught by the type
there; a weekday set riding the spread is a row `tasks_recur_weekdays_weekly_only` refuses outright.
`cappedAt()` is the same argument one level up: both trimming planners clear the count when they set
an end date, because a Rule carrying two ends that disagree would have its count reinterpreted
against the shortened window. And `asTask`'s standalone branch restores `recurInterval` and
`excludedDates` from its input but deliberately **not** these two, since both are coupled to
`recur_freq` by CHECK constraints — letting `NO_RECUR` clear them is what makes demoting a Series
back to a plain Task produce a writable row.

The walk's `isScheduled(rule.day)` guard is **defence that no test reaches**, and it says so at the
call site: two accidents of string comparison against the `'inbox'` sentinel already produce the
same answer (`'NaN-NaN-NaN'` sorts after every real date, and before `'inbox'`). Measured by
deleting it and finding the suite still green. Do not add a test for it — it would pass either way.

**Export went to v4 and the offline snapshot to v9.** `ExportTaskV3` is the frozen v3 shape and v3
files still parse, with both parameters taking their unlisted meaning. Extending v3 in place was
rejected because an older client's validator ignores unknown keys, so it would import a weekly
Series and silently drop the weekdays it repeats on — a version it refuses outright is the better
failure. `isV4Task` validates against the **database's** constraints rather than looser ones,
because an import writes straight through `taskToRow`: a file this parser accepted and the database
then refused would fail part-way through a batch, after earlier rows had landed.
