import { assertEquals } from "jsr:@std/assert@1";
import { handler, summarizePlan } from "./handler.ts";

Deno.test("OPTIONS preflight succeeds", async () => {
  const res = await handler(
    new Request("http://localhost/", { method: "OPTIONS" }),
  );
  assertEquals(res.status, 200);
});

Deno.test("rejects non-POST methods with 405", async () => {
  const res = await handler(
    new Request("http://localhost/", { method: "GET" }),
  );
  assertEquals(res.status, 405);
});

Deno.test("rejects a request without a valid JWT with 401", async () => {
  const res = await handler(
    new Request("http://localhost/", { method: "POST" }),
  );
  assertEquals(res.status, 401);
});

Deno.test("summarizePlan sweeps only private Boards", () => {
  const plan = summarizePlan([
    { board_id: "a", disposition: "private" },
    { board_id: "b", disposition: "shared" },
    { board_id: "c", disposition: "private" },
  ]);
  assertEquals(plan, { privateBoardIds: ["a", "c"], soleOwnedShared: 0 });
});

Deno.test("summarizePlan counts sole-owned shared Boards as blocking", () => {
  const plan = summarizePlan([
    { board_id: "a", disposition: "private" },
    { board_id: "b", disposition: "sole-owner-shared" },
  ]);
  assertEquals(plan.soleOwnedShared, 1);
});

Deno.test("summarizePlan treats an unknown disposition as blocking, never as sweepable", () => {
  // A trigger that grew a new refusal case must not be answered by deleting files first.
  const plan = summarizePlan([{ board_id: "a", disposition: "something-new" }]);
  assertEquals(plan, { privateBoardIds: [], soleOwnedShared: 1 });
});
