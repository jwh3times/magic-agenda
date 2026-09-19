import { assertEquals } from "jsr:@std/assert@1";
import { handler } from "./handler.ts";

// These mirror `delete-account/handler.test.ts`: the gate checks that need no network, run before
// any client is constructed. The authorization proper (Owner-only) and the object sweep are
// exercised against a real stack, not here -- a handler test that mocked the storage API would be
// asserting the mock.

Deno.test("OPTIONS preflight succeeds", async () => {
  const res = await handler(new Request("http://localhost/", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
});

Deno.test("rejects non-POST methods with 405", async () => {
  const res = await handler(new Request("http://localhost/", { method: "GET" }));
  assertEquals(res.status, 405);
});

Deno.test("rejects a request without a valid JWT with 401", async () => {
  const res = await handler(
    new Request("http://localhost/", { method: "POST", body: "{}" }),
  );
  assertEquals(res.status, 401);
});

Deno.test("the JWT is checked before the body", async () => {
  // Ordering matters: a malformed body from an unauthenticated caller must still be 401, so this
  // endpoint cannot be used to probe request handling without credentials.
  const res = await handler(
    new Request("http://localhost/", { method: "POST", body: "not json" }),
  );
  assertEquals(res.status, 401);
});
