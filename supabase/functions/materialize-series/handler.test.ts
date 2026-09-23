import { assertEquals } from "jsr:@std/assert@1";
import { createHandler, type MaterializationStore } from "./handler.ts";
import type { MaterializationState, TaskInsert, TaskRow } from "./plan.ts";

const SECRET = "cron-secret";
const NOW = new Date("2026-09-23T03:17:00Z");

function definition(id: string): TaskRow {
  return {
    id,
    board_id: "b0000000-0000-4000-8000-000000000001",
    title: "daily",
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
  };
}

function fakeStore(
  state: MaterializationState,
  failChunk = -1,
): MaterializationStore & { loads: string[]; chunks: TaskInsert[][] } {
  const loads: string[] = [];
  const chunks: TaskInsert[][] = [];
  return {
    loads,
    chunks,
    load: (from) => {
      loads.push(from);
      return Promise.resolve(state);
    },
    insert: (rows) => {
      chunks.push(rows);
      return chunks.length - 1 === failChunk
        ? Promise.reject(new Error("foreign key violation"))
        : Promise.resolve(rows.length);
    },
  };
}

function setup(store: MaterializationStore, chunkSize = 100) {
  let built = 0;
  let id = 0;
  const handler = createHandler({
    secret: SECRET,
    store: () => {
      built++;
      return store;
    },
    now: () => NOW,
    nextId: () => `id-${++id}`,
    chunkSize,
  });
  return { handler, built: () => built };
}

const post = (token?: string) =>
  new Request("http://localhost/materialize-series", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

Deno.test("only POST is accepted", async () => {
  const { handler, built } = setup(
    fakeStore({ definitions: [], occurrences: [] }),
  );
  const res = await handler(
    new Request("http://localhost/materialize-series", { method: "GET" }),
  );
  assertEquals(res.status, 405);
  assertEquals(built(), 0);
});

Deno.test("a missing or wrong bearer is refused before the store is even built", async () => {
  // The store holds the service-role client: an unauthenticated caller must not cause one to exist.
  for (const token of [undefined, "", "wrong", `${SECRET}x`]) {
    const { handler, built } = setup(
      fakeStore({ definitions: [], occurrences: [] }),
    );
    const res = await handler(post(token));
    assertEquals(res.status, 401, `token ${JSON.stringify(token)}`);
    assertEquals(built(), 0);
  }
});

Deno.test("an unset secret refuses everything, including an empty bearer", async () => {
  let built = 0;
  const handler = createHandler({
    secret: "",
    store: () => {
      built++;
      return fakeStore({ definitions: [], occurrences: [] });
    },
    now: () => NOW,
    nextId: () => "x",
  });
  assertEquals((await handler(post(""))).status, 401);
  assertEquals((await handler(post("anything"))).status, 401);
  assertEquals(built, 0);
});

Deno.test("a run reads the window, inserts in chunks, and reports what it did", async () => {
  const store = fakeStore({
    definitions: [definition("d1"), definition("d2"), definition("d3")],
    occurrences: [],
  });
  const { handler } = setup(store, 100);
  const res = await handler(post(SECRET));
  assertEquals(res.status, 200);

  assertEquals(store.loads, ["2026-09-16"]);
  const sizes = store.chunks.map((c) => c.length);
  assertEquals(sizes.every((n) => n <= 100), true);
  const total = sizes.reduce((a, b) => a + b, 0);
  assertEquals(total > 250, true);

  assertEquals(await res.json(), {
    definitions: 3,
    proposed: total,
    inserted: total,
    failedChunks: 0,
  });
});

Deno.test("one failing chunk does not stop the rest, and the run reports failure", async () => {
  // A definition deleted mid-run can fail a chunk on its foreign key. Every other Board's
  // Occurrences still land, and tomorrow's run repairs the rest.
  const store = fakeStore({
    definitions: [definition("d1"), definition("d2"), definition("d3")],
    occurrences: [],
  }, 0);
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    const { handler } = setup(store, 100);
    const res = await handler(post(SECRET));
    assertEquals(res.status, 500);
    const body = await res.json();
    assertEquals(body.failedChunks, 1);
    assertEquals(store.chunks.length > 1, true);
    assertEquals(body.inserted, body.proposed - store.chunks[0].length);
  } finally {
    console.error = original;
  }
  assertEquals(logged.length, 1);
});

Deno.test("a failed read is a 500 with nothing inserted", async () => {
  const store: MaterializationStore = {
    load: () => Promise.reject(new Error("boom")),
    insert: () => Promise.reject(new Error("must not be called")),
  };
  const original = console.error;
  console.error = () => {};
  try {
    const { handler } = setup(store);
    assertEquals((await handler(post(SECRET))).status, 500);
  } finally {
    console.error = original;
  }
});

Deno.test("nothing missing means no insert call at all", async () => {
  const store = fakeStore({
    definitions: [{ ...definition("d1"), recur_until: "2026-01-02" }],
    occurrences: [],
  });
  const { handler } = setup(store);
  const res = await handler(post(SECRET));
  assertEquals(res.status, 200);
  assertEquals(store.chunks, []);
  await res.body?.cancel();
});
