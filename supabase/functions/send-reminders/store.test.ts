import { assertEquals } from "jsr:@std/assert@1";
import type { Database } from "../../../src/types/database.types.ts";
import type { ReminderCandidate } from "./domain.ts";
import { SupabaseReminderStore } from "./store.ts";

type Client = ConstructorParameters<typeof SupabaseReminderStore>[0];
type Functions = Database["public"]["Functions"];
type CandidateRow = Functions["reminder_candidate_rows"]["Returns"][number];

const DUE = "2026-09-15T13:00:00Z";
const WINDOW_OPENS = "2026-09-15T12:45:00Z";

function row(accountId: string, taskId: string): CandidateRow {
  return {
    account_id: accountId,
    timezone: "UTC",
    lead_minutes: 15,
    board_id: "shared",
    task_id: taskId,
    task_title: taskId,
    task_day: "2026-09-15",
    task_at_time: "13:00",
    task_status: "todo",
    recur_freq: "none",
    recur_parent_id: null as unknown as string,
    task_updated_at: "2026-09-14T12:00:00Z",
  };
}

// Two current members of one Board, each assigned one Task there. This is
// what `reminder_candidate_rows()` answers for that Board: one row per
// (Account, Task) it should remind, and no row for the other two pairings.
const PAIRED = [row("ada", "ada-task"), row("ben", "ben-task")];

/** Answers every query on a table with that table's rows; filters are inert. */
function query(rows: unknown[]): unknown {
  const answer = Promise.resolve({ data: rows, error: null });
  const chain: unknown = new Proxy({}, {
    get: (_target, key) =>
      key === "then" ? answer.then.bind(answer) : () => chain,
  });
  return chain;
}

function storeOver(
  rows: CandidateRow[],
  tables: Record<string, unknown[]> = {},
): SupabaseReminderStore {
  return new SupabaseReminderStore({
    rpc: () => Promise.resolve({ data: rows, error: null }),
    from: (table: string) => query(tables[table] ?? []),
  } as unknown as Client);
}

const pairings = (candidates: ReminderCandidate[]): string[] =>
  candidates.map((candidate) => `${candidate.accountId}|${candidate.taskId}`)
    .sort();

function claimFor(accountId: string, taskId: string) {
  return {
    id: "d1",
    candidate: {
      accountId,
      boardId: "shared",
      taskId,
      taskTitle: taskId,
      timezone: "UTC",
      leadMinutes: 15,
      dueMomentMs: Date.parse(DUE),
      windowOpensMs: Date.parse(WINDOW_OPENS),
    },
  };
}

Deno.test("a member is reminded only about the Tasks paired with them", async () => {
  const planned = await storeOver(PAIRED).candidates(
    Date.parse("2026-09-15T12:50:00Z"),
  );

  assertEquals(pairings(planned), ["ada|ada-task", "ben|ben-task"]);
});

Deno.test("a claim is eligible only while its own pairing is offered", async () => {
  const store = storeOver(PAIRED);
  const now = Date.parse("2026-09-15T12:50:00Z");

  assertEquals(
    await store.recheck(claimFor("ada", "ada-task"), now),
    "eligible",
  );
  // Reassigned to Ben after Ada's delivery was claimed: the Task and both
  // Accounts are still in the answer, but this pairing no longer is.
  assertEquals(
    await store.recheck(claimFor("ada", "ben-task"), now),
    "ineligible",
  );
});

Deno.test("a retry is resumed only for a pairing that is still offered", async () => {
  const delivery = (id: string, accountId: string, taskId: string) => ({
    id,
    account_id: accountId,
    task_id: taskId,
    due_moment: DUE,
    window_opens_at: WINDOW_OPENS,
  });
  const store = storeOver(PAIRED, {
    reminder_delivery_targets: [
      { delivery_id: "d1" },
      { delivery_id: "d2" },
    ],
    reminder_deliveries: [
      delivery("d1", "ben", "ben-task"),
      delivery("d2", "ada", "ben-task"),
    ],
  });

  // Past the Due Moment the planner offers nothing, so only retries remain.
  const resumed = await store.candidates(Date.parse("2026-09-15T13:10:00Z"));

  assertEquals(pairings(resumed), ["ben|ben-task"]);
});
