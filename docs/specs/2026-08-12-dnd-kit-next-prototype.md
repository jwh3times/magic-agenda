# dnd-kit successor API prototype (#156)

## Decision

Defer the production migration. The published 0.5.0 API can feed Magic Agenda's existing pure
`resolveDrop`/`reorder` seams, and the live prototype preserves the desktop behavior that was
exercised. The remaining risk is the successor's single `PointerSensor`: the current app's separate
mouse and touch sensors are load-bearing for mobile scrolling, and the prototype has not been run on
real iOS and Android hardware.

The successor packages are therefore pinned at 0.5.0 in `devDependencies` only. The production
adapter and its legacy dependencies remain unchanged.

## API map

| Current API                   | Successor 0.5 API                           | Adapter consequence                                                                                            |
| ----------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `DndContext`                  | `DragDropProvider`                          | Provider events now expose `event.operation`.                                                                  |
| `event.active` / `event.over` | `operation.source` / `operation.target`     | `nextDropInput()` maps ids and shapes into the unchanged vendor-free `DropInput`.                              |
| `onDragCancel`                | `onDragEnd` with `event.canceled`           | The adapter skips persistence, then resets, for canceled operations.                                           |
| `MouseSensor` + `TouchSensor` | `PointerSensor`                             | One configured sensor branches by `pointerType`: mouse/pen distance 6; touch delay 250 ms with 8 px tolerance. |
| Provider `collisionDetection` | Per-draggable/droppable `collisionDetector` | Sortables and empty lanes use `closestCorners`.                                                                |
| `SortableContext`             | `useSortable({ group, index })`             | Each card supplies its lane group and explicit index.                                                          |
| `useSortable({ disabled })`   | Same concept                                | Search filtering can keep a stable provider/sensor list while disabling cards.                                 |
| `DragOverlay` child           | `DragOverlay` source render prop            | One overlay remains mounted per provider.                                                                      |
| Legacy sortable transforms    | `OptimisticSortingPlugin`                   | The plugin is removed because `resolveDrop` owns Magic Agenda's optimistic preview.                            |

The migration guide also offers `move()` from `@dnd-kit/helpers`, but the app should keep its own
tested `moveToDay` / `moveToStatus` logic because those functions reindex both lanes and preserve the
board's domain rules.

## Prototype artifacts

- `src/dnd/dndKitNext.prototype.tsx`: compile-checked adapter plus a live React harness using the
  published successor runtime.
- `src/dnd/dnd-kit-next.runtime.html`: Vite entry for real mouse interaction with the harness.
- `src/dnd/dnd-kit-next.prototype.html`: standalone state-machine walkthrough for the invariants.

Both pages are explicitly throwaway and are not reachable from the production application.

## Verification

| Invariant                                                  | Result                                                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Persist after an optimistic move ends over the active card | Passed in the standalone walkthrough and live 0.5 runtime.                                                                 |
| Empty calendar lane                                        | Passed in the live 0.5 runtime.                                                                                            |
| Cross-lane and multi-hop touched-lane accumulation         | Passed; the live calendar drag persisted `inbox -> 2026-07-01 -> 2026-07-02`.                                              |
| Kanban status movement                                     | Passed; the live drag persisted `todo -> doing -> done`.                                                                   |
| Filter disables drag without changing sensors              | Passed in the live runtime; sortables expose their disabled state and no persistence occurs.                               |
| Unfiltered board reaches `resolveDrop`                     | Preserved by the adapter signature; the harness passes the complete task list while filtering only controls `disabled`.    |
| Mouse distance activation                                  | Passed with browser-driven pointer input.                                                                                  |
| Touch scroll before 250 ms / drag after long-press         | Represented by the published constraint API and checked in the logic walkthrough; **not verified on real touch hardware**. |
| Type compatibility                                         | `npx tsc -b` passed.                                                                                                       |

## Remaining gaps and exit criteria

Before replacing the production adapter:

1. Run the live runtime page on current iOS Safari and Android Chrome.
2. Confirm that a normal vertical swipe over a card scrolls, while a stationary 250 ms press starts a
   drag and prevents scrolling only after activation.
3. Repeat empty-lane, calendar, kanban, filtered-view, and optimistic self-target drops with touch.
4. Recheck the successor's current release and migration guide. It remains a pre-1.0 API, and its
   package split requires direct imports from `@dnd-kit/react`, `@dnd-kit/dom`, and
   `@dnd-kit/collision`.
5. If the device checks pass, replace only `useBoardDnd`, `DropLane`, and `SortableCard`; keep
   `resolveDrop.ts`, `reorder.ts`, and their tests unchanged, then add adapter-level coverage for the
   new event mapping and cancel behavior.

Reference: <https://github.com/clauderic/dnd-kit/blob/main/apps/docs/docs/react/guides/migration.mdx>
