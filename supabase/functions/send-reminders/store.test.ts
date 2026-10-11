import { assertEquals, assertRejects } from "jsr:@std/assert@1";
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

interface Paging {
  /** The most rows one request answers, as `max_rows` caps it. */
  cap: number;
  /** The exact count reported on each successive request. */
  counts?: number[];
}

/** The candidate RPC: honours `range`, caps the page, reports a count. */
function candidateRpc(rows: CandidateRow[], paging: Paging) {
  let request = 0;
  return () => {
    let from = 0;
    let to = Number.POSITIVE_INFINITY;
    const chain = {
      order: () => chain,
      range: (first: number, last: number) => {
        from = first;
        to = last;
        return chain;
      },
      then: (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) => {
        const last = Math.min(to + 1, from + paging.cap);
        return Promise.resolve({
          data: rows.slice(from, last),
          count: paging.counts?.[request++] ?? rows.length,
          error: null,
        }).then(resolve, reject);
      },
    };
    return chain;
  };
}

function storeOver(
  rows: CandidateRow[],
  tables: Record<string, unknown[]> = {},
  paging: Paging = { cap: 1000 },
): SupabaseReminderStore {
  return new SupabaseReminderStore({
    rpc: candidateRpc(rows, paging),
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

const NOW = Date.parse("2026-09-15T12:50:00Z");
const FIVE = ["t1", "t2", "t3", "t4", "t5"].map((id) => row("ada", id));

Deno.test("every pairing is read when the server caps a page", async () => {
  const planned = await storeOver(FIVE, {}, { cap: 2 }).candidates(NOW);

  assertEquals(pairings(planned), [
    "ada|t1",
    "ada|t2",
    "ada|t3",
    "ada|t4",
    "ada|t5",
  ]);
});

Deno.test("an answer that changes between pages is refused, not planned", async () => {
  const store = storeOver(FIVE, {}, { cap: 2, counts: [5, 4] });

  await assertRejects(
    () => store.candidates(NOW),
    Error,
    "load reminder candidates: incomplete",
  );
});

Deno.test("a pairing repeated across pages is refused, not planned", async () => {
  const repeated = [FIVE[0], FIVE[1], FIVE[1], FIVE[2]];
  const store = storeOver(repeated, {}, { cap: 2 });

  await assertRejects(
    () => store.candidates(NOW),
    Error,
    "load reminder candidates: incomplete",
  );
});
