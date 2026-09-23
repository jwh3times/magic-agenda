import { rowToTask, taskToRow } from "../../../src/data/mappers.ts";
import { pendingInstances } from "../../../src/data/series.ts";
import type { Database } from "../../../src/types/database.types.ts";

export type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
export type TaskInsert = Database["public"]["Tables"]["tasks"]["Insert"];

/** What `public.series_materialization_state(p_from)` returns. */
export interface MaterializationState {
  definitions: TaskRow[];
  occurrences: {
    recur_parent_id: string;
    recur_origin_day: string;
    /** `null` when the Occurrence was moved to the Inbox. */
    day: string | null;
  }[];
}

/** Days read below the planner's floor, so a change to its grace cannot fake a gap. */
const STATE_MARGIN_DAYS = 7;

function utcDay(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * The planner's "today", and the earliest Occurrence Date worth reading, for a run at `now`.
 *
 * **"Today" is UTC tomorrow.** The planner fills from one grace day below its today, so that puts
 * the floor at UTC today, and no zone's local date is ever more than a day ahead of UTC. The job
 * therefore never creates an Occurrence older than the client itself would (the client's floor is
 * its own local today less the same grace day). The cost is the far end: the horizon runs a day or
 * two past the client's, which is harmless, since both writers skip what the other made.
 */
export function materializationWindow(
  now: Date,
): { todayStr: string; from: string } {
  const day = 86_400_000;
  return {
    todayStr: utcDay(now.getTime() + day),
    from: utcDay(now.getTime() - STATE_MARGIN_DAYS * day),
  };
}

/**
 * The Occurrences missing across every Board, as rows ready to insert.
 *
 * Deliberately thin: `pendingInstances` is the client's own planner (#424 — one definition of
 * "which Occurrences are missing", not two), and `rowToTask` / `taskToRow` are the client's own
 * mapping, so the rows are exactly what the client would have inserted. What this adds is only
 * what the client never needed: many Boards at once, so each row takes its definition's Board.
 */
export function planMaterialization(
  state: MaterializationState,
  todayStr: string,
  nextId: () => string,
): TaskInsert[] {
  const boardOf = new Map(state.definitions.map((d) => [d.id, d.board_id]));
  const existing = state.occurrences.map((o) => ({
    recurParentId: o.recur_parent_id,
    occurrenceDate: o.recur_origin_day,
    // The app's own Inbox sentinel: `mappers.ts` is where NULL becomes 'inbox', and this is the
    // one place outside it that reads a raw row, so it follows the same rule.
    day: o.day ?? "inbox",
  }));
  const instances = pendingInstances(
    state.definitions.map(rowToTask),
    existing,
    todayStr,
    nextId,
  );
  return instances.flatMap((instance) => {
    const board = instance.recurParentId
      ? boardOf.get(instance.recurParentId)
      : undefined;
    return board ? [taskToRow(instance, board)] : [];
  });
}
