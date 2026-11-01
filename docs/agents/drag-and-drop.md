# Drag-and-drop: every decision is pure; dnd-kit is an adapter

Two pure modules, then thin wiring. `src/dnd/reorder.ts` is the **splice math** (`moveToDay` /
`moveToStatus`): it reindexes **both** the source and destination lanes on a cross-container move.
It also holds `revertPreview`, which takes that math back out when a drag is cancelled.
`src/dnd/resolveDrop.ts` is **every decision** — `modeForView`, `containerOf`, `isBelowOver`,
`insertionIndex`, and the `resolveDrop` session reducer that accumulates `touched` and `didMove`.
Neither imports `@dnd-kit/core`. `src/dnd/useBoardDnd.ts` is now only sensors, event mapping, and
React state.

The seam moved here in v1.2.56, and the reason is worth keeping: it had been drawn at "pure vs
impure" rather than "hard vs easy", so the tested half was the easy half. `reorder.ts` had 17 tests
across four exports — **two of which had no production call site at all** — while the wiring held
the container-id overloading, the above/below geometry, the insertion arithmetic, and the
multi-hop lane accumulation behind one test that needed ~45 lines of hand-cast dnd-kit fixtures.
`findContainer` was the sharpest symptom: exported, tested four ways, never called, and returning
`undefined` for an id matching no task — while the wiring's own copy returned **the id itself**,
which is the only reason a drop onto an empty lane worked. Both are now one tested function.

Critical, non-obvious detail: persistence must fire **even when `over.id === active.id`** (after an
optimistic move the dragged card sits under the cursor as its own drop target), tracked by
`DragSession.didMove` — `resolveDrop` returns `null` for that event while the session stays
"moved". Container ids are overloaded on purpose: `dateStr | 'inbox'` (day mode) or a status
(kanban) identifies a _lane_, and an id matching no task **is** a lane id.

**A cancel undoes what the drag showed (#583).** A hover has already put a cross-lane move in state,
so `onDragCancel` calls `cancelReorder` when the session's `didMove` is set, and `revertPreview` in
`reorder.ts` restores only the fields that still hold what the preview showed. Before this the card
stayed in the other lane, and worse, the next drag on that lane saved it, since `persistReorder` writes
every Task in a touched lane. Letting go over nothing is not a cancel: on layouts that relocate on
hover it's a drop, and it persists where the card last moved to.

**That only holds if nothing saves the preview first (#585).** A keyboard drag leaves the pointer
free, and pin, completion and the editor all write whole rows, so pressing Pin on a carried card
saved the previewed lane, and the cancel afterwards fixed only the screen. So `Board` refuses its
card actions while `dnd.dragging` is set, through `refuseIfCarrying`, and says why with a notice:
Pin, Complete, opening a card, adding a Task, moving overdue Tasks to today and Undo. It applies to
every card, because a preview renumbers the cards around the move too. The buttons stay, because
removing them would shift the layout under the drag. Undo writes only rows from before the drag, but
a cancel would then put back on screen the placement it replaced, so the screen and the server would
disagree. The notice shows over an undo offer without losing it, and goes when the drag ends. Dragging
is also off behind an open editor, which has no focus trap, so an editor save never meets a preview.
Any new action that writes Task rows and can be reached during a drag needs the same guard.

`useBoardDnd` must be given the **unfiltered** board, even though views render `visibleTasks`.
Passing the filtered list would corrupt data rather than merely narrow the drag: `persistReorder`
writes back every task in a touched lane, so the visible tasks would get contiguous `0..n-1`
indices while hidden tasks in the same lane kept theirs. Since #434 that write is one **update-only** `apply_task_writes` call over
the complete lanes: last-accepted-wins, and a Task another member deleted meanwhile is not
re-created by being in a lane — the write comes back short and the board reloads. Dragging under an active filter is
prevented one level up. Archived Tasks (#242, [Completion](completion.md)) are the same shape of
exception: `Board.tsx` excludes them from `visibleTasks` at its own view seam, ahead of the user's
filter, but still passes the unfiltered `tasks` — Archived rows included — into `useBoardDnd` for
exactly this reason. An Archived card is never rendered, so it is never a drop target either way,
but its slot in the lane's indices has to stay real.

Moving a Task into the Inbox clears its Due Time in the same `moveToDay` transition. For an
Occurrence, the move remains a This Occurrence edit: `occurrenceDate` stays intact while `day` and
`atTime` change together. Roll-forward is different: it preserves Due Time and only moves active,
scheduled Tasks whose Scheduled Day is before today.

While a search filter is active, drag is disabled via `DragDisabledContext` (consumed by
`SortableCard`'s `useSortable({ disabled })`); this keeps the `DndContext` sensors array a constant
size, avoiding a dnd-kit hook-deps warning. Selection mode (#270) is the third reason the context
is true, beside a filter and a read-only board; an open editor (#585) is the fourth. While selecting, a click, a Ctrl/Cmd-click, or Enter
on a card toggles its selection (`Board.openTask` decides; `SortableCard` reports it through
`aria-pressed`), and a drag would contend for the same gesture. The selection is narrowed to
`visibleTasks`, so a filter change can never leave a hidden card inside the next bulk action. Sensors are split Mouse/Touch (not `PointerSensor`):
touch drags require a **250ms long-press** and cards use `touchAction: 'manipulation'`; together
that's what lets a plain swipe over a card scroll the board on phones. Do not collapse these back
into a `PointerSensor` or set `touchAction: 'none'`. `touch-action` narrows down the tree, so it must
hold on everything inside a card too: until #566 `cardStyles`' wrap set `'none'` inside this wrapper,
and a swipe over a card scrolled nothing on any phone view. Chromium's touch input in `smoke.spec.ts`
covers this on the phone Calendar's panel, along with a long-press drag. No automated test runs iOS
Safari.

**The phone Calendar drags a full-width card onto a 53px cell (#566), which changes three things**,
all of them only on that layout. The pure modules decide; `src/dnd/phoneDrag.ts` is the dnd-kit half.

- **Droppable ids stay unique.** The selected day is both a grid cell and the panel's lane, and the
  Inbox is both a tab and a lane. So cells and the Inbox tab register `dropTargetId(lane)`, and
  `useBoardDnd`'s `dropInput` maps them back with `laneOfDroppable` before `resolveDrop` runs. The pure
  modules still see only lane and card ids, because `containerOf` takes any other id to be a lane.
- **Hovering a target only highlights it.** `dropInput` says so with `dropOnly`, an explicit input to
  `resolveDrop`: a hover relocates nothing, a drop settles at the end of that day because `overId` is
  the lane, and a drop back on the card's own lane does nothing. Relocating on hover would pull the
  card out of the panel mid-gesture, and a cell has nowhere to show it. So `touched` gains the target
  only on the drop, and the panel stays on the source day, ready for the next card. That drop also
  calls `previewReorder` before persisting, because Undo is armed by a drag's first preview.
- **Collision follows the finger.** `phoneCalendarCollision` looks for a target under the pointer
  first, because `closestCorners` compares the card's corners, which would pick the wrong day, and a
  card scrolled out of the panel keeps a rect behind the grid. In the panel it keeps `closestCorners`,
  so reordering behaves as it does elsewhere: the pointer alone would read the gap between two cards as
  the lane, which sends a card to the end. Anywhere else is nothing, so letting go leaves the Task.

The overlay is `compact` there, held above the finger by the `aboveFinger` modifier, and names the
target (`→ Tue 10 Nov`), since a finger covers the cell. That modifier is on `DragOverlay`, so it
moves only the picture.

**`PhoneCalendar` holds its selected day for the length of a drag.** With no day tapped the panel
follows today, so midnight would otherwise re-key its `DropLane` under a held card, and hovering that
new lane would relocate the Task and persist it. **A keyboard drag only reorders there:** the cells and
the tab disable their droppables for one, because `sortableKeyboardCoordinates` steps between enabled
droppables and would walk the card across the month. The editor's date field moves a Task from the
keyboard, and to another month, which a drag can't reach.

**`SortableCard` is the card's only tab stop, and it now answers two keys, not one (#281).**
dnd-kit's default `KeyboardSensor` `start` codes are `[Space, Enter]`, so Enter was consumed by the
sensor before it could ever reach the card — a keyboard user could reorder the entire board but had
no way to open a single task, because the pointer path to the editor is `TaskCard`'s `onClick`,
which a keyboard never fires. `KEYBOARD_CODES` in `useBoardDnd.ts` restricts `start` to `[Space]`;
`end` deliberately keeps `[Space, Enter, Tab]`, since mid-drag there is no card to open and a user
reaching for Enter to drop should not be ignored. Reclaiming Enter cost nothing observable: dnd-kit's
own default screen-reader instructions say "press the space bar" and never mention a second key, so
the binding removed was the one nobody was told about. `Board.tsx`'s `DND_INSTRUCTIONS` replaces
those defaults with a sentence that describes both keys — **keep it in step with `KEYBOARD_CODES`;
the sensor and the sentence describing it are one decision in two places.** `CARRYING_NOTICE` names
the drop and cancel keys too.

`SortableCard` composes its own `onKeyDown` in front of dnd-kit's: it calls
`listeners?.onKeyDown?.(e)` first — dnd-kit owns Space, and while a drag is live it owns the arrows,
Escape, and the drop keys too — and opens the editor only if `!e.defaultPrevented && e.key ===
'Enter'`. Reading `defaultPrevented` (which dnd-kit sets whenever it acts) is most of what lets this stay
ignorant of which drag phase the sensor is in, rather than duplicating that state machine. It is not
all of it: Enter is still a **drop** key, and dnd-kit listens for the drop on the ownerDocument while
React dispatches from the root container, so on that ordering this handler runs first with
`defaultPrevented` still false — hence the `isDragging` clause beside it. That clause is
deliberately untested and says so at the call site: once a keyboard drag starts, the drop Enter never
reaches the handler under jsdom, because the sensor moves focus. The test there asserts the outcome
through that path, not the guard, so removing the guard leaves it green. A second
guard, `e.target !== e.currentTarget`, exists because the pin and completion buttons sit _inside_
this focusable wrapper: their keydown bubbles up to it, so without the guard every Enter on a nested
control would fire two actions — the button's own, plus the editor on top of it. Enter on the card
itself deliberately does exactly what a click already does, including offline, where `onOpen` is
ungated and the editor opens read-only.

This intentionally leaves the pre-existing `nested-interactive` a11y-baseline entries (3 per theme)
unchanged: the wrapper still carries `role="button"` and still contains the pin/completion buttons,
but that role is now _more_ accurate than before, since the wrapper genuinely does something on
Enter rather than only dragging. Switching it to `role="group"` would clear the rule at the cost of
a less truthful role — see the 2026-07-31 acceptance this leaves standing.

**Assistive tech does reach the nested buttons, as measured on 2026-10-16 (#337).** Over AT-SPI,
the layer Linux screen readers read, Chromium and Firefox both expose each card's Pin/Unpin and
Complete as focusable buttons inside the card, and Tab visits card, Pin, Complete, then the next
card. So the axe rule is being conservative, and the acceptance stands. Safari with VoiceOver is
unmeasured, because WebKit could not run on the measuring machine.

What the measurement did find was the card's **name**. Computed from the content of a
`role="button"`, it took in those buttons' labels: "Water the plants UNLABELED Unpin Complete",
where "Complete" sounds like the Task's status. `SortableCard` now names the card with
`aria-labelledby` pointing at the title, and describes it with `aria-describedby` pointing at the
details TaskCard shows: COMPLETED stamp, description, Label, time or day, assignee, checklist
progress. The ids come from `src/components/cardA11y.ts`. The describedby keeps dnd-kit's drag
instructions by appending its own id, and it is set after the attribute spread so dnd-kit's value
cannot replace it.

That naming is why axe's `label-content-name-mismatch` is baselined too, since axe-core 4.14 ran it
by default (2026-10-20). The rule wants all of a card's visible text inside its name; the title
leads the name, and the details stay in the description. The reasoning is in
`tests/e2e/a11y.spec.ts`'s acceptance note — do not "fix" it by widening `aria-labelledby`.

The pinned `@dnd-kit/*` 0.5 packages in `devDependencies` belong only to the successor-API prototype
under `src/dnd/dndKitNext.*`; production still uses `@dnd-kit/core` / `sortable`. The prototype
proved that the successor can feed the existing pure drop seam on desktop, but its single
pointer-type-aware sensor has not passed real iOS Safari and Android Chrome scroll/long-press tests.
Before changing the production adapter or removing those prototype dependencies, read
`docs/specs/2026-08-12-dnd-kit-next-prototype.md` and satisfy its touch-hardware exit criteria.
