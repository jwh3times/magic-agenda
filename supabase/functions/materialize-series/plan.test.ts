import { assertEquals } from "jsr:@std/assert@1";
import { rowToTask } from "../../../src/data/mappers.ts";
import { pendingInstances } from "../../../src/data/series.ts";
import {
  type MaterializationState,
  materializationWindow,
  planMaterialization,
  type TaskRow,
} from "./plan.ts";

const NOW = new Date("2026-09-23T03:17:00Z");
const BOARD = "b0000000-0000-4000-8000-000000000001";

/** A stored Series definition row, as `series_materialization_state` returns it. */
function definition(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "d0000000-0000-4000-8000-000000000001",
    board_id: BOARD,
    title: "Water the plants",
    description: "",
    label_id: null,
    color: "#cccccc",
    checklist: [],
    status: "todo",
    completed_at: null,
    reopen_status: "todo",
    archived_at: null,
    day: "2026-01-01",
    at_time: null,
    pinned: false,
    order_index: 1000,
    korder: 1000,
    recur_freq: "daily",
    recur_interval: 1,
    recur_weekdays: [],
    recur_count: null,
    recur_until: null,
    recur_parent_id: null,
    recur_skip: [],
    recur_origin_day: null,
    created_at: "2026-01-01T00:00:00+00:00",
    updated_at: "2026-01-01T00:00:00+00:00",
    author_id: null,
    author_kind: "author",
    last_editor_id: null,
    revision: 1,
    ...overrides,
  };
}

function state(
  definitions: TaskRow[],
  occurrences: MaterializationState["occurrences"] = [],
): MaterializationState {
  return { definitions, occurrences };
}

let counter = 0;
const nextId = () => `i${++counter}`;

Deno.test("the window starts at UTC tomorrow, and reads a margin below the planner's floor", () => {
  // UTC tomorrow as "today" puts the planner's floor (today less its one grace day) at UTC today.
  // No zone's local date is more than a day ahead of UTC, so the job never creates an Occurrence
  // older than the client itself would.
  const window = materializationWindow(NOW);
  assertEquals(window.todayStr, "2026-09-24");
  // The state is read from a week earlier: a margin, so a change to the planner's grace cannot
  // make covered Occurrences look missing. Over-reading costs a little data and nothing else.
  assertEquals(window.from, "2026-09-16");
});

Deno.test("the job proposes exactly what the client's own planner proposes", () => {
  // Not a re-implementation to keep in step: the same function, on the same input. This pins the
  // mapping around it (row -> Task on the way in, Task -> row on the way out).
  const def = definition();
  const { todayStr } = materializationWindow(NOW);
  const rows = planMaterialization(state([def]), todayStr, nextId);
  const client = pendingInstances([rowToTask(def)], [], todayStr, nextId);

  assertEquals(rows.map((r) => r.recur_origin_day), client.map((t) => t.day));
  assertEquals(rows.length > 80, true);
});

Deno.test("nothing is proposed below UTC today", () => {
  // A year-old daily Series is the case that would backfill hundreds of rows if the floor slipped.
  const rows = planMaterialization(
    state([definition()]),
    materializationWindow(NOW).todayStr,
    nextId,
  );
  const earliest = rows.map((r) => r.recur_origin_day!).sort()[0];
  assertEquals(earliest, "2026-09-23");
});

Deno.test("an Excluded Date is never resurrected", () => {
  const rows = planMaterialization(
    state([definition({ recur_skip: ["2026-09-25"] })]),
    materializationWindow(NOW).todayStr,
    nextId,
  );
  const days = rows.map((r) => r.recur_origin_day);
  assertEquals(days.includes("2026-09-24"), true);
  assertEquals(days.includes("2026-09-25"), false);
});

Deno.test("an existing Occurrence covers its origin even after it was moved to another day", () => {
  const def = definition();
  const rows = planMaterialization(
    state([def], [
      // Dragged from the 24th to the 30th: its Occurrence Date is still the 24th.
      {
        recur_parent_id: def.id,
        recur_origin_day: "2026-09-24",
        day: "2026-09-30",
      },
      // Moved to the Inbox.
      { recur_parent_id: def.id, recur_origin_day: "2026-09-26", day: null },
    ]),
    materializationWindow(NOW).todayStr,
    nextId,
  );
  const days = rows.map((r) => r.recur_origin_day);
  assertEquals(days.includes("2026-09-24"), false);
  assertEquals(days.includes("2026-09-26"), false);
  assertEquals(days.includes("2026-09-25"), true);
});

Deno.test("each row is an Occurrence of its own definition, on the definition's Board", () => {
  const other = definition({
    id: "d0000000-0000-4000-8000-000000000002",
    board_id: "b0000000-0000-4000-8000-000000000002",
    recur_freq: "weekly",
  });
  const rows = planMaterialization(
    state([definition(), other]),
    materializationWindow(NOW).todayStr,
    nextId,
  );
  for (const row of rows) {
    const parent = row.recur_parent_id === other.id ? other : definition();
    assertEquals(row.board_id, parent.board_id);
    // An Occurrence carries no Rule of its own: that is what makes it an Occurrence.
    assertEquals(row.recur_freq, "none");
    assertEquals(row.status, "todo");
  }
  assertEquals(rows.some((r) => r.recur_parent_id === other.id), true);
});

Deno.test("a Rule that has run out proposes nothing", () => {
  const rows = planMaterialization(
    state([definition({ recur_until: "2026-09-01" })]),
    materializationWindow(NOW).todayStr,
    nextId,
  );
  assertEquals(rows, []);
});
