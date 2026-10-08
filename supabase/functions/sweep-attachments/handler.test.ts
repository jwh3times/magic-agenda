import { assertEquals } from "jsr:@std/assert@1";
import { createHandler, type SweepStore } from "./handler.ts";

const SECRET = "cron-secret";

function fakeStore(
  paths: string[],
  failBatch = -1,
): SweepStore & { collects: [number, number][]; batches: string[][] } {
  const collects: [number, number][] = [];
  const batches: string[][] = [];
  return {
    collects,
    batches,
    collect: (graceSeconds, limit) => {
      collects.push([graceSeconds, limit]);
      return Promise.resolve(paths);
    },
    remove: (batch) => {
      batches.push(batch);
      return batches.length - 1 === failBatch
        ? Promise.reject(new Error("storage unavailable"))
        : Promise.resolve();
    },
  };
}

const post = (token?: string) =>
  new Request("https://example.test/functions/v1/sweep-attachments", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

Deno.test("refuses anything but POST before building the store", async () => {
  let built = false;
  const handler = createHandler({
    secret: SECRET,
    store: () => {
      built = true;
      return fakeStore([]);
    },
  });
  const response = await handler(
    new Request("https://example.test/", { method: "GET" }),
  );
  assertEquals(response.status, 405);
  assertEquals(built, false);
});

Deno.test("refuses a missing or wrong bearer before building the store", async () => {
  let built = false;
  const handler = createHandler({
    secret: SECRET,
    store: () => {
      built = true;
      return fakeStore([]);
    },
  });
  assertEquals((await handler(post())).status, 401);
  assertEquals((await handler(post("wrong"))).status, 401);
  assertEquals(built, false);
});

Deno.test("an unset secret refuses every bearer, including an empty one", async () => {
  const handler = createHandler({ secret: "", store: () => fakeStore([]) });
  assertEquals((await handler(post(""))).status, 401);
  assertEquals((await handler(post("anything"))).status, 401);
});

Deno.test("removes exactly what the command offered, in bounded batches", async () => {
  const store = fakeStore(["b/t/1", "b/t/2", "b/t/3"]);
  const handler = createHandler({
    secret: SECRET,
    store: () => store,
    graceSeconds: 60,
    limit: 10,
    batchSize: 2,
  });
  const response = await handler(post(SECRET));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    offered: 3,
    removed: 3,
    failedBatches: 0,
  });
  assertEquals(store.collects, [[60, 10]]);
  assertEquals(store.batches, [["b/t/1", "b/t/2"], ["b/t/3"]]);
});

Deno.test("a failed batch does not stop the others, and the run answers 500", async () => {
  const store = fakeStore(["b/t/1", "b/t/2", "b/t/3"], 0);
  const handler = createHandler({
    secret: SECRET,
    store: () => store,
    batchSize: 2,
  });
  const response = await handler(post(SECRET));
  assertEquals(response.status, 500);
  assertEquals(await response.json(), {
    offered: 3,
    removed: 1,
    failedBatches: 1,
  });
  assertEquals(store.batches.length, 2);
});

Deno.test("a failed collect removes nothing", async () => {
  const store = fakeStore([]);
  store.collect = () => Promise.reject(new Error("rpc failed"));
  const handler = createHandler({ secret: SECRET, store: () => store });
  const response = await handler(post(SECRET));
  assertEquals(response.status, 500);
  assertEquals(store.batches, []);
});

Deno.test("the response carries counts, never paths", async () => {
  const handler = createHandler({
    secret: SECRET,
    store: () => fakeStore(["board-id/task-id/attachment-id"]),
  });
  const body = await (await handler(post(SECRET))).text();
  assertEquals(body.includes("board-id"), false);
});
