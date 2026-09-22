import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { createHandler, type Feed } from "./handler.ts";

// The token-to-Membership resolution is `ical_feed` in SQL and is exercised against a real stack in
// `tests/rls/ical_feed.test.ts`. What is left here is the gate around it -- which requests reach the
// reader at all, and what each outcome looks like on the wire -- so the reader is injected.

const TOKEN = "3f1c2b4a-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const NOW = new Date("2026-09-22T12:00:00Z");

const FEED: Feed = {
  board_name: "My Board",
  timezone: "America/New_York",
  tasks: [
    {
      id: "t1",
      title: "Timed",
      description: null,
      day: "2026-09-22",
      at_time: "09:30",
    },
    {
      id: "t2",
      title: "All day",
      description: "notes",
      day: "2026-09-23",
      at_time: null,
    },
  ],
};

function setup(result: Feed | null | Error = FEED) {
  const seen: string[] = [];
  const handler = createHandler({
    loadFeed: (token) => {
      seen.push(token);
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result);
    },
    now: () => NOW,
  });
  return { handler, seen };
}

const get = (query: string, method = "GET") =>
  new Request(`http://localhost/ical${query}`, { method });

Deno.test("a valid token serves the Board as text/calendar", async () => {
  const { handler, seen } = setup();
  const res = await handler(get(`?token=${TOKEN}`));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/calendar; charset=utf-8");
  assertEquals(seen, [TOKEN]);

  const body = await res.text();
  assertStringIncludes(body, "BEGIN:VCALENDAR\r\n");
  assertStringIncludes(body, "X-WR-CALNAME:My Board\r\n");
  // The Account Timezone reaches the serializer: 09:30 in New York is 13:30Z.
  assertStringIncludes(body, "DTSTART:20260922T133000Z\r\n");
  assertStringIncludes(body, "DTSTART;VALUE=DATE:20260923\r\n");
  // The injected clock, not the wall clock, stamps the events.
  assertStringIncludes(body, "DTSTAMP:20260922T120000Z\r\n");
});

Deno.test("a served feed may be cached for five minutes, privately", async () => {
  // Calendar clients poll hard, which is the reason for the five minutes. `private` because the
  // response is one capability's view of one Board: a shared cache keyed on the URL has no business
  // holding it.
  const { handler } = setup();
  const res = await handler(get(`?token=${TOKEN}`));
  assertEquals(res.headers.get("cache-control"), "private, max-age=300");
  await res.body?.cancel();
});

Deno.test("an Automatic timezone is passed through as floating time", async () => {
  const { handler } = setup({ ...FEED, timezone: null });
  const body = await (await handler(get(`?token=${TOKEN}`))).text();
  assertStringIncludes(body, "DTSTART:20260922T093000\r\n");
});

Deno.test("an unknown or revoked token is 404, and is not cached", async () => {
  // `ical_feed` returns NULL for both, so the handler cannot tell them apart -- and must not try.
  // `no-store` so a rotated-away URL is not served from a cache as if it still worked, and so a
  // freshly issued one is never shadowed by a remembered 404.
  const { handler, seen } = setup(null);
  const res = await handler(get(`?token=${TOKEN}`));
  assertEquals(res.status, 404);
  assertEquals(res.headers.get("cache-control"), "no-store");
  assertEquals(seen, [TOKEN]);
  await res.body?.cancel();
});

Deno.test("a missing or malformed token is 404 without touching the database", async () => {
  for (
    const query of [
      "",
      "?token=",
      "?token=not-a-uuid",
      `?token=${TOKEN}x`,
      `?token=${TOKEN}&token=${TOKEN}`,
    ]
  ) {
    const { handler, seen } = setup();
    const res = await handler(get(query));
    assertEquals(res.status, 404, `query ${JSON.stringify(query)}`);
    assertEquals(seen, [], `query ${JSON.stringify(query)} reached the reader`);
    await res.body?.cancel();
  }
});

Deno.test("only GET and HEAD are served", async () => {
  const { handler, seen } = setup();
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    const res = await handler(get(`?token=${TOKEN}`, method));
    assertEquals(res.status, 405, method);
    assertEquals(res.headers.get("allow"), "GET, HEAD");
    await res.body?.cancel();
  }
  assertEquals(seen, []);
});

Deno.test("HEAD answers like GET, without a body", async () => {
  const { handler } = setup();
  const res = await handler(get(`?token=${TOKEN}`, "HEAD"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/calendar; charset=utf-8");
  assertEquals(res.body, null);
});

Deno.test("a reader failure is 500, uncached, and never logs the token", async () => {
  // The token is a credential. Supabase keeps function logs, so a log line carrying it would turn
  // log access into Board access.
  const { handler } = setup(new Error(`boom for ${TOKEN}`));
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    const res = await handler(get(`?token=${TOKEN}`));
    assertEquals(res.status, 500);
    assertEquals(res.headers.get("cache-control"), "no-store");
    await res.body?.cancel();
  } finally {
    console.error = original;
  }
  assertEquals(logged.length, 1);
  assertEquals(JSON.stringify(logged).includes(TOKEN), false);
});
